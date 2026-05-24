const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { getPreferences, updatePreferences, resetPreferences } = require('../controllers/preference.controller');

router.use(protect);
router.get('/', getPreferences);
router.patch('/', updatePreferences);
router.post('/reset', resetPreferences);

module.exports = router;
