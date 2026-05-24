const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { getIntegrations, getGmailAuthUrl, handleGmailCallback, syncGmail, createCalendarEvent, disconnectIntegration, saveGoogleToken } = require('../controllers/integration.controller');

router.get('/gmail/callback', handleGmailCallback);

router.use(protect);

router.post('/gmail/sync', protect, syncGmail);
router.post('/google/save-token', protect, saveGoogleToken);
router.get('/gmail/auth-url', protect, getGmailAuthUrl);
router.get('/', protect, getIntegrations);
router.post('/calendar/create-event', protect, createCalendarEvent);
router.delete('/:source/disconnect', protect, disconnectIntegration);

module.exports = router;
