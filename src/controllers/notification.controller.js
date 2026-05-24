const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Reminder = require('../models/Reminder');
const Analytics = require('../models/Analytics');
const { UserPreference } = require('../models/Integration');
const aiService = require('../services/ai.service');
const calendarService = require('../services/calendar.service');
const { getIO } = require('../sockets');
const logger = require('../utils/logger');

const buildIdFilter = (id, userId) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { userId, $or: [{ _id: id }, { externalId: id }] };
  }
  return { userId, externalId: id };
};

const buildDateQuery = (period) => {
  const now = new Date();
  if (period === 'TODAY') {
    const start = new Date(now.setHours(0, 0, 0, 0));
    return { $gte: start };
  }
  if (period === 'WEEK') {
    return { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
  }
  if (period === 'MONTH') {
    return { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
  }
  return {};
};

const incrementAnalytics = async (userId, notification, actionTaken = false) => {
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours();
    await Analytics.findOneAndUpdate(
      { userId, date: dateStr, sourceApp: notification.sourceApp, category: notification.category },
      {
        $inc: { 
          count: 1,
          actionCount: actionTaken ? 1 : 0,
          [`hourHistogram.${hour}`]: 1 
        }
      },
      { upsert: true }
    );
  } catch (e) {
    logger.warn('Failed to increment analytics:', e.message);
  }
};

// Helper to handle auto-creation of reminders and calendar events
const processAIAnalysis = async (userId, notification, classification) => {
  try {
    const prefs = await UserPreference.findOne({ userId });
    const threshold = prefs?.minimumConfidenceThreshold || 0.7;

    // 1. Auto-create Reminder if confidence is high and it's an actionable category
    if (
      classification.confidence >= threshold &&
      ['PAYMENT_DUE', 'MEETING', 'TASK'].includes(classification.category)
    ) {
      const dueDate = classification.entities.dueDate 
        ? new Date(classification.entities.dueDate) 
        : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24h

      const reminder = await Reminder.create({
        userId,
        notificationId: notification._id,
        title: classification.entities.summary || notification.title,
        bodySummary: notification.body,
        dueDateTime: dueDate,
        triggerDateTime: new Date(dueDate.getTime() - (prefs?.defaultLeadTimeMins || 60) * 60000),
        category: classification.category,
        amount: classification.entities.amount,
        meetingLink: classification.entities.meetingLink,
      });

      notification.reminderId = reminder._id;
      await notification.save();

      // 2. Auto-sync to Google Calendar for MEETINGS
      if (classification.category === 'MEETING') {
        await calendarService.createEvent(userId, {
          title: reminder.title,
          startTime: dueDate.toISOString(),
          endTime: new Date(dueDate.getTime() + 30 * 60000).toISOString(),
          description: `Meeting found in ${notification.sourceApp}: ${notification.body}`,
          meetingLink: classification.entities.meetingLink
        });
      }

      return reminder;
    }
  } catch (error) {
    logger.error('Error in processAIAnalysis:', error);
  }
  return null;
};

// @route  GET /api/notifications
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 30, category, sourceType, isRead, period, q } = req.query;
    const filter = { userId: req.user._id, isTransient: false, deletedAt: null };

    if (category) filter.category = category;
    if (sourceType) filter.sourceType = sourceType;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    if (period) filter.timestamp = buildDateQuery(period);
    if (q) filter.$text = { $search: q };

    const [total, notifications] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter)
        .sort({ timestamp: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .populate('reminderId', 'title status dueDateTime'),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), limit: parseInt(limit) },
      },
    });
  } catch (err) { next(err); }
};

