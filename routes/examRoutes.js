const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const Exam = require('../models/Exam');
const { protect, authorize } = require('../middleware/authMiddleware');

// Protect all exam routes and restrict to candidates
router.use(protect);
router.use(authorize('candidate'));

// Get list of all available exams
router.get('/list', async (req, res) => {
  try {
    const exams = await Exam.find({});
    res.json({ success: true, data: exams });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get metadata for a specific exam
router.get('/:examId/meta', async (req, res) => {
  try {
    const { examId } = req.params;
    const exam = await Exam.findOne({ examId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    res.json({ success: true, data: exam });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get questions for a specific exam
router.get('/:examId/questions', async (req, res) => {
  try {
    const { examId } = req.params;
    const questions = await Question.find({ examId }).sort({ questionNumber: 1 });
    
    // Do not return correctOptionIndex to the client
    const sanitizedQuestions = questions.map(q => {
      const qObj = q.toObject();
      delete qObj.correctOptionIndex;
      return qObj;
    });

    res.json({ success: true, data: sanitizedQuestions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get practice questions for a specific exam (includes answers)
router.get('/:examId/practice-questions', async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = req.user._id;

    // Verify user has submitted this exam at least once
    const submission = await Submission.findOne({ userId, examId, sessionStatus: 'SUBMITTED' });
    if (!submission) {
      return res.status(403).json({ success: false, message: 'You must complete the official exam first before practicing.' });
    }

    const questions = await Question.find({ examId }).sort({ questionNumber: 1 });
    // For practice, we DO NOT strip out correctOptionIndex or explanation
    res.json({ success: true, data: questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Sync exam server time (for absolute timer)
router.get('/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

// Create or update a candidate session
router.post('/:examId/session', async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = req.user._id;

    const exam = await Exam.findOne({ examId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    
    const durationMinutes = exam.durationMinutes;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60000);

    // Look for an existing ACTIVE or PAUSED session
    let session = await Submission.findOne({ userId, examId, sessionStatus: { $in: ['ACTIVE', 'PAUSED'] } });
    let isNewSession = false;
    
    if (!session) {
      // Create a brand new session for this attempt
      session = await Submission.create({
        userId,
        examId,
        sessionStatus: 'ACTIVE',
        timestamps: { startedAt: now, expiresAt }
      });
      isNewSession = true;
    } else if (session.sessionStatus === 'PAUSED') {
      // Resume the paused session
      const pausedAt = session.timestamps.pausedAt ? new Date(session.timestamps.pausedAt).getTime() : now.getTime();
      const previousExpiresAt = new Date(session.timestamps.expiresAt).getTime();
      const remainingTime = Math.max(0, previousExpiresAt - pausedAt);
      
      session.sessionStatus = 'ACTIVE';
      session.timestamps.expiresAt = new Date(now.getTime() + remainingTime);
      session.timestamps.pausedAt = undefined;
      await session.save();
    }

    res.json({ success: true, data: session, isNewSession });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Pause session
router.post('/:examId/pause', async (req, res) => {
  try {
    const { examId } = req.params;
    const { userId, responses } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    const session = await Submission.findOne({ userId, examId, sessionStatus: 'ACTIVE' });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Active session not found' });
    }

    session.sessionStatus = 'PAUSED';
    session.timestamps.pausedAt = new Date();
    if (responses) {
      session.responses = responses;
    }
    await session.save();

    res.json({ success: true, message: 'Exam paused successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Final submission
router.post('/:examId/submit', async (req, res) => {
  try {
    const { examId } = req.params;
    const { userId, responses } = req.body;

    if (!userId || !responses) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    // Update all active sessions to handle any race condition duplicates
    const updateResult = await Submission.updateMany(
      { userId, examId, sessionStatus: 'ACTIVE' },
      {
        $set: {
          sessionStatus: 'SUBMITTED',
          responses,
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Active session not found' });
    }

    res.json({ success: true, message: 'Exam submitted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get detailed result scorecard
router.get('/:examId/result', async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = req.user._id;

    // Get the LATEST SUBMITTED submission so we never get blocked by an active retake attempt!
    const submission = await Submission.findOne({ userId, examId, sessionStatus: 'SUBMITTED' }).sort({ createdAt: -1 });
    
    if (!submission) {
      return res.status(404).json({ success: false, message: 'No submitted scorecard found.' });
    }

    const exam = await Exam.findOne({ examId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const questions = await Question.find({ examId }).lean();
    
    let correctCount = 0, incorrectCount = 0, unansweredCount = 0;
    let positiveMarks = 0, negativeMarks = 0;

    const qMap = {};
    questions.forEach(q => {
      qMap[q._id.toString()] = {
        correctOption: q.correctOptionIndex,
        weight: q.weight || 1,
        negativeMark: q.negativeMark || exam.negativeMarking,
        subjectTag: q.subjectTag || 'General'
      };
    });

    const subjects = {};

    submission.responses.forEach(response => {
      const qIdStr = response.questionId.toString();
      const qData = qMap[qIdStr];
      if (!qData) return;

      const subject = qData.subjectTag;
      if (!subjects[subject]) {
        subjects[subject] = { totalQuestions: 0, correct: 0, incorrect: 0, unanswered: 0, score: 0 };
      }
      subjects[subject].totalQuestions++;

      const isAnswered = response.status === 'ANSWERED' || response.status === 'ANSWERED_AND_MARKED';
      if (isAnswered && response.selectedOption) {
        if (response.selectedOption === qData.correctOption) {
          correctCount++;
          positiveMarks += qData.weight;
          subjects[subject].correct++;
          subjects[subject].score += qData.weight;
        } else {
          incorrectCount++;
          negativeMarks += qData.negativeMark;
          subjects[subject].incorrect++;
          subjects[subject].score -= qData.negativeMark;
        }
      } else {
        unansweredCount++;
        subjects[subject].unanswered++;
      }
    });

    const totalScore = positiveMarks - negativeMarks;

    const scorecard = {
      examTitle: exam.title,
      totalQuestions: exam.totalQuestions,
      totalMarks: exam.totalMarks,
      correctCount,
      incorrectCount,
      unansweredCount,
      positiveMarks,
      negativeMarks,
      totalScore,
      submittedAt: submission.updatedAt,
      subjects
    };

    res.json({ success: true, data: scorecard });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get detailed review for submitted exam
router.get('/:examId/review', async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = req.user._id;

    // Get the LATEST SUBMITTED submission
    const submission = await Submission.findOne({ userId, examId, sessionStatus: 'SUBMITTED' }).sort({ createdAt: -1 });
    if (!submission) {
      return res.status(404).json({ success: false, message: 'No submitted scorecard found.' });
    }

    const exam = await Exam.findOne({ examId });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const questions = await Question.find({ examId }).sort({ questionNumber: 1 }).lean();

    res.json({ 
      success: true, 
      data: {
        exam,
        questions,
        responses: submission.responses
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get performance analytics across all submitted exams
router.get('/my-performance', async (req, res) => {
  try {
    const userId = req.user._id;
    // Get all SUBMITTED submissions sorted chronologically
    const submissions = await Submission.find({ userId, sessionStatus: 'SUBMITTED' }).sort({ createdAt: 1 }).lean();
    
    if (submissions.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Get unique examIds to fetch exam data in one go
    const examIds = [...new Set(submissions.map(s => s.examId))];
    const exams = await Exam.find({ examId: { $in: examIds } }).lean();
    const questions = await Question.find({ examId: { $in: examIds } }).lean();

    // Pre-map exams and questions for fast lookup
    const examMap = {};
    exams.forEach(e => { examMap[e.examId] = e; });

    const qMap = {};
    questions.forEach(q => {
      qMap[q._id.toString()] = {
        examId: q.examId,
        correctOption: q.correctOptionIndex,
        weight: q.weight || 1,
        negativeMark: q.negativeMark,
        subjectTag: q.subjectTag || 'General'
      };
    });

    const performanceData = submissions.map((sub, index) => {
      const exam = examMap[sub.examId];
      if (!exam) return null;

      let positiveMarks = 0;
      let negativeMarks = 0;
      const subjects = {};

      sub.responses.forEach(response => {
        const qData = qMap[response.questionId.toString()];
        if (!qData) return;

        const subject = qData.subjectTag;
        if (!subjects[subject]) {
          subjects[subject] = { totalQuestions: 0, correct: 0, incorrect: 0, unanswered: 0, score: 0 };
        }
        subjects[subject].totalQuestions++;

        const isAnswered = response.status === 'ANSWERED' || response.status === 'ANSWERED_AND_MARKED';
        if (isAnswered && response.selectedOption) {
          if (response.selectedOption === qData.correctOption) {
            positiveMarks += qData.weight;
            subjects[subject].correct++;
            subjects[subject].score += qData.weight;
          } else {
            const negMark = qData.negativeMark || exam.negativeMarking;
            negativeMarks += negMark;
            subjects[subject].incorrect++;
            subjects[subject].score -= negMark;
          }
        } else {
          subjects[subject].unanswered++;
        }
      });

      const totalScore = positiveMarks - negativeMarks;

      return {
        _id: sub._id,
        attemptNumber: index + 1, // Overall attempt across all exams
        examTitle: exam.title,
        examId: exam.examId,
        totalScore,
        maxMarks: exam.totalMarks,
        submittedAt: sub.updatedAt,
        subjects
      };
    }).filter(Boolean);

    res.json({ success: true, data: performanceData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
