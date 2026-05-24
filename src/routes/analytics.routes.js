const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { getSummary, getTopSenders, getDailyInsights, getWARC } = require('../controllers/analytics.controller');

router.use(protect);
router.get('/summary', getSummary);
router.get('/top-senders', getTopSenders);
router.get('/daily-insights', getDailyInsights);
router.get('/warc', getWARC);

module.exports = router;
