// auth.routes.js
const router = require('express').Router();
const { body } = require('express-validator');
const { register, login, refreshToken, logout, getMe, updateMe, saveBackupMetadata, getBackupMetadata } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');

router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
], register);

router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty(),
], login);

router.post('/refresh', refreshToken);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.patch('/me', protect, updateMe);

router.post('/backup', protect, saveBackupMetadata);
router.get('/backup', protect, getBackupMetadata);

module.exports = router;
