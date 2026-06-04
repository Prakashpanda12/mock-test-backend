const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const Question = require('./models/Question');

dotenv.config();

const seedData = [
  {
    examId: 'osssc_nursing_2026',
    subjectTag: 'Arithmetic',
    questionNumber: 1,
    weight: 1.0,
    negativeMark: 0.25,
    content: {
      en: 'If a sum of money doubles itself in 8 years at simple interest, what is the rate of interest?',
      or: 'ଯଦି କୌଣସି ମୂଳଧନ ସରଳ ସୁଧରେ ୮ ବର୍ଷରେ ଦ୍ୱିଗୁଣିତ ହୁଏ, ତେବେ ସୁଧର ହାର କେତେ?'
    },
    options: [
      { index: 1, en: '10.5%', or: '୧୦.୫%' },
      { index: 2, en: '12.5%', or: '୧୨.୫%' },
      { index: 3, en: '15.0%', or: '୧୫.୦%' },
      { index: 4, en: '16.2%', or: '୧୬.୨%' }
    ],
    correctOptionIndex: 2
  },
  {
    examId: 'osssc_nursing_2026',
    subjectTag: 'Arithmetic',
    questionNumber: 2,
    weight: 1.0,
    negativeMark: 0.25,
    content: {
      en: 'What is the square root of 144?',
      or: '144 ର ବର୍ଗମୂଳ କେତେ?'
    },
    options: [
      { index: 1, en: '10', or: '10' },
      { index: 2, en: '12', or: '12' },
      { index: 3, en: '14', or: '14' },
      { index: 4, en: '16', or: '16' }
    ],
    correctOptionIndex: 2
  }
];

const seedDatabase = async () => {
  try {
    await connectDB();
    
    const count = await Question.countDocuments({ examId: 'osssc_nursing_2026' });
    if (count === 0) {
      console.log('Seeding initial questions...');
      await Question.insertMany(seedData);
      console.log('Database seeded successfully.');
    } else {
      console.log('Database already has data. No seeding necessary.');
    }
  } catch (err) {
    console.error('Error seeding data:', err);
  } finally {
    mongoose.connection.close();
  }
};

seedDatabase();
