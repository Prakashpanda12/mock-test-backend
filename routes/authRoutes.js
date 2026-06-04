const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a user
// @route   POST /api/v1/auth/signup
// @access  Public
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    // Auto-generate Registration Number (e.g. 26090000 + random)
    const registrationNumber = Math.floor(26090000 + Math.random() * 9999).toString();

    const user = await User.create({
      name,
      email,
      password,
      registrationNumber
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          registrationNumber: user.registrationNumber,
          role: user.role,
          token: generateToken(user._id),
        }
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for user by email
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Check if account is deactivated
    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated by an administrator.' });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        registrationNumber: user.registrationNumber,
        role: user.role,
        token: generateToken(user._id),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get current logged in user
// @route   GET /api/v1/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
