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

// Define the NonGstBill schema
const NonGstBillSchema = new mongoose.Schema({
    invoiceNo: { type: String, required: true },
    challanNo: { type: String, required: true },
    date: { type: Date, default: Date.now, required: true },
    customer: {
        customerId: { type: String, required: true },
        name: { type: String, required: true },
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
NonGstBillSchema.pre('save', async function (next) {
    const NonGstBill = this;

    if (NonGstBill.isNew) {
        // Fetch the latest NonGstBill for the user to get the latest invoice and challan numbers
        const latestNonGstBill = await mongoose.model('NonGstBill').findOne({ userId: NonGstBill.userId })
            .sort({ _id: -1 }) // Sort by creation date (latest first)
            .select('invoiceNo challanNo');

        // If there are no previous NonGstBills, initialize both invoice and challan numbers as 1
        if (!latestNonGstBill) {
            NonGstBill.invoiceNo = '1';
            NonGstBill.challanNo = '1';
        } else {
            // Increment the invoice and challan numbers for the new NonGstBill
            NonGstBill.invoiceNo = (parseInt(latestNonGstBill.invoiceNo) + 1).toString();
            NonGstBill.challanNo = (parseInt(latestNonGstBill.challanNo) + 1).toString();
        }
    }
    next(); // Continue saving the NonGstBill
});

const NonGstBill = mongoose.model('NonGstBill', NonGstBillSchema);

module.exports = NonGstBill;