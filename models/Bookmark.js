const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true,
  },
  examId: {
    type: String,
    required: true,
  }
}, { timestamps: true });

// One bookmark per user per question
bookmarkSchema.index({ userId: 1, questionId: 1 }, { unique: true });

// Fast lookup: all bookmarks for a user in an exam
bookmarkSchema.index({ userId: 1, examId: 1 });

const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
module.exports = Bookmark;
