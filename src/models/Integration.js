const mongoose = require('mongoose');

// ── Integration ────────────────────────────────────────────────
const integrationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  source: {
    type: String,
    enum: ['GMAIL', 'GOOGLE_CALENDAR', 'SMS', 'NOTIF_LISTENER'],
    required: true,
  },
  isEnabled: { type: Boolean, default: false },
  // OAuth fields (only for GMAIL / GOOGLE_CALENDAR)
  accessToken: { type: String, select: false },
  refreshToken: { type: String, select: false },
  tokenExpiry: { type: Date, default: null },
  accountEmail: { type: String, default: null },
  scopeGrants: [{ type: String }],
  // Sync status
  syncStatus: {
    type: String,
    enum: ['IDLE', 'SYNCING', 'ERROR', 'TOKEN_EXPIRED'],
    default: 'IDLE',
  },
  lastSyncAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
}, {
  timestamps: true,
});

integrationSchema.index({ userId: 1, source: 1 }, { unique: true });

const Integration = mongoose.model('Integration', integrationSchema);

// ── UserPreference ─────────────────────────────────────────────
const userPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  quietHoursStart: { type: Number, default: 1320 }, // 22:00 in minutes since midnight
  quietHoursEnd: { type: Number, default: 420 },    // 07:00
  defaultLeadTimeMins: { type: Number, default: 60 },
  retentionDays: { type: Number, default: 30 },
  prioritySources: [{ type: String }],
  theme: {
    type: String,
    enum: ['LIGHT', 'DARK', 'SYSTEM'],
    default: 'DARK',
  },
  onboardingCompleted: { type: Boolean, default: false },
  analyticsDefaultPeriod: {
    type: String,
    enum: ['TODAY', 'WEEK', 'MONTH', 'CUSTOM'],
    default: 'WEEK',
  },
  notificationSoundEnabled: { type: Boolean, default: true },
  autoCreateReminders: { type: Boolean, default: true },
  minimumConfidenceThreshold: { type: Number, default: 0.75 },
}, {
  timestamps: true,
});

const UserPreference = mongoose.model('UserPreference', userPreferenceSchema);

module.exports = { Integration, UserPreference };
