const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    loginAttempts: { type: Number, default: 1 },
    activityDate: { type: Date }
});

module.exports = mongoose.model('Activity', activitySchema);