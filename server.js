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
connectDB().then(async () => {
  // Seed default admin robustly
  await User.findOneAndUpdate(
    { registrationNumber: 'ADMIN_001' },
    {
      $setOnInsert: {
        name: 'System Admin',
        email: 'admin@osssc.gov',
        password: 'Admin@123',
        role: 'admin'
      }
    },
    { upsert: true }
  );
  console.log('Default Admin check complete.');
});

const app = express();

// Security middleware
app.use(helmet());

// Enable CORS
app.use(cors());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`));
