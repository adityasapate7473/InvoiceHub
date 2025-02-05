const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    invoiceNo: { type: Number, default: 1 }, // Starts at 1
    challanNo: { type: Number, default: 1 }, // Starts at 1
});

const Counter = mongoose.model('Counter', counterSchema);
module.exports = Counter;