// @route  POST /api/notifications
const analyzeAndStore = async (req, res, next) => {
  try {
    const n = req.body;
    logger.info(`Processing single notification sync: ${n.id || 'No ID'}`);
    
    if (n.id) {
      const existing = await Notification.findOne({ userId: req.user._id, externalId: n.id });
      if (existing) {
        logger.info(`Notification already exists: ${n.id}. Skipping.`);
        return res.status(200).json({ success: true, data: existing });
      }
    }

    const classification = await aiService.classifyNotification(n.title, n.body);

    const notif = await Notification.create({
      userId: req.user._id,
      externalId: n.id,
      sourceApp: n.packageName || n.sourceApp || 'unknown',
      sourceType: n.sourceType || 'OTHER',
      sender: n.sender,
      senderKey: n.senderKey,
      title: n.title,
      body: n.body,
      timestamp: n.timestamp ? new Date(n.timestamp) : new Date(),
      category: classification.category,
      confidence: classification.confidence,
      isTransient: classification.isTransient || false,
      entities: classification.entities,
    });

    const reminder = await processAIAnalysis(req.user._id, notif, classification);
    logger.info(`Successfully analyzed and stored notification: ${notif._id}`);

    res.status(201).json({ success: true, data: notif, autoActions: { reminderCreated: !!reminder } });

    incrementAnalytics(req.user._id, notif, !!reminder);
  } catch (err) { 
    logger.error(`Error in analyzeAndStore: ${err.message}`);
    next(err); 
  }
};

// @route  POST /api/notifications/bulk
const bulkIngest = async (req, res, next) => {
  try {
    const { notifications } = req.body;
    logger.info(`Bulk syncing ${notifications.length} notifications...`);
    const analyzed = await aiService.classifyBatch(notifications);
    const results = { created: 0, skipped: 0 };

    for (const n of analyzed) {
      const existing = await Notification.findOne({ userId: req.user._id, externalId: n.id });
      if (existing) { results.skipped++; continue; }

      const notif = await Notification.create({
        userId: req.user._id,
        externalId: n.id,
        sourceApp: n.packageName || n.sourceApp,
        title: n.title,
        body: n.body,
        timestamp: n.timestamp ? new Date(n.timestamp) : new Date(),
        category: n.category,
        confidence: n.confidence,
        isTransient: n.isTransient,
        entities: n.entities,
      });

      const reminder = await processAIAnalysis(req.user._id, notif, n);
      results.created++;
      incrementAnalytics(req.user._id, notif, !!reminder);
    }
    logger.info(`Bulk sync completed: ${results.created} created, ${results.skipped} skipped.`);
    res.json({ success: true, data: { results } });
  } catch (err) { 
    logger.error(`Error in bulkIngest: ${err.message}`);
    next(err); 
  }
};

const getNotification = async (req, res, next) => {
  try {
    const notif = await Notification.findOne(buildIdFilter(req.params.id, req.user._id)).populate('reminderId');
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true, data: notif });
  } catch (err) { next(err); }
};

const markRead = async (req, res, next) => {
  try {
    const notif = await Notification.findOneAndUpdate(buildIdFilter(req.params.id, req.user._id), { isRead: true }, { new: true });
    res.json({ success: true, data: notif });
  } catch (err) { next(err); }
};

const markAllRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true, data: { modified: result.modifiedCount } });
  } catch (err) { next(err); }
};

const submitFeedback = async (req, res, next) => {
  try {
    const { feedback } = req.body;
    const notif = await Notification.findOneAndUpdate(
      buildIdFilter(req.params.id, req.user._id),
      { userFeedback: feedback },
      { new: true }
    );
    if (!notif) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: notif });
  } catch (err) { next(err); }
};

const deleteNotification = async (req, res, next) => {
  try {
    await Notification.findOneAndUpdate(buildIdFilter(req.params.id, req.user._id), { deletedAt: new Date() });
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) { next(err); }
};

const getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user._id, isRead: false, isTransient: false, deletedAt: null });
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
};

module.exports = {
  getNotifications,
  getNotification,
  getUnreadCount,
  analyzeAndStore,
  markRead,
  markAllRead,
  submitFeedback,
  deleteNotification,
  bulkIngest,
};
