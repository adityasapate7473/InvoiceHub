const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Reference to User
    customerId: { type: String, required: true },
    customerName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    stateCode: { type: String, required: true },
    state: { type: String, required: true },
    district: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
    gstNumber: { type: String, required: true },
    panNumber: { type: String, required: true },
    street: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Customer', customerSchema);
