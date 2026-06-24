const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  }
});

const sectionMasterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  topics: [topicSchema]
}, { timestamps: true });

module.exports = mongoose.model('SectionMaster', sectionMasterSchema);
