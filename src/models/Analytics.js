const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  sourceApp: { type: String, required: true },
  category: { type: String, required: true },
  count: { type: Number, default: 0 },
  actionCount: { type: Number, default: 0 },    // notifications that created a reminder
  completionCount: { type: Number, default: 0 }, // reminders marked DONE
  hourHistogram: {
    type: [Number],
    default: () => new Array(24).fill(0),
  }, // index = hour of day (0-23)
}, {
  timestamps: true,
});

analyticsSchema.index({ userId: 1, date: 1, sourceApp: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Analytics', analyticsSchema);
