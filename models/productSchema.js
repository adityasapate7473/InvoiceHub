const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
  },
  itemCode: {
    type: String,
    required: true,
  },
  productName: {
    type: String,
    required: true,
  },
  hsnCode: {
    type: String,
    required: true,
  },
  rate: {
    type: Number,
    required: true,
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure productId is unique for each user
productSchema.index({ productId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
