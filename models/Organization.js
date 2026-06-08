const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true 
  },
  recruitments: [{
    name: { 
      type: String, 
      required: true 
    },
    posts: [{ 
      type: String 
    }]
  }]
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);
