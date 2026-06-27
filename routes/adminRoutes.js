const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const mongoose = require('mongoose');
const Question = require('../models/Question');
const Exam = require('../models/Exam');
const Organization = require('../models/Organization');
const SectionMaster = require('../models/SectionMaster');
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
    const { title, durationMinutes, negativeMarking, totalQuestions, totalMarks, organization, recruitmentType, targetPosts, examCategory, sectionName, subSectionName } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: 'Exam Title is required.' });
    }

    const orgPrefix = organization ? organization.toLowerCase().replace(/[^a-z0-9]+/g, '') : 'exam';
    const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const examId = `${orgPrefix}-${baseSlug}-${randomSuffix}`;

    let finalSubSectionName = subSectionName;
    if (examCategory === 'SECTIONAL' && sectionName) {
      if (!subSectionName || subSectionName.trim() === '') {
        const lastExam = await Exam.findOne({ examCategory: 'SECTIONAL', sectionName }).sort({ createdAt: -1 });
        if (lastExam && lastExam.subSectionName) {
          const prevName = lastExam.subSectionName;
          const match = prevName.match(/^(.*)-(\d+)$/);
          if (match) {
            finalSubSectionName = `${match[1]}-${parseInt(match[2], 10) + 1}`;
          } else {
            finalSubSectionName = `${prevName}-2`;
          }
        } else {
          const count = await Exam.countDocuments({ examCategory: 'SECTIONAL', sectionName });
          finalSubSectionName = `${sectionName}-${count + 1}`;
        }
      }
    }

    const exam = await Exam.create({
      examId,
      title,
      durationMinutes: parseInt(durationMinutes) || 120,
      negativeMarking: parseFloat(negativeMarking) || 0.25,
      totalQuestions: parseInt(totalQuestions) || 0,
      totalMarks: parseInt(totalMarks) || 0,
      organization: organization || 'OSSSC',
      recruitmentType: recruitmentType || 'General',
      targetPosts: targetPosts || '',
      examCategory: examCategory || 'FULL_LENGTH',
      sectionName: examCategory === 'SECTIONAL' ? sectionName : '',
      subSectionName: examCategory === 'SECTIONAL' ? finalSubSectionName : ''
    });

    res.status(201).json({ success: true, data: exam });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Exam ID already exists.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Bulk update subSectionName for sectional exams
