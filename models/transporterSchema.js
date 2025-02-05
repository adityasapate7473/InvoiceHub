const mongoose = require('mongoose');

// Transporter Schema
const transporterSchema = new mongoose.Schema({
  transporterId: { type: Number, required: true, unique: true },
  transporterName: String,
  email: String,
  phone: String,
  vehicleNumber: String,
  stateCode: String,
  state: String,
  district: String,
  city: String,
  pincode: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Transporter = mongoose.model('Transporter', transporterSchema);
module.exports = Transporter;
