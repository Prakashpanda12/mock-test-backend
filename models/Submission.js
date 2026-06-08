const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  examId: {
    type: String,
    required: true,
  },
  sessionStatus: {
    type: String,
    enum: ['ACTIVE', 'PAUSED', 'SUBMITTED', 'EXPIRED'],
    default: 'ACTIVE',
  },
  timestamps: {
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    pausedAt: { type: Date },
  },
  responses: [
    {
      questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
      selectedOption: { type: Number },
      status: { 
        type: String, 
        enum: ['NOT_VISITED', 'NOT_ANSWERED', 'ANSWERED', 'MARKED_FOR_REVIEW', 'ANSWERED_AND_MARKED'],
        default: 'NOT_VISITED'
      }
    }
  ]
}, { timestamps: true });

// Removed unique index to allow retaking exams

const Submission = mongoose.model('Submission', submissionSchema);
module.exports = Submission;