// @route   PUT /api/v1/admin/exams/bulk-update-subtopic
router.put('/exams/bulk-update-subtopic', async (req, res) => {
  try {
    const { sectionName, oldSubTopicName, newSubTopicName } = req.body;
    
    if (!sectionName || !oldSubTopicName || !newSubTopicName) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Also update any titles that follow the pattern "OldName - Set N" to "NewName - Set N"
    const examsToUpdate = await Exam.find({ examCategory: 'SECTIONAL', sectionName, subSectionName: oldSubTopicName });
    
    let modifiedCount = 0;
    for (const exam of examsToUpdate) {
      let newTitle = exam.title;
      // If the title starts with the old subtopic name, replace it with the new one
      if (exam.title.startsWith(oldSubTopicName)) {
        newTitle = newTitle.replace(oldSubTopicName, newSubTopicName);
      }
      exam.subSectionName = newSubTopicName;
      exam.title = newTitle;
      await exam.save();
      modifiedCount++;
    }

    res.json({ success: true, message: `Updated ${modifiedCount} sets in this sub topic.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update an exam's metadata
// @route   PUT /api/v1/admin/exams/:examId
router.put('/exams/:examId', async (req, res) => {
  try {
    const { title, durationMinutes, negativeMarking, totalQuestions, totalMarks, organization, recruitmentType, targetPosts, examCategory, sectionName, subSectionName } = req.body;
    
    let finalSubSectionName = subSectionName;
    if (examCategory === 'SECTIONAL' && sectionName) {
      if (!subSectionName || subSectionName.trim() === '') {
        const lastExam = await Exam.findOne({ examCategory: 'SECTIONAL', sectionName }).sort({ createdAt: -1 });
        if (lastExam && lastExam.subSectionName) {
          const prevName = lastExam.subSectionName;
          const match = prevName.match(/^(.*)-(\d+)$/);
          if (match) {
            finalSubSectionName = `${match[1]}-${parseInt(match[2], 10) + 1}`;
          } else {
            finalSubSectionName = `${prevName}-2`;
          }
        } else {
          const count = await Exam.countDocuments({ examCategory: 'SECTIONAL', sectionName });
          finalSubSectionName = `${sectionName}-${count + 1}`;
        }
      }
    }

    const exam = await Exam.findOneAndUpdate(
      { examId: req.params.examId },
      {
        title,
        durationMinutes: parseInt(durationMinutes) || 120,
        negativeMarking: parseFloat(negativeMarking) || 0.25,
        totalQuestions: parseInt(totalQuestions) || 0,
        totalMarks: parseInt(totalMarks) || 0,
        organization: organization || 'OSSSC',
        recruitmentType: recruitmentType || 'General',
        targetPosts: targetPosts || '',
        examCategory: examCategory || 'FULL_LENGTH',
        sectionName: examCategory === 'SECTIONAL' ? sectionName : '',
        subSectionName: examCategory === 'SECTIONAL' ? finalSubSectionName : ''
      },
      { new: true }
    );

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    res.json({ success: true, data: exam });
  } catch (error) {
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

// @desc    Bulk delete questions
// @route   POST /api/v1/admin/questions/bulk-delete
router.post('/questions/bulk-delete', async (req, res) => {
  try {
    const { questionIds } = req.body;
    
    if (!questionIds || !Array.isArray(questionIds)) {
      return res.status(400).json({ success: false, message: 'questionIds array is required' });
    }

    if (questionIds.length === 0) {
      return res.json({ success: true, message: 'No questions deleted (empty array)' });
    }

    const result = await Question.deleteMany({ _id: { $in: questionIds } });
    
    res.json({ success: true, message: `Successfully deleted ${result.deletedCount} questions.` });
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
    const processedQuestions = []; // To store and sort before returning
    const filePath = req.file.path;
    const isExcel = req.file.originalname.match(/\.xlsx?$/i);
    
    // Read a tiny bit to check if it's JSON definitively
    const fileContentStr = fs.readFileSync(filePath, 'utf8');
    const isJson = req.file.originalname.match(/\.json$/i) || 
                   req.file.mimetype === 'application/json' ||
                   fileContentStr.trim().startsWith('[') ||
                   fileContentStr.trim().startsWith('{');
    
    console.log(`[Upload] file: ${req.file.originalname}, mimetype: ${req.file.mimetype}, isJson: ${!!isJson}, isExcel: ${!!isExcel}`);

    const processRow = (row) => {
      // Remove BOM from keys if present
      const cleanRow = {};
      for (let key in row) {
        cleanRow[key.replace(/^\uFEFF/g, '').trim()] = row[key];
      }

      // Basic heuristic for unstructured JSON
      if (isJson) {
        const findKey = (keywords) => {
          const keys = Object.keys(cleanRow);
          for (let k of keys) {
            const lowerK = k.toLowerCase();
            if (keywords.some(kw => lowerK.includes(kw))) return cleanRow[k];
          }
          return undefined;
        };

        if (!cleanRow.QuestionNumber) cleanRow.QuestionNumber = findKey(['questionnumber', 'qnum', 'id', 'no', 'num']) || Math.floor(Math.random() * 10000);
        if (!cleanRow.Subject) cleanRow.Subject = findKey(['subject', 'topic', 'category', 'tag']) || 'General';
        if (!cleanRow.Question_EN) cleanRow.Question_EN = findKey(['question', 'desc', 'text', 'content']);
        if (!cleanRow.Correct_Index) cleanRow.Correct_Index = findKey(['correct', 'answer', 'ans']);
        if (!cleanRow.Opt1_EN) cleanRow.Opt1_EN = findKey(['opt1', 'option1', 'a']);
        if (!cleanRow.Opt2_EN) cleanRow.Opt2_EN = findKey(['opt2', 'option2', 'b']);
        if (!cleanRow.Opt3_EN) cleanRow.Opt3_EN = findKey(['opt3', 'option3', 'c']);
        if (!cleanRow.Opt4_EN) cleanRow.Opt4_EN = findKey(['opt4', 'option4', 'd']);
      }

      const qNum = parseInt(cleanRow.QuestionNumber);
      const correctIdx = parseInt(cleanRow.Correct_Index);
      
      if (isNaN(qNum) || isNaN(correctIdx) || correctIdx < 1 || correctIdx > 4) {
        console.warn(`[Upload Warning] Skipping invalid row: QuestionNumber=${cleanRow.QuestionNumber}, Correct_Index=${cleanRow.Correct_Index}`, cleanRow);
        skippedRows.push(cleanRow);
        return;
      }
      
      if (!cleanRow.Question_EN || !cleanRow.Opt1_EN || !cleanRow.Opt2_EN || !cleanRow.Opt3_EN || !cleanRow.Opt4_EN) {
        console.warn(`[Upload Warning] Skipping row missing mandatory English keys: QuestionNumber=${cleanRow.QuestionNumber}`);
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
        content: { en: cleanRow.Question_EN },
        explanation: {},
        options: [
          { index: 1, en: cleanRow.Opt1_EN },
          { index: 2, en: cleanRow.Opt2_EN },
          { index: 3, en: cleanRow.Opt3_EN },
          { index: 4, en: cleanRow.Opt4_EN }
        ],
        correctOptionIndex: correctIdx
      };

      // Optionally add Odia fields
      if (cleanRow.Question_OR) questionDoc.content.or = cleanRow.Question_OR;
      if (cleanRow.Explanation_EN) questionDoc.explanation.en = cleanRow.Explanation_EN;
      if (cleanRow.Explanation_OR) questionDoc.explanation.or = cleanRow.Explanation_OR;
      if (cleanRow.Opt1_OR) questionDoc.options[0].or = cleanRow.Opt1_OR;
      if (cleanRow.Opt2_OR) questionDoc.options[1].or = cleanRow.Opt2_OR;
      if (cleanRow.Opt3_OR) questionDoc.options[2].or = cleanRow.Opt3_OR;
      if (cleanRow.Opt4_OR) questionDoc.options[3].or = cleanRow.Opt4_OR;
      
      bulkOps.push({
        updateOne: {
          filter: { examId, questionNumber: qNum },
          update: { $set: questionDoc },
          upsert: true
        }
      });
      processedQuestions.push(questionDoc);
    };

    const finalizeUpload = async () => {
      if (bulkOps.length > 0) {
        await Question.bulkWrite(bulkOps);
      }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      
      // Sort processed questions by subject name
      processedQuestions.sort((a, b) => {
        const subA = a.subjectTag || '';
        const subB = b.subjectTag || '';
        return subA.localeCompare(subB);
      });

      return { success: true, count: bulkOps.length, skipped: skippedRows, sortedList: processedQuestions };
    };

    if (isJson) {
      try {
        let jsonData = JSON.parse(fileContentStr);
        if (!Array.isArray(jsonData)) {
          // If it's a single object, wrap in array. Or if it has a property containing an array, try to find it.
          if (typeof jsonData === 'object') {
            const arrValue = Object.values(jsonData).find(v => Array.isArray(v));
            if (arrValue) jsonData = arrValue;
            else jsonData = [jsonData];
          } else {
            jsonData = [];
          }
        }

        for (const row of jsonData) {
          try {
            processRow(row);
          } catch (err) {
            console.error('Row processing error:', err.message);
          }
        }
        const result = await finalizeUpload();
        return res.status(200).json({ ...result, sampleRow: jsonData[0] });
      } catch (err) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, message: 'Invalid JSON file: ' + err.message });
      }
    } else if (isExcel) {
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

      const result = await finalizeUpload();
      return res.status(200).json({ ...result, sampleRow: rows[0] });
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
            const result = await finalizeUpload();
            res.status(200).json(result);
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

// @desc    Upload questions via JSON Playground (raw JSON body)
// @route   POST /api/v1/admin/upload-questions-json
router.post('/upload-questions-json', async (req, res) => {
  const { examId, questions } = req.body;

  if (!examId || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, message: 'examId and a non-empty questions array are required.' });
  }

  try {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    const bulkOps = [];
    const skippedRows = [];
    const processedQuestions = [];

    for (const row of questions) {
      try {
        const cleanRow = { ...row };

        const qNum = parseInt(cleanRow.QuestionNumber);
        const correctIdx = parseInt(cleanRow.Correct_Index);

        if (isNaN(qNum) || isNaN(correctIdx) || correctIdx < 1 || correctIdx > 4) {
          console.warn(`[JSON Playground] Skipping invalid row: QuestionNumber=${cleanRow.QuestionNumber}, Correct_Index=${cleanRow.Correct_Index}`);
          skippedRows.push(cleanRow);
          continue;
        }

        if (!cleanRow.Question_EN || !cleanRow.Opt1_EN || !cleanRow.Opt2_EN || !cleanRow.Opt3_EN || !cleanRow.Opt4_EN) {
          console.warn(`[JSON Playground] Skipping row missing mandatory English keys: QuestionNumber=${cleanRow.QuestionNumber}`);
          skippedRows.push(cleanRow);
          continue;
        }

        const rowNegMark = cleanRow.NegativeMark ? parseFloat(cleanRow.NegativeMark) : exam.negativeMarking;

        const questionDoc = {
          examId,
          subjectTag: cleanRow.Subject || 'General',
          questionNumber: qNum,
          weight: parseFloat(cleanRow.Weight) || 1.0,
          negativeMark: rowNegMark || 0.25,
          content: { en: cleanRow.Question_EN },
          explanation: {},
          options: [
            { index: 1, en: cleanRow.Opt1_EN },
            { index: 2, en: cleanRow.Opt2_EN },
            { index: 3, en: cleanRow.Opt3_EN },
            { index: 4, en: cleanRow.Opt4_EN }
          ],
          correctOptionIndex: correctIdx
        };

        if (cleanRow.Question_OR) questionDoc.content.or = cleanRow.Question_OR;
        if (cleanRow.Explanation_EN) questionDoc.explanation.en = cleanRow.Explanation_EN;
        if (cleanRow.Explanation_OR) questionDoc.explanation.or = cleanRow.Explanation_OR;
        if (cleanRow.Opt1_OR) questionDoc.options[0].or = cleanRow.Opt1_OR;
        if (cleanRow.Opt2_OR) questionDoc.options[1].or = cleanRow.Opt2_OR;
        if (cleanRow.Opt3_OR) questionDoc.options[2].or = cleanRow.Opt3_OR;
        if (cleanRow.Opt4_OR) questionDoc.options[3].or = cleanRow.Opt4_OR;

        bulkOps.push({
          updateOne: {
            filter: { examId, questionNumber: qNum },
            update: { $set: questionDoc },
            upsert: true
          }
        });
        processedQuestions.push(questionDoc);
      } catch (err) {
        console.error('[JSON Playground] Row processing error:', err.message);
        skippedRows.push(row);
      }
    }

    if (bulkOps.length > 0) {
      await Question.bulkWrite(bulkOps);
    }

    // Sort processed questions by subject name
    processedQuestions.sort((a, b) => {
      const subA = a.subjectTag || '';
      const subB = b.subjectTag || '';
      return subA.localeCompare(subB);
    });

    res.status(200).json({
      success: true,
      count: bulkOps.length,
      skipped: skippedRows,
      sortedList: processedQuestions
    });
  } catch (error) {
    console.error('[JSON Playground] Error:', error.message);
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

// ==========================================
// MASTER DATA (ORGANIZATIONS & RECRUITMENTS)
// ==========================================

// @desc    Get all organizations and their recruitments
// @route   GET /api/v1/admin/organizations
router.get('/organizations', async (req, res) => {
  try {
    const orgs = await Organization.find().lean();
    res.json({ success: true, data: orgs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Create a new organization
// @route   POST /api/v1/admin/organizations
router.post('/organizations', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Organization name is required.' });

    const org = await Organization.create({ name, recruitments: [] });
    res.status(201).json({ success: true, data: org });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'Organization already exists.' });
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update organization
// @route   PUT /api/v1/admin/organizations/:id
router.put('/organizations/:id', async (req, res) => {
  try {
    const { name, recruitments } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (recruitments !== undefined) updateData.recruitments = recruitments;
    
    const org = await Organization.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
    res.json({ success: true, data: org });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Delete an organization
// @route   DELETE /api/v1/admin/organizations/:id
router.delete('/organizations/:id', async (req, res) => {
  try {
    const org = await Organization.findByIdAndDelete(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
    res.json({ success: true, message: 'Organization deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// MASTER DATA (SECTIONS & TOPICS)
// ==========================================

// @desc    Get all sections and their topics
// @route   GET /api/v1/admin/sections
router.get('/sections', async (req, res) => {
  try {
    const sections = await SectionMaster.find().lean();
    res.json({ success: true, data: sections });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Create a new section
// @route   POST /api/v1/admin/sections
router.post('/sections', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Section name is required.' });

    const section = await SectionMaster.create({ name, topics: [] });
    res.status(201).json({ success: true, data: section });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'Section already exists.' });
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update section
// @route   PUT /api/v1/admin/sections/:id
router.put('/sections/:id', async (req, res) => {
  try {
    const { name, topics } = req.body;
    
    const section = await SectionMaster.findById(req.params.id);
    if (!section) return res.status(404).json({ success: false, message: 'Section not found' });

    const oldName = section.name;
    let oldTopicName = null;
    let newTopicName = null;

    if (name !== undefined) {
      section.name = name;
    }
    
    if (topics !== undefined) {
      const oldTopicNames = section.topics.map(t => t.name);
      const newTopicNames = topics.map(t => t.name);
      
      const removedTopics = oldTopicNames.filter(n => !newTopicNames.includes(n));
      const addedTopics = newTopicNames.filter(n => !oldTopicNames.includes(n));
      
      if (removedTopics.length === 1 && addedTopics.length === 1) {
        oldTopicName = removedTopics[0];
        newTopicName = addedTopics[0];
      }
      section.topics = topics;
    }
    
    await section.save();

    // Cascade update to Exam collection
    if (name !== undefined && name !== oldName) {
      await Exam.updateMany(
        { sectionName: oldName },
        { $set: { sectionName: name } }
      );
    }

    if (oldTopicName && newTopicName) {
      await Exam.updateMany(
        { sectionName: section.name, subSectionName: oldTopicName },
        { $set: { subSectionName: newTopicName } }
      );
    }

    res.json({ success: true, data: section });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Delete a section
// @route   DELETE /api/v1/admin/sections/:id
router.delete('/sections/:id', async (req, res) => {
  try {
    const section = await SectionMaster.findByIdAndDelete(req.params.id);
    if (!section) return res.status(404).json({ success: false, message: 'Section not found' });
    res.json({ success: true, message: 'Section deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
