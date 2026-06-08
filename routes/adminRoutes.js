const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const mongoose = require('mongoose');
const Question = require('../models/Question');
const Exam = require('../models/Exam');
const { protect, authorize } = require('../middleware/authMiddleware');

const upload = multer({ dest: 'uploads/' });

// Apply auth middleware to all admin routes
router.use(protect);
router.use(authorize('admin'));

// @desc    Get stats for all exams
// @route   GET /api/v1/admin/exams-stats
router.get('/exams-stats', async (req, res) => {
  try {
    const exams = await Exam.find().lean();
    const submissions = await mongoose.model('Submission').find().lean();
    const questions = await Question.find().select('examId').lean();

    const stats = exams.map(exam => {
      const attemptedUsersCount = submissions.filter(s => s.examId === exam.examId).length;
      const uploadedQuestionsCount = questions.filter(q => q.examId === exam.examId).length;
      return {
        ...exam,
        attemptedUsersCount,
        uploadedQuestionsCount
      };
    });

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Create a new empty exam
// @route   POST /api/v1/admin/exams
router.post('/exams', async (req, res) => {
  try {
    const { title, durationMinutes, negativeMarking, totalQuestions, totalMarks } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: 'Exam Title is required.' });
    }

    const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const examId = `${baseSlug}-${randomSuffix}`;

    const exam = await Exam.create({
      examId,
      title,
      durationMinutes: parseInt(durationMinutes) || 120,
      negativeMarking: parseFloat(negativeMarking) || 0.25,
      totalQuestions: parseInt(totalQuestions) || 0,
      totalMarks: parseInt(totalMarks) || 0
    });

    res.status(201).json({ success: true, data: exam });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Exam ID already exists.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Delete an exam and all its associated questions and submissions
// @route   DELETE /api/v1/admin/exams/:examId
router.delete('/exams/:examId', async (req, res) => {
  try {
    const { examId } = req.params;

    // Delete the exam metadata
    const deletedExam = await Exam.findOneAndDelete({ examId });
    
    if (!deletedExam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    // Cascade delete associated questions
    const deletedQuestions = await Question.deleteMany({ examId });
    
    // Cascade delete associated submissions
    const deletedSubmissions = await mongoose.model('Submission').deleteMany({ examId });

    res.json({ 
      success: true, 
      message: 'Exam and all associated data deleted successfully',
      stats: {
        deletedQuestions: deletedQuestions.deletedCount,
        deletedSubmissions: deletedSubmissions.deletedCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get progress for a specific exam
// @route   GET /api/v1/admin/exams/:examId/progress
router.get('/exams/:examId/progress', async (req, res) => {
  try {
    const { examId } = req.params;
    const submissions = await mongoose.model('Submission').find({ examId }).lean();
    
    // We only need users that have a submission for this exam
    const userIds = submissions.map(s => s.userId);
    const users = await mongoose.model('User').find({ _id: { $in: userIds }, role: 'candidate' }).select('-password').lean();
    
    const progressData = users.map(user => {
      const userSub = submissions.find(s => s.userId === user._id.toString());
      
      let answeredCount = 0;
      if (userSub && userSub.responses) {
        answeredCount = userSub.responses.filter(r => 
          r.status === 'ANSWERED' || r.status === 'ANSWERED_AND_MARKED'
        ).length;
      }
      
      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        registrationNumber: user.registrationNumber,
        sessionStatus: userSub.sessionStatus,
        answeredQuestions: answeredCount,
      };
    });
    
    res.json({ success: true, data: progressData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get leaderboard for a specific exam
// @route   GET /api/v1/admin/exams/:examId/leaderboard
router.get('/exams/:examId/leaderboard', async (req, res) => {
  try {
    const { examId } = req.params;
    
    // Only fetch submitted submissions
    const submissions = await mongoose.model('Submission').find({ examId, sessionStatus: 'SUBMITTED' }).lean();
    if (submissions.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const exam = await Exam.findOne({ examId }).lean();
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const questions = await Question.find({ examId }).lean();
    
    // Pre-map questions for fast lookup
    const qMap = {};
    questions.forEach(q => {
      qMap[q._id.toString()] = {
        correctOption: q.correctOptionIndex,
        weight: q.weight || 1,
        negativeMark: q.negativeMark || exam.negativeMarking,
        subjectTag: q.subjectTag || 'General'
      };
    });

    const userIds = submissions.map(s => s.userId);
    const users = await mongoose.model('User').find({ _id: { $in: userIds } }).select('name registrationNumber').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const leaderboardData = submissions.map(sub => {
      let positiveMarks = 0;
      let negativeMarks = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      const subjects = {};

      sub.responses.forEach(response => {
        const qData = qMap[response.questionId.toString()];
        if (!qData) return;

        const subject = qData.subjectTag;
        if (!subjects[subject]) {
          subjects[subject] = { attempted: 0, positiveMarks: 0, negativeMarks: 0, score: 0 };
        }

        const isAnswered = response.status === 'ANSWERED' || response.status === 'ANSWERED_AND_MARKED';
        if (isAnswered && response.selectedOption) {
          subjects[subject].attempted++;
          if (response.selectedOption === qData.correctOption) {
            correctCount++;
            positiveMarks += qData.weight;
            subjects[subject].positiveMarks += qData.weight;
            subjects[subject].score += qData.weight;
          } else {
            incorrectCount++;
            negativeMarks += qData.negativeMark;
            subjects[subject].negativeMarks += qData.negativeMark;
            subjects[subject].score -= qData.negativeMark;
          }
        }
      });

      const totalScore = positiveMarks - negativeMarks;
      const user = userMap[sub.userId];

      return {
        _id: sub._id,
        userId: sub.userId,
        name: user?.name || 'Unknown',
        registrationNumber: user?.registrationNumber || 'N/A',
        totalScore,
        correctCount,
        incorrectCount,
        submittedAt: sub.updatedAt,
        subjects
      };
    });

    // Sort by totalScore descending, then by submittedAt ascending (faster submission wins tie)
    leaderboardData.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    });

    // Assign ranks
    leaderboardData.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    res.json({ success: true, data: leaderboardData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all questions for an exam
// @route   GET /api/v1/admin/questions/:examId
router.get('/questions/:examId', async (req, res) => {
  try {
    const questions = await Question.find({ examId: req.params.examId }).sort({ questionNumber: 1 });
    res.json({ success: true, data: questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update a question
// @route   PUT /api/v1/admin/questions/:id
router.put('/questions/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    
    res.json({ success: true, data: question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Delete a question
// @route   DELETE /api/v1/admin/questions/:id
router.delete('/questions/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    
    res.json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Bulk upload questions via CSV
// @route   POST /api/v1/admin/upload-questions
router.post('/upload-questions', upload.single('file'), async (req, res) => {
  const { examId } = req.body;
  
  if (!req.file || !examId) {
    return res.status(400).json({ success: false, message: 'Required arguments missing.' });
  }

  try {
    // Ensure exam exists and fetch its config
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    const bulkOps = [];
    const skippedRows = [];
    const filePath = req.file.path;
    const isExcel = req.file.originalname.match(/\.xlsx?$/i);

    const processRow = (row) => {
      // Remove BOM from keys if present
      const cleanRow = {};
      for (let key in row) {
        cleanRow[key.replace(/^\uFEFF/g, '').trim()] = row[key];
      }

      const qNum = parseInt(cleanRow.QuestionNumber);
      const correctIdx = parseInt(cleanRow.Correct_Index);
      
      if (isNaN(qNum) || isNaN(correctIdx) || correctIdx < 1 || correctIdx > 4) {
        console.warn(`[Upload Warning] Skipping invalid row: QuestionNumber=${cleanRow.QuestionNumber}, Correct_Index=${cleanRow.Correct_Index}`, cleanRow);
        skippedRows.push(cleanRow);
        return;
      }
      
      // Use exam's negative marking if omitted
      const rowNegMark = cleanRow.NegativeMark ? parseFloat(cleanRow.NegativeMark) : exam.negativeMarking;

      const questionDoc = {
        examId,
        subjectTag: cleanRow.Subject,
        questionNumber: qNum,
        weight: parseFloat(cleanRow.Weight) || 1.0,
        negativeMark: rowNegMark || 0.25,
        content: { en: cleanRow.Question_EN, or: cleanRow.Question_OR || "" },
        explanation: { en: cleanRow.Explanation_EN || "", or: cleanRow.Explanation_OR || "" },
        options: [
          { index: 1, en: cleanRow.Opt1_EN, or: cleanRow.Opt1_OR || "" },
          { index: 2, en: cleanRow.Opt2_EN, or: cleanRow.Opt2_OR || "" },
          { index: 3, en: cleanRow.Opt3_EN, or: cleanRow.Opt3_OR || "" },
          { index: 4, en: cleanRow.Opt4_EN, or: cleanRow.Opt4_OR || "" }
        ],
        correctOptionIndex: correctIdx
      };
      
      bulkOps.push({
        updateOne: {
          filter: { examId, questionNumber: qNum },
          update: { $set: questionDoc },
          upsert: true
        }
      });
    };

    if (isExcel) {
      const xlsx = require('xlsx');
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // By default sheet_to_json gets headers from first row
      const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
      
      for (const row of rows) {
        try {
          processRow(row);
        } catch (err) {
          console.error('Row processing error:', err.message);
        }
      }

      if (bulkOps.length > 0) {
        await Question.bulkWrite(bulkOps);
      }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(200).json({ success: true, count: bulkOps.length, skipped: skippedRows, sampleRow: rows[0] });
    } else {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          try {
            processRow(row);
          } catch (err) {
            console.error('Row processing error:', err.message);
          }
        })
        .on('end', async () => {
          try {
            if (bulkOps.length > 0) {
              await Question.bulkWrite(bulkOps);
            }
            res.status(200).json({ success: true, count: bulkOps.length });
          } catch (err) {
            console.error('Bulk write error:', err.message);
            res.status(500).json({ success: false, message: 'Database error' });
          } finally {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        });
    }
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all candidate users
// @route   GET /api/v1/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await mongoose.model('User')
      .find({ role: 'candidate' })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
    
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Toggle user active status
// @route   PUT /api/v1/admin/users/:id/toggle-status
router.put('/users/:id/toggle-status', async (req, res) => {
  try {
    const user = await mongoose.model('User').findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Prevent deactivating another admin to avoid locking everyone out
    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot deactivate an admin account' });
    }

    user.isActive = !user.isActive;
    await user.save();
    
    res.json({ success: true, data: { _id: user._id, isActive: user.isActive } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
