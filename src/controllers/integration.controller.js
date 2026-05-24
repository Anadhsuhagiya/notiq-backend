const { google } = require('googleapis');
const { Integration } = require('../models/Integration');
const Notification = require('../models/Notification');
const { classifyNotification, computeFingerprint } = require('../services/ai.service');
const logger = require('../utils/logger');

const getOAuthClient = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// @route  GET /api/integrations
const getIntegrations = async (req, res, next) => {
  try {
    const integrations = await Integration.find({ userId: req.user._id });
    res.json({ success: true, data: integrations });
  } catch (err) { next(err); }
};

// @route  GET /api/integrations/gmail/auth-url
const getGmailAuthUrl = async (req, res, next) => {
  try {
    const oauth2 = getOAuthClient();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      scope: [...GMAIL_SCOPES, ...CALENDAR_SCOPES],
      prompt: 'consent',
      state: req.user._id.toString(),
    });
    res.json({ success: true, data: { url } });
  } catch (err) { next(err); }
};

// @route  GET /api/integrations/gmail/callback  (OAuth redirect)
const handleGmailCallback = async (req, res, next) => {
  try {
    const { code, state: userId } = req.query;
    if (!code) return res.status(400).json({ success: false, message: 'No code received.' });

    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: profile } = await oauth2Api.userinfo.get();

    const now = new Date();
    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(now.getTime() + 3600*1000);

    // Upsert Gmail integration
    await Integration.findOneAndUpdate(
      { userId, source: 'GMAIL' },
      { isEnabled: true, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiry: expiry, accountEmail: profile.email, scopeGrants: GMAIL_SCOPES, syncStatus: 'IDLE', errorMessage: null },
      { upsert: true, new: true }
    );

    // Upsert Calendar integration if scope granted
    if (tokens.scope?.includes('calendar')) {
      await Integration.findOneAndUpdate(
        { userId, source: 'GOOGLE_CALENDAR' },
        { isEnabled: true, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiry: expiry, accountEmail: profile.email, scopeGrants: CALENDAR_SCOPES, syncStatus: 'IDLE' },
        { upsert: true, new: true }
      );
    }

    // Redirect to app deep link
    res.redirect(`notiq://auth/callback?success=true&email=${encodeURIComponent(profile.email)}`);
  } catch (err) { next(err); }
};

// @route  POST /api/integrations/gmail/sync — manual sync trigger
const syncGmail = async (req, res, next) => {
  try {
    const integration = await Integration.findOne({ userId: req.user._id, source: 'GMAIL', isEnabled: true }).select('+accessToken +refreshToken');
    if (!integration) return res.status(404).json({ success: false, message: 'Gmail not connected.' });

    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ access_token: integration.accessToken, refresh_token: integration.refreshToken });

    // Refresh token if expired
    if (integration.tokenExpiry && new Date() >= integration.tokenExpiry) {
      const { credentials } = await oauth2.refreshAccessToken();
      integration.accessToken = credentials.access_token;
      integration.tokenExpiry = new Date(credentials.expiry_date);
      await integration.save();
      oauth2.setCredentials(credentials);
    }

    await Integration.findByIdAndUpdate(integration._id, { syncStatus: 'SYNCING' });

    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const sinceDate = integration.lastSyncAt
      ? `after:${Math.floor(integration.lastSyncAt.getTime()/1000)}`
      : 'newer_than:7d';

    const { data: msgList } = await gmail.users.messages.list({
      userId: 'me',
      q: `is:unread ${sinceDate}`,
      maxResults: 50,
    });

    let created = 0;
    if (msgList.messages) {
      for (const msg of msgList.messages.slice(0, 30)) {
        try {
          const { data: full } = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          });

          const headers = full.payload?.headers || [];
          const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
          const from = headers.find((h) => h.name === 'From')?.value || '';
          const dateStr = headers.find((h) => h.name === 'Date')?.value;
          const body = full.snippet || '';
          const senderKey = from.match(/<(.+)>/)?.[1] || from.trim();

          const classification = await classifyNotification(subject, body);
          const fingerprint = computeFingerprint(senderKey, classification.entities.amount, classification.entities.dueDate);

          if (fingerprint) {
            const exists = await Notification.findOne({ userId: req.user._id, fingerprint });
            if (exists) continue;
          }

          await Notification.create({
            userId: req.user._id,
            sourceApp: 'com.google.android.gm',
            sourceType: 'GMAIL',
            sender: from,
            senderKey,
            title: subject,
            body,
            timestamp: dateStr ? new Date(dateStr) : new Date(),
            category: classification.category,
            confidence: classification.confidence,
            isTransient: false,
            fingerprint,
            entities: classification.entities,
          });
          created++;
        } catch (e) { logger.warn(`Gmail msg error: ${e.message}`); }
      }
    }

    await Integration.findByIdAndUpdate(integration._id, { syncStatus: 'IDLE', lastSyncAt: new Date(), errorMessage: null });
    res.json({ success: true, data: { synced: created } });
  } catch (err) {
    await Integration.findOneAndUpdate({ userId: req.user._id, source: 'GMAIL' }, { syncStatus: 'ERROR', errorMessage: err.message });
    next(err);
  }
};

