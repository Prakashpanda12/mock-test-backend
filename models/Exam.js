const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  examId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  durationMinutes: {
    type: Number,
    required: true,
    default: 120
  },
  negativeMarking: {
    type: Number,
    default: 0.25
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  totalMarks: {
    type: Number,
    required: true
  },
  organization: {
    type: String,
    default: 'OSSSC'
  },
  recruitmentType: {
    type: String,
    default: 'General'
  },
  targetPosts: {
    type: String,
    default: ''
  },
  examCategory: {
    type: String,
    enum: ['FULL_LENGTH', 'SECTIONAL'],
    default: 'FULL_LENGTH'
  },
  sectionName: {
    type: String,
    default: ''
  },
  subSectionName: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema);
