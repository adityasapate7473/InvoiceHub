const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
    userId: {
        type: String, // You can change it to ObjectId if you're using MongoDB's ObjectId for user references
        required: true,
    },
    businessName: String,
    gstNumber: String,
    panNumber: String,
    state: String,
    district: String,
    city: String,
    address: String,
    email: String,
    phone: String,
});

const Profile = mongoose.model('Profile', profileSchema);

module.exports = Profile;
