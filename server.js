const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const User = require('./models/User');

// Route files
const adminRoutes = require('./routes/adminRoutes');
const examRoutes = require('./routes/examRoutes');
const authRoutes = require('./routes/authRoutes');

// Load env vars
dotenv.config();

// Connect to database
const app = express();

// Security middleware
app.use(helmet());

// Enable CORS
const allowedOrigins = ['http://localhost:5173', 'http://localhost:8081', 'https://test-yari.netlify.app'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Mount routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/exam', examRoutes);

// Base route
app.get('/', (req, res) => {
  res.send('OSSSC CBT API is running...');
});

connectDB().then(async () => {
  // Seed default admin robustly
  await User.findOneAndUpdate(
    { registrationNumber: 'ADMIN_001' },
    {
      $setOnInsert: {
        name: 'System Admin',
        email: 'admin@gmail.com',
        password: 'Admin@123',
        role: 'admin'
      }
    },
    { upsert: true }
  );
  console.log('Default Admin check complete.');

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`));
}).catch(err => {
  console.error('Failed to start server due to database connection issue:', err.message);
  process.exit(1);
});
