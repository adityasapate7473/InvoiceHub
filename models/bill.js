const mongoose = require('mongoose');

// Define the product schema
const productSchema = new mongoose.Schema({
  itemCode: { type: String, required: true },
  productName: { type: String, required: true },
  hsnCode: { type: String, required: true },
  quantity: { type: Number, required: true },
  units: { type: String, required: true },
  rate: { type: Number, required: true },
  amount: { type: Number, required: true }, // Sub-amount for the product
});

// Define the bill schema
const billSchema = new mongoose.Schema({
  invoiceNo: { type: String, required: true },
  challanNo: { type: String, required: true },
  date: { type: Date, default: Date.now, required: true },
  poNumbers: { type: [String], required: true }, // Array of P.O. numbers
  customer: {
    customerId: { type: String, required: true },
    name: { type: String, required: true },
    gstNumber: { type: String, required: true },
    pan: { type: String, required: true },
    registrationType: { type: String, required: true },
    stateCode: { type: String, required: true },
    state: { type: String, required: true },
    district: { type: String, required: true },
    city: { type: String, required: true },
    street: { type: String, required: true },
    pincode: { type: String, required: true },
    phone: { type: String, required: true },
  },
  products: {
    type: [productSchema],
    required: true, // Ensure at least one product is present
    validate: {
      validator: (value) => value.length > 0,
      message: "At least one product is required.",
    },
  },
  totalQuantity: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  gstRate: { type: Number, required: true },
  cgstAmount: { type: Number, required: true },
  sgstAmount: { type: Number, required: true },
  roundOffAmount: { type: Number, required: true },
  grandTotal: { type: Number, required: true },
  transporter: {
    name: { type: String, required: true },
    vehicleNumber: { type: String, required: true },
  },
  amountInWords: { type: String, required: true },
  status: { type: String, default: 'active', required: true }, // 'active' or 'deleted'
  userId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, required: true }, // Ensure createdAt is always set
});

// Pre-save hook to increment invoice and challan numbers for each user
billSchema.pre('save', async function (next) {
  const bill = this;

  // Fetch the latest bill for the user to get the latest invoice and challan numbers
  const latestBill = await mongoose.model('Bill').findOne({ userId: bill.userId })
    .sort({ _id: -1 }) // Sort by creation date (latest first)
    .select('invoiceNo challanNo');

  // Only increment invoiceNo and challanNo for new documents
  if (bill.isNew) {
    // Fetch the latest bill for the user to get the latest invoice and challan numbers
    const latestBill = await mongoose.model('Bill').findOne({ userId: bill.userId })
      .sort({ _id: -1 }) // Sort by creation date (latest first)
      .select('invoiceNo challanNo');
    // If there are no previous bills, initialize both invoice and challan numbers as 1
    if (!latestBill) {
      bill.invoiceNo = '1';
      bill.challanNo = '1';
    } else {
      // Increment the invoice and challan numbers for the new bill
      bill.invoiceNo = (parseInt(latestBill.invoiceNo) + 1).toString();
      bill.challanNo = (parseInt(latestBill.challanNo) + 1).toString();
    }
  }
  next(); // Continue saving the bill
});
const Bill = mongoose.model('Bill', billSchema);

module.exports = Bill;