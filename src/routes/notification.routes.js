const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getNotifications, bulkIngest, getNotification,
  markRead, markAllRead, submitFeedback,
  deleteNotification, getUnreadCount,
} = require('../controllers/notification.controller');

router.use(protect);

router.get('/', getNotifications);
router.post('/', require('../controllers/notification.controller').analyzeAndStore);
router.post('/bulk', bulkIngest);
router.post('/analyze', require('../controllers/notification.controller').analyzeAndStore);
router.get('/unread-count', getUnreadCount);
router.patch('/read-all', markAllRead);
router.get('/:id', getNotification);
router.patch('/:id/read', markRead);
router.patch('/:id/feedback', submitFeedback);
router.delete('/:id', deleteNotification);

module.exports = router;
