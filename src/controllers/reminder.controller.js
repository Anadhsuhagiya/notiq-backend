const mongoose = require('mongoose');
const Reminder = require('../models/Reminder');
const Notification = require('../models/Notification');
const Analytics = require('../models/Analytics');
const { UserPreference } = require('../models/Integration');
const { getIO } = require('../sockets');
const logger = require('../utils/logger');

// @route  GET /api/reminders
const getReminders = async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 30, period } = req.query;
    const filter = { userId: req.user._id };

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (period === 'TODAY') {
      const start = new Date(); start.setHours(0,0,0,0);
      const end = new Date(); end.setHours(23,59,59,999);
      filter.dueDateTime = { $gte: start, $lte: end };
    } else if (period === 'UPCOMING') {
      filter.dueDateTime = { $gte: new Date() };
      filter.status = { $in: ['PENDING', 'SNOOZED'] };
    }

    const [total, reminders] = await Promise.all([
      Reminder.countDocuments(filter),
      Reminder.find(filter)
        .sort({ dueDateTime: 1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .populate('notificationId', 'sourceApp sourceType sender body'),
    ]);

    res.json({
      success: true,
      data: {
        reminders,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), limit: parseInt(limit) },
      },
    });
  } catch (err) { next(err); }
};

// @route  POST /api/reminders
const createReminder = async (req, res, next) => {
  try {
    const { notificationId, title, bodySummary, dueDateTime, leadTimeMins, category, meetingLink, amount } = req.body;

    // Verify notification belongs to user (handle both MongoDB _id and device-local externalId)
    const isObjectId = mongoose.Types.ObjectId.isValid(notificationId);
    const notifQuery = {
      userId: req.user._id,
      $or: [
        { externalId: notificationId }
      ]
    };
    if (isObjectId) {
      notifQuery.$or.push({ _id: notificationId });
    }

    logger.debug(`Searching for notification: ${JSON.stringify(notifQuery)}`);
    const notif = await Notification.findOne(notifQuery);
    
    // Ensure we use the actual MongoDB ObjectId for the reminder if found
    const actualNotificationId = notif ? notif._id : null;
    const externalNotificationId = notif ? (notif.externalId || null) : (isObjectId ? null : notificationId);
    
    if (!notif) {
      logger.warn(`Notification not found for reminder creation. ID: ${notificationId}. Continuing with external reference.`);
    }

    const prefs = await UserPreference.findOne({ userId: req.user._id });
    const lead = leadTimeMins ?? prefs?.defaultLeadTimeMins ?? 60;
    const due = new Date(dueDateTime);
    const trigger = new Date(due.getTime() - lead * 60 * 1000);

    // Quiet hours enforcement
    const triggerMins = trigger.getHours() * 60 + trigger.getMinutes();
    const qStart = prefs?.quietHoursStart ?? 1320;
    const qEnd = prefs?.quietHoursEnd ?? 420;
    const inQuiet = qStart > qEnd
      ? triggerMins >= qStart || triggerMins <= qEnd
      : triggerMins >= qStart && triggerMins <= qEnd;

    let finalTrigger = trigger;
    if (inQuiet) {
      finalTrigger = new Date(trigger);
      finalTrigger.setHours(Math.floor(qEnd / 60), qEnd % 60, 0, 0);
      if (finalTrigger < trigger) finalTrigger.setDate(finalTrigger.getDate() + 1);
    }

    const reminder = await Reminder.create({
      userId: req.user._id,
      notificationId: actualNotificationId,
      externalNotificationId,
      title,
      bodySummary: bodySummary || '',
      dueDateTime: due,
      triggerDateTime: finalTrigger,
      leadTimeMins: lead,
      category: category || 'OTHER',
      meetingLink: meetingLink || null,
      amount: amount || null,
      isUserCreated: true,
    });

    if (notif) {
      notif.reminderId = reminder._id;
      await notif.save();
    }

    getIO()?.to(`user:${req.user._id}`).emit('reminders:created', { reminders: [reminder] });

    res.status(201).json({ success: true, data: reminder });
  } catch (err) { next(err); }
};

// @route  GET /api/reminders/:id
const getReminder = async (req, res, next) => {
  try {
    const reminder = await Reminder.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('notificationId');
    if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found.' });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
};

// @route  PATCH /api/reminders/:id
const updateReminder = async (req, res, next) => {
  try {
    const allowed = ['title', 'bodySummary', 'dueDateTime', 'leadTimeMins', 'meetingLink', 'amount'];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    if (updates.dueDateTime) {
      const due = new Date(updates.dueDateTime);
      const lead = updates.leadTimeMins ?? 60;
      updates.triggerDateTime = new Date(due.getTime() - lead * 60 * 1000);
    }

    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updates,
      { new: true, runValidators: true }
    );
    if (!reminder) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
};

// @route  PATCH /api/reminders/:id/status
const updateStatus = async (req, res, next) => {
  try {
    const { status, snoozeUntil, userFeedback } = req.body;
    const updates = { status };
    if (status === 'SNOOZED' && snoozeUntil) updates.snoozeUntil = new Date(snoozeUntil);
    if (userFeedback) updates.userFeedback = userFeedback;

    if (status === 'DONE') {
      // Update analytics completion count
      const dateStr = new Date().toISOString().slice(0,10);
      const reminder = await Reminder.findOne({ _id: req.params.id, userId: req.user._id })
        .populate('notificationId', 'sourceApp category');
      if (reminder?.notificationId?.sourceApp) {
        await Analytics.findOneAndUpdate(
          { userId: req.user._id, date: dateStr, sourceApp: reminder.notificationId.sourceApp, category: reminder.notificationId.category },
          { $inc: { completionCount: 1 } },
          { upsert: true }
        ).catch(() => {});
      }
    }

    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updates,
      { new: true }
    );
    if (!reminder) return res.status(404).json({ success: false, message: 'Not found.' });

    getIO()?.to(`user:${req.user._id}`).emit('reminders:updated', { reminder });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
};

// @route  DELETE /api/reminders/:id
const deleteReminder = async (req, res, next) => {
  try {
    const reminder = await Reminder.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!reminder) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'Reminder deleted.' });
  } catch (err) { next(err); }
};

// @route  GET /api/reminders/upcoming
const getUpcoming = async (req, res, next) => {
  try {
    const { hours = 24 } = req.query;
    const reminders = await Reminder.find({
      userId: req.user._id,
      status: { $in: ['PENDING', 'SNOOZED'] },
      dueDateTime: { $gte: new Date(), $lte: new Date(Date.now() + parseInt(hours) * 3600 * 1000) },
    }).sort({ dueDateTime: 1 }).limit(20);
    res.json({ success: true, data: reminders });
  } catch (err) { next(err); }
};

// @route  GET /api/reminders/stats
const getReminderStats = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const [pending, done, snoozed, total] = await Promise.all([
      Reminder.countDocuments({ userId, status: 'PENDING' }),
      Reminder.countDocuments({ userId, status: 'DONE' }),
      Reminder.countDocuments({ userId, status: 'SNOOZED' }),
      Reminder.countDocuments({ userId }),
    ]);
    res.json({ success: true, data: { pending, done, snoozed, total, completionRate: total > 0 ? ((done / total) * 100).toFixed(1) : 0 } });
  } catch (err) { next(err); }
};

module.exports = { getReminders, createReminder, getReminder, updateReminder, updateStatus, deleteReminder, getUpcoming, getReminderStats };
