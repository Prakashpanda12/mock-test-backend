const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  examId: {
    type: String,
    required: true,
  },
  subjectTag: {
    type: String,
    required: true,
  },
  questionNumber: {
    type: Number,
    required: true,
  },
  weight: {
    type: Number,
    default: 1.0,
  },
  negativeMark: {
    type: Number,
    default: 0.25,
  },
  content: {
    en: { type: String, required: true },
    or: { type: String, default: "" },
  },
  explanation: {
    en: { type: String, default: "" },
    or: { type: String, default: "" },
  },
  options: [
    {
      index: { type: Number, required: true },
      en: { type: String, required: true },
      or: { type: String, default: "" },
    }
  ],
  correctOptionIndex: {
    type: Number,
    required: true,
  }
}, { timestamps: true });

// Compound index to ensure uniqueness of question number per exam
questionSchema.index({ examId: 1, questionNumber: 1 }, { unique: true });

const Question = mongoose.model('Question', questionSchema);
module.exports = Question;
