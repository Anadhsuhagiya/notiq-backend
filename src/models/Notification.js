const mongoose = require('mongoose');

const CATEGORIES = ['PAYMENT_DUE', 'MEETING', 'TASK', 'SOCIAL', 'PROMOTIONAL', 'OTP', 'OTHER'];
const SOURCE_TYPES = ['SMS', 'GMAIL', 'WHATSAPP', 'INSTAGRAM', 'LINKEDIN', 'SNAPCHAT', 'TELEGRAM', 'SLACK', 'NOTIF_LISTENER', 'SERVICE', 'OTHER_APP'];

const entitySchema = new mongoose.Schema({
  amount: { type: Number, default: null },           // paise
  dueDate: { type: Date, default: null },
  meetingLink: { type: String, default: null },
  urgencyScore: { type: Number, min: 0, max: 1, default: 0 },
  extractedDateRaw: { type: String, default: null },
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sourceApp: {
    type: String,
    required: true,
    index: true,
  },
  sourceType: {
    type: String,
    enum: SOURCE_TYPES,
    default: 'NOTIF_LISTENER',
    required: true,
    index: true,
  },
  sender: { type: String, default: null },
  senderKey: { type: String, default: null, index: true }, // normalized: phone/email
  title: { type: String, default: '' },
  body: { type: String, required: true },
  timestamp: { type: Date, required: true, index: true },
  category: {
    type: String,
    enum: CATEGORIES,
    default: 'OTHER',
    index: true,
  },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  isRead: { type: Boolean, default: false, index: true },
  isTransient: { type: Boolean, default: false }, // OTPs
  isTruncated: { type: Boolean, default: false }, // WA/IG truncated previews
  reminderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Reminder',
    default: null,
  },
  fingerprint: {
    type: String,
    default: null,
    index: true,
    sparse: true,
  }, // SHA-256(senderKey + amount + dateBucket) for deduplication
  entities: { type: entitySchema, default: () => ({}) },
  userFeedback: {
    type: String,
    enum: ['CORRECT', 'INCORRECT', null],
    default: null,
  },
  deletedAt: { type: Date, default: null }, // soft delete
  externalId: {
    type: String,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound indexes for common queries
notificationSchema.index({ userId: 1, timestamp: -1 });
notificationSchema.index({ userId: 1, category: 1, timestamp: -1 });
notificationSchema.index({ userId: 1, sourceType: 1, timestamp: -1 });
notificationSchema.index({ userId: 1, isRead: 1, timestamp: -1 });

// Text index for full-text search
notificationSchema.index({ body: 'text', sender: 'text', title: 'text' });

// Auto-delete OTP after 10 minutes
notificationSchema.index({ createdAt: 1 }, {
  expireAfterSeconds: 600,
  partialFilterExpression: { isTransient: true },
});

module.exports = mongoose.model('Notification', notificationSchema);
