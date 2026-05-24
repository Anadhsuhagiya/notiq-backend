const { UserPreference } = require('../models/Integration');

// @route  GET /api/preferences
const getPreferences = async (req, res, next) => {
  try {
    let prefs = await UserPreference.findOne({ userId: req.user._id });
    if (!prefs) prefs = await UserPreference.create({ userId: req.user._id });
    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
};

// @route  PATCH /api/preferences
const updatePreferences = async (req, res, next) => {
  try {
    const allowed = [
      'quietHoursStart', 'quietHoursEnd', 'defaultLeadTimeMins', 'retentionDays',
      'prioritySources', 'theme', 'onboardingCompleted', 'analyticsDefaultPeriod',
      'notificationSoundEnabled', 'autoCreateReminders', 'minimumConfidenceThreshold',
    ];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const prefs = await UserPreference.findOneAndUpdate(
      { userId: req.user._id },
      updates,
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
};

// @route  POST /api/preferences/reset
const resetPreferences = async (req, res, next) => {
  try {
    await UserPreference.findOneAndDelete({ userId: req.user._id });
    const prefs = await UserPreference.create({ userId: req.user._id });
    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
};

module.exports = { getPreferences, updatePreferences, resetPreferences };
