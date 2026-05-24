// reminder.routes.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { getReminders, createReminder, getReminder, updateReminder, updateStatus, deleteReminder, getUpcoming, getReminderStats } = require('../controllers/reminder.controller');

router.use(protect);
router.get('/', getReminders);
router.post('/', createReminder);
router.get('/upcoming', getUpcoming);
router.get('/stats', getReminderStats);
router.get('/:id', getReminder);
router.patch('/:id', updateReminder);
router.patch('/:id/status', updateStatus);
router.delete('/:id', deleteReminder);

module.exports = router;
