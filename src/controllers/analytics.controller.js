const Analytics = require('../models/Analytics');
const Notification = require('../models/Notification');
const Reminder = require('../models/Reminder');

const getDateRange = (period, from, to) => {
  const now = new Date();
  if (period === 'TODAY') {
    const s = new Date(now); s.setHours(0,0,0,0);
    return { start: s, end: now };
  }
  if (period === 'WEEK') {
    const s = new Date(Date.now() - 7*86400000); s.setHours(0,0,0,0);
    return { start: s, end: now };
  }
  if (period === 'MONTH') {
    const s = new Date(Date.now() - 30*86400000); s.setHours(0,0,0,0);
    return { start: s, end: now };
  }
  if (from && to) return { start: new Date(from), end: new Date(to) };
  return { start: new Date(Date.now() - 7*86400000), end: now };
};

// @route  GET /api/analytics/summary
const getSummary = async (req, res, next) => {
  try {
    const { period = 'WEEK', from, to } = req.query;
    const { start, end } = getDateRange(period, from, to);
    const userId = req.user._id;

    const startStr = start.toISOString().slice(0,10);
    const endStr = end.toISOString().slice(0,10);

    const query = { userId, date: { $gte: startStr, $lte: endStr } };
    if (req.query.sourceApp) query.sourceApp = req.query.sourceApp;
    if (req.query.category) query.category = req.query.category;

    const [analyticsRows, reminderStats] = await Promise.all([
      Analytics.find(query),
      Reminder.aggregate([
        { $match: { userId, createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    // Aggregate by source
    const bySource = {};
    const byCategory = {};
    const dailyTrend = {};
    let totalCount = 0, totalActions = 0, totalCompletions = 0;
    const hourAggregate = new Array(24).fill(0);

    // Pre-fill dailyTrend with 0 for all days in range
    let d = new Date(start);
    while (d <= end) {
      dailyTrend[d.toISOString().slice(0, 10)] = 0;
      d.setDate(d.getDate() + 1);
    }

    for (const row of analyticsRows) {
      totalCount += row.count;
      totalActions += row.actionCount;
      totalCompletions += row.completionCount;

      bySource[row.sourceApp] = (bySource[row.sourceApp] || 0) + row.count;
      byCategory[row.category] = (byCategory[row.category] || 0) + row.count;
      dailyTrend[row.date] = (dailyTrend[row.date] || 0) + row.count;
      row.hourHistogram.forEach((v, i) => { hourAggregate[i] += v; });
    }

    const reminderStatusMap = {};
    reminderStats.forEach((r) => { reminderStatusMap[r._id] = r.count; });

    res.json({
      success: true,
      data: {
        period,
        totalNotifications: totalCount,
        totalActions,
        totalCompletions,
        completionRate: totalActions > 0 ? ((totalCompletions / totalActions) * 100).toFixed(1) : 0,
        bySource: Object.entries(bySource).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count),
        byCategory: Object.entries(byCategory).map(([name, count]) => ({ name, count })),
        dailyTrend: Object.entries(dailyTrend).map(([date, count]) => ({ date, count })).sort((a,b) => a.date.localeCompare(b.date)),
        hourHeatmap: hourAggregate,
        reminderStats: reminderStatusMap,
      },
    });
  } catch (err) { next(err); }
};

// @route  GET /api/analytics/top-senders
const getTopSenders = async (req, res, next) => {
  try {
    const { limit = 10, period = 'WEEK' } = req.query;
    const { start } = getDateRange(period, null, null);

    const results = await Notification.aggregate([
      { $match: { userId: req.user._id, timestamp: { $gte: start }, senderKey: { $ne: null }, isTransient: false } },
      { $group: { _id: '$senderKey', sender: { $first: '$sender' }, count: { $sum: 1 }, sourceApp: { $first: '$sourceApp' }, lastSeen: { $max: '$timestamp' } } },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) },
    ]);

    res.json({ success: true, data: results });
  } catch (err) { next(err); }
};

// @route  GET /api/analytics/warc
const getWARC = async (req, res, next) => {
  try {
    const weekAgo = new Date(Date.now() - 7*86400000);
    const result = await Reminder.aggregate([
      { $match: { userId: req.user._id, status: 'DONE', updatedAt: { $gte: weekAgo } } },
      { $group: { _id: null, warc: { $sum: 1 } } },
    ]);
    res.json({ success: true, data: { warc: result[0]?.warc || 0 } });
  } catch (err) { next(err); }
};

const aiService = require('../services/ai.service');

// @route  GET /api/analytics/insights
const getInsights = async (req, res, next) => {
  try {
    const { period = 'TODAY' } = req.query;
    const { start, end } = getDateRange(period);
    const userId = req.user._id;

    const notifications = await Notification.find({
      userId,
      timestamp: { $gte: start, $lte: end },
      isTransient: false
    }).sort({ timestamp: -1 }).limit(100);

    if (notifications.length === 0) {
      return res.json({ 
        success: true, 
        data: { 
          globalSummary: `No notification story for this ${period.toLowerCase()} yet. Catch up on your day soon!`, 
          personWise: [] 
        } 
      });
    }

    // Group by sender for context
    const grouped = {};
    notifications.forEach(n => {
      const key = n.sender || n.sourceApp || 'System';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(`${n.title}: ${n.body}`);
    });

    const context = Object.entries(grouped)
      .map(([sender, msgs]) => `Sender: ${sender}\nMessages:\n- ${msgs.slice(0, 5).join('\n- ')}`)
      .join('\n\n');

    const prompt = `Task: Act as a high-level executive assistant. Analyze these notifications from ${period.toLowerCase()} and provide a deep-dive Narrative Briefing.
    
    The "globalSummary" should be a professional, cohesive story of the day. 
    - Identify recurring themes (e.g., "Heavy focus on project Alpha", "Unusually high payment activity").
    - Highlight urgent priorities that might have been missed.
    - Summarize the overall 'vibe' and workload of the user.
    - Format as a series of 5-8 insightful bullet points.
    
    Return EXACTLY this JSON format:
    {
      "globalSummary": "The cohesive professional story of the period...",
      "personWise": [
        { "sender": "Name", "summary": "Key priority or takeaway from this specific person" }
      ]
    }

    Context Data:
    ${context}`;

    const insight = await aiService.generateInsight(prompt);
    res.json({ success: true, data: insight });
  } catch (err) { next(err); }
};

module.exports = { getSummary, getTopSenders, getWARC, getDailyInsights: getInsights };
