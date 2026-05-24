const mongoose = require('mongoose');

const STATUSES = ['PENDING', 'SNOOZED', 'DONE', 'DISMISSED', 'CALENDAR_SYNCED'];

const reminderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  notificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification',
    default: null,
  },
  externalNotificationId: {
    type: String,
    default: null,
    index: true,
  },
  title: { type: String, required: true, trim: true },
  bodySummary: { type: String, default: '' },
  dueDateTime: { type: Date, required: true, index: true },
  triggerDateTime: { type: Date, required: true }, // dueDateTime - leadTimeMins
  leadTimeMins: { type: Number, default: 60 },
  status: {
    type: String,
    enum: STATUSES,
    default: 'PENDING',
    index: true,
  },
  snoozeUntil: { type: Date, default: null },
  calendarEventId: { type: String, default: null },
  meetingLink: { type: String, default: null },
  amount: { type: Number, default: null }, // paise
  category: {
    type: String,
    enum: ['PAYMENT_DUE', 'MEETING', 'TASK', 'OTHER'],
    default: 'OTHER',
  },
  isUserCreated: { type: Boolean, default: false },
  userFeedback: {
    type: String,
    enum: ['CORRECT', 'INCORRECT', null],
    default: null,
  },
  linkedNotificationIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification',
  }], // duplicates from same payment
  isPushed: { type: Boolean, default: false }, // push notification sent
}, {
  timestamps: true,
});

// Compound indexes
reminderSchema.index({ userId: 1, dueDateTime: 1 });
reminderSchema.index({ userId: 1, status: 1, dueDateTime: 1 });
reminderSchema.index({ userId: 1, triggerDateTime: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);