// @route  POST /api/integrations/calendar/create-event
const createCalendarEvent = async (req, res, next) => {
  try {
    const { reminderId, summary, description, startDateTime, endDateTime, meetingLink } = req.body;
    const integration = await Integration.findOne({ userId: req.user._id, source: 'GOOGLE_CALENDAR', isEnabled: true }).select('+accessToken +refreshToken');
    if (!integration) return res.status(404).json({ success: false, message: 'Google Calendar not connected.' });

    const oauth2 = getOAuthClient();
    oauth2.setCredentials({ access_token: integration.accessToken, refresh_token: integration.refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
    const eventBody = {
      summary,
      description,
      start: { dateTime: new Date(startDateTime).toISOString() },
      end: { dateTime: new Date(endDateTime || new Date(startDateTime).getTime() + 3600000).toISOString() },
    };

    if (meetingLink) {
      eventBody.description = `${description || ''}\n\nJoin: ${meetingLink}`;
    }

    const { data: event } = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });

    // Update reminder with calendar event ID
    if (reminderId) {
      const Reminder = require('../models/Reminder');
      await Reminder.findOneAndUpdate({ _id: reminderId, userId: req.user._id }, { calendarEventId: event.id, status: 'CALENDAR_SYNCED' });
    }

    res.json({ success: true, data: { eventId: event.id, htmlLink: event.htmlLink } });
  } catch (err) { next(err); }
};

// @route  DELETE /api/integrations/:source/disconnect
const disconnectIntegration = async (req, res, next) => {
  try {
    const { source } = req.params;
    await Integration.findOneAndUpdate(
      { userId: req.user._id, source: source.toUpperCase() },
      { isEnabled: false, accessToken: null, refreshToken: null, tokenExpiry: null, syncStatus: 'IDLE' }
    );
    res.json({ success: true, message: `${source} disconnected.` });
  } catch (err) { next(err); }
};

// @route  POST /api/integrations/google/save-token
const saveGoogleToken = async (req, res, next) => {
  try {
    const { email, accessToken, refreshToken } = req.body;
    
    // Upsert both GMAIL and GOOGLE_CALENDAR integrations
    const now = new Date();
    const expiry = new Date(now.getTime() + 3600 * 1000); // Default 1h

    await Integration.findOneAndUpdate(
      { userId: req.user._id, source: 'GMAIL' },
      { 
        isEnabled: true, 
        accessToken, 
        refreshToken: refreshToken || undefined, 
        accountEmail: email,
        tokenExpiry: expiry,
        syncStatus: 'IDLE' 
      },
      { upsert: true }
    );

    await Integration.findOneAndUpdate(
      { userId: req.user._id, source: 'GOOGLE_CALENDAR' },
      { 
        isEnabled: true, 
        accessToken, 
        refreshToken: refreshToken || undefined, 
        accountEmail: email,
        tokenExpiry: expiry,
        syncStatus: 'IDLE' 
      },
      { upsert: true }
    );

    res.json({ success: true, message: 'Google tokens saved successfully.' });
  } catch (err) { next(err); }
};

module.exports = { getIntegrations, getGmailAuthUrl, handleGmailCallback, syncGmail, createCalendarEvent, disconnectIntegration, saveGoogleToken };
