const cron = require('node-cron');
const Notification = require('../models/Notification');
const Reminder = require('../models/Reminder');
const Analytics = require('../models/Analytics');
const { Integration } = require('../models/Integration');
const { UserPreference } = require('../models/Integration');
const { getIO } = require('../sockets');
const logger = require('../utils/logger');

// ── Push pending reminders every minute ────────────────────────
const pushDueReminders = async () => {
  try {
    const now = new Date();
    const window = new Date(now.getTime() + 60 * 1000); // next 60s

    const due = await Reminder.find({
      status: 'PENDING',
      triggerDateTime: { $gte: now, $lte: window },
      isPushed: false,
    }).populate('userId', '_id');

    for (const reminder of due) {
      const io = getIO();
      if (io) {
        io.to(`user:${reminder.userId._id}`).emit('reminder:due', {
          reminderId: reminder._id,
          title: reminder.title,
          dueDateTime: reminder.dueDateTime,
          category: reminder.category,
          meetingLink: reminder.meetingLink,
        });
      }
      reminder.isPushed = true;
      await reminder.save();
    }
    if (due.length > 0) logger.info(`Pushed ${due.length} due reminders`);
  } catch (err) {
    logger.error('pushDueReminders error:', err.message);
  }
};

// ── Prune OTP notifications (older than 10 min) ────────────────
const pruneOTPs = async () => {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const result = await Notification.deleteMany({ isTransient: true, createdAt: { $lte: cutoff } });
    if (result.deletedCount > 0) logger.info(`Pruned ${result.deletedCount} OTP notifications`);
  } catch (err) {
    logger.error('pruneOTPs error:', err.message);
  }
};

// ── Daily DB prune (JUNK/PROMO older than 7d, others past retention) ─
const dailyPrune = async () => {
  try {
    const junkCutoff = new Date(Date.now() - 7 * 86400000);
    await Notification.updateMany(
      { category: { $in: ['PROMOTIONAL', 'SOCIAL'] }, timestamp: { $lte: junkCutoff } },
      { deletedAt: new Date() }
    );

    // Get per-user retention setting
    const prefs = await UserPreference.find({}, 'userId retentionDays');
    for (const pref of prefs) {
      const cutoff = new Date(Date.now() - (pref.retentionDays || 30) * 86400000);
      await Notification.updateMany(
        { userId: pref.userId, timestamp: { $lte: cutoff }, deletedAt: null },
        { deletedAt: new Date() }
      );
    }
    logger.info('Daily notification prune complete');
  } catch (err) {
    logger.error('dailyPrune error:', err.message);
  }
};

// ── OAuth token refresh (every 55 min) ─────────────────────────
const refreshExpiredTokens = async () => {
  try {
    const soon = new Date(Date.now() + 10 * 60 * 1000);
    const expiring = await Integration.find({
      isEnabled: true,
      source: { $in: ['GMAIL', 'GOOGLE_CALENDAR'] },
      tokenExpiry: { $lte: soon },
      refreshToken: { $ne: null },
    }).select('+accessToken +refreshToken');

    if (expiring.length === 0) return;

    const { google } = require('googleapis');
    for (const integration of expiring) {
      try {
        const oauth2 = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2.setCredentials({ refresh_token: integration.refreshToken });
        const { credentials } = await oauth2.refreshAccessToken();
        integration.accessToken = credentials.access_token;
        integration.tokenExpiry = new Date(credentials.expiry_date);
        integration.syncStatus = 'IDLE';
        await integration.save();
        logger.info(`Token refreshed for integration ${integration._id}`);
      } catch (e) {
        integration.syncStatus = 'TOKEN_EXPIRED';
        integration.errorMessage = e.message;
        await integration.save();
      }
    }
  } catch (err) {
    logger.error('refreshExpiredTokens error:', err.message);
  }
};

const startScheduledJobs = () => {
  // Push due reminders every minute
  cron.schedule('* * * * *', pushDueReminders);

  // Prune OTPs every 5 minutes
  cron.schedule('*/5 * * * *', pruneOTPs);

  // Daily prune at 3am
  cron.schedule('0 3 * * *', dailyPrune);

  // Token refresh every 55 minutes
  cron.schedule('*/55 * * * *', refreshExpiredTokens);

  logger.info('Scheduled jobs started: reminder-push, otp-prune, daily-prune, token-refresh');
};

module.exports = { startScheduledJobs };
