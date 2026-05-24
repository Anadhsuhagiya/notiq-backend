const { google } = require('googleapis');
const { Integration } = require('../models/Integration');
const logger = require('../utils/logger');

const getOAuthClient = async (userId) => {
  try {
    const integration = await Integration.findOne({ 
      userId, 
      source: 'GOOGLE_CALENDAR',
      isEnabled: true 
    }).select('+accessToken +refreshToken');

    if (!integration || !integration.refreshToken) {
      return null;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: integration.accessToken,
      refresh_token: integration.refreshToken,
      expiry_date: integration.tokenExpiry?.getTime()
    });

    return oauth2Client;
  } catch (error) {
    logger.error('Failed to get Google Calendar OAuth Client:', error);
    return null;
  }
};

const createEvent = async (userId, eventData) => {
  try {
    const auth = await getOAuthClient(userId);
    if (!auth) {
      logger.warn(`Calendar integration not active for user: ${userId}`);
      return null;
    }

    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary: eventData.title,
      location: eventData.location || '',
      description: eventData.description || 'Created via NotiQ AI',
      start: {
        dateTime: eventData.startTime, // ISO string
        timeZone: 'UTC',
      },
      end: {
        dateTime: eventData.endTime, // ISO string
        timeZone: 'UTC',
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'email', minutes: 30 },
        ],
      },
      conferenceData: eventData.meetingLink ? {
        createRequest: {
          requestId: `notiq-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      } : null
    };

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
    });

    return res.data;
  } catch (error) {
    logger.error('Failed to create Calendar event:', error);
    return null;
  }
};

module.exports = { createEvent };
