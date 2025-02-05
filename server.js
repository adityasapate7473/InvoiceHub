const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const exphbs = require('express-handlebars');
const hbs = require('handlebars');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { Auth } = require("two-step-auth");
const MongoDBStore = require('connect-mongodb-session')(session);
require("dotenv").config();



const User = require('./models/User');
const Bill = require('./models/bill');
const NonGstBill = require('./models/nongstbill');
const Product = require('./models/productSchema');
const Customer = require('./models/customerSchema');
const Transporter = require('./models/transporterSchema');
const Profile = require('./models/Profile'); // Import Profile model


const app = express();
const port = process.env.PORT || 7000;
const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/invoicehub";

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected Successfully"))
    .catch(err => console.error("MongoDB Connection Error:", err));


// Setup Handlebars engine and partials
app.engine('hbs', exphbs.engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, '/views/layouts'),
    partialsDir: path.join(__dirname, '/views/partials'),
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

hbs.registerPartial('navbar', fs.readFileSync('views/partials/navbar.hbs', 'utf8'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/public')));

const store = new MongoDBStore({
    uri: mongoURI,
    collection: "sessions",
});

// Configure session
app.use(session({
    secret: process.env.SESSION_SECRET || "secretkey",
    resave: false,
    saveUninitialized: false,
    store: store, // Use MongoDB session store
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1-day session expiration
}));

// Middleware to pass user data to views
app.use((req, res, next) => {
    if (req.session && req.session.userName) {
        res.locals.userName = req.session.userName; // Makes userName accessible globally
    } else {
        res.locals.userName = 'Guest'; // Default fallback if user is not logged in
    }
    next();
});


app.get('/check-session', (req, res) => {
    if (req.session.userId) {
        res.send('User ID exists in session: ' + req.session.userId);
    } else {
        res.send('User is not authenticated');
    }
});


// Routes
app.get('/', (req, res) => {
    if (req.session.userName) {
        return res.redirect('/home'); // Redirect to /home if logged in
    }
    res.render('index'); // Render the index.hbs view for unauthenticated users
});

// Route to handle the authenticated dashboard
app.get('/home', async (req, res) => {
    if (!req.session.userName || !req.session.userId) {
        return res.redirect('/'); // Redirect to login if session is missing
    }

    try {
        const userId = req.session.userId; // Retrieve the logged-in user's ID from the session

        // Fetch data for the specific user
        const numCustomers = await Customer.countDocuments({ userId });
        const numBills = await Bill.countDocuments({ userId });
        const numNonBills = await NonGstBill.countDocuments({ userId });
        const totalBills = numBills + numNonBills;
        const numTransporters = await Transporter.countDocuments({ userId });
        const numProducts = await Product.countDocuments({ userId });

        // Calculate total sales (GST bills only) for the user
        const totalSales = await Bill.aggregate([
            { $match: { userId } }, // Filter by userId
            { $group: { _id: null, total: { $sum: '$grandTotal' } } },
        ]);

        // Calculate total GST collected (sum of CGST and SGST) for the user
        const totalGST = await Bill.aggregate([
            { $match: { userId } }, // Filter by userId
            {
                $group: {
                    _id: null,
                    totalGST: { $sum: { $add: ['$cgstAmount', '$sgstAmount'] } },
                },
            },
        ]);

        // Fetch Non-GST details from NonGstBill schema for the user
        const nonGSTBills = await NonGstBill.find({ userId });
        const noGSTSales = nonGSTBills.reduce((sum, bill) => sum + bill.grandTotal, 0);
        const nonGSTBillsGenerated = nonGSTBills.length;

        // Fetch pending invoices and calculate due amount for the user
        const pendingInvoices = await Bill.find({ userId, status: 'pending' });
        const dueAmount = pendingInvoices.reduce((sum, bill) => sum + bill.amount, 0);

        // Fetch upcoming deliveries for the user
        const upcomingDeliveries = await Bill.find({
            userId,
            deliveryDate: { $gte: new Date() },
        })
            .sort({ deliveryDate: 1 })
            .limit(1);

        const nextDeliveryDate = upcomingDeliveries[0]?.deliveryDate || 'N/A';

        // Render the dashboard template with user-specific data
        res.render('home', {
            numCustomers,
            numBills,
            totalBills,
            numTransporters,
            numProducts,
            totalSales: totalSales[0]?.total || 0,
            totalGST: totalGST[0]?.totalGST || 0,
            noGSTSales,
            nonGSTBillsGenerated,
            pendingInvoices: pendingInvoices.length,
            dueAmount,
            nextDeliveryDate,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading dashboard data');
    }
});


// Serve login page
app.get('/login', (req, res) => {
    res.render('login'); // Render login.hbs from views folder
});


// User login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({ msg: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid email or password' });
        }

        // Store user data in session
        req.session.userName = user.name;
        req.session.userId = user.id;

        res.status(200).json({ msg: 'Successfully logged in!' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Serve the signup page
app.get('/signup', (req, res) => {
    res.render('signup'); // Render signup.hbs from the views folder
});


// User signup
app.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create a new user
        const newUser = new User({
            name,
            email,
            password: hashedPassword,
        });

        await newUser.save();

        // Send a success response
        res.status(201).json({ msg: 'User registered successfully!' });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ msg: 'Server error. Please try again later.' });
    }
});



// home route
app.get('/home', (req, res) => {
    if (!req.session.userName) {
        return res.redirect('/login'); // Redirect to login if not authenticated
    }
    res.render('home'); // Render home view with userName
});

// Serve the Generate GST bill page
app.get('/generate-gst-bill', (req, res) => {
    res.render('generate-gst-bill'); // Render signup.hbs from the views folder
});

// Serve the Generate Non GST bill page
app.get('/generate-non-gst-bill', (req, res) => {
    res.render('generate-non-gst-bill'); // Render signup.hbs from the views folder
});

// Serve the bill History page
app.get('/history', (req, res) => {
    res.render('history'); // Render signup.hbs from the views folder
});



// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).send('Logout failed');
        }
        res.redirect('/login');
    });
});

app.post('/generate-gst-bill', async (req, res) => {
    const {
        date, poNumbers, customer, products,
        gstRate, transporter, amountInWords
    } = req.body;

    // Get the userId from the session
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Validate required fields
    if (!date || !customer || !Array.isArray(products) || products.length === 0 || !gstRate || !transporter || !amountInWords) {
        return res.status(400).json({ success: false, message: 'All fields are required. Please fill in all the details.' });
    }

    if (!poNumbers || !Array.isArray(poNumbers) || poNumbers.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one P.O. number is required.' });
    }

    // Parse the date string into a valid Date object
    const formattedDate = new Date(date.split('-').reverse().join('-')); // Converts '15-12-2024' to '2024-12-15'

    if (isNaN(formattedDate)) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Please use DD-MM-YYYY.' });
    }

    // Calculate total quantity and amount
    let totalQuantity = 0;
    let totalAmount = 0;
    products.forEach(product => {
        if (product.quantity && product.amount) {
            totalQuantity += product.quantity;
            totalAmount += product.amount; // Assuming amount is provided in the product object
        }
    });

    if (totalAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Total amount must be greater than zero.' });
    }

    // Calculate GST (CGST and SGST)
    const cgstAmount = (totalAmount * (gstRate / 100)) / 2;
    const sgstAmount = cgstAmount;

    // Calculate grand total and round-off amount
    const roundOffAmount = Math.round(totalAmount + cgstAmount + sgstAmount) - (totalAmount + cgstAmount + sgstAmount);
    const grandTotal = totalAmount + cgstAmount + sgstAmount + roundOffAmount;

    // Fetch the latest bill for the user to get the current invoiceNo and challanNo
    let lastBill = await Bill.findOne({ userId }).sort({ createdAt: -1 }); // Sort by createdAt, latest first

    let invoiceNo = '1'; // Default starting point for invoice number
    let challanNo = '1'; // Default starting point for challan number

    if (lastBill) {
        // Increment the latest invoiceNo and challanNo
        invoiceNo = (parseInt(lastBill.invoiceNo) + 1).toString();
        challanNo = (parseInt(lastBill.challanNo) + 1).toString();
    }

    const validProducts = products.filter(product => product.amount > 0); // Only keep products with valid amounts

    // Create a new Bill with the updated invoiceNo and challanNo
    const newBill = new Bill({
        invoiceNo,
        challanNo,
        date: formattedDate,
        poNumbers,
        customer,
        products: validProducts,
        totalQuantity,
        totalAmount,
        gstRate,
        cgstAmount,
        sgstAmount,
        roundOffAmount,
        grandTotal,
        transporter,
        amountInWords,
        userId, // Save the userId from session
    });

    try {
        // Save the bill to the database
        const savedBill = await newBill.save();
        res.status(200).json({ success: true, bill: savedBill });
    } catch (error) {
        console.error('Error saving bill:', error);
        res.status(500).json({ success: false, message: 'Error saving bill' });
    }
});

app.get('/get-next-numbers', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    try {
        // Fetch the latest bill for the user to get the current invoiceNo and challanNo
        const lastBill = await Bill.findOne({ userId }).sort({ _id: -1 }); // Sort by createdAt, latest first

        let nextInvoiceNo = '1'; // Default starting point
        let nextChallanNo = '1'; // Default starting point

        if (lastBill) {
            // If a bill exists, increment the latest numbers
            nextInvoiceNo = (parseInt(lastBill.invoiceNo, 10) + 1).toString();
            nextChallanNo = (parseInt(lastBill.challanNo, 10) + 1).toString();
        }

        res.json({ success: true, nextInvoiceNo, nextChallanNo });
    } catch (error) {
        console.error('Error fetching next numbers:', error);
        res.status(500).json({ success: false, message: 'Error fetching next numbers' });
    }
});

app.post('/generate-non-gst-bill', async (req, res) => {
    const {
        date, customer, products,
        transporter, amountInWords
    } = req.body;

    // Get the userId from the session
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Validate required fields
    if (!date || !customer || !Array.isArray(products) || products.length === 0 || !transporter || !amountInWords) {
        return res.status(400).json({ success: false, message: 'All fields are required. Please fill in all the details.' });
    }

    // Parse the date string into a valid Date object
    const formattedDate = new Date(date.split('-').reverse().join('-')); // Converts '15-12-2024' to '2024-12-15'

    if (isNaN(formattedDate)) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Please use DD-MM-YYYY.' });
    }

    // Calculate total quantity and amount
    let totalQuantity = 0;
    let totalAmount = 0;
    products.forEach(product => {
        if (product.quantity && product.amount) {
            totalQuantity += product.quantity;
            totalAmount += product.amount; // Assuming amount is provided in the product object
        }
    });

    if (totalAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Total amount must be greater than zero.' });
    }

    // Calculate grand total and round-off amount
    const roundOffAmount = Math.round(totalAmount) - (totalAmount);
    const grandTotal = totalAmount + roundOffAmount;

    // Fetch the latest bill for the user to get the current invoiceNo and challanNo
    let lastBill = await NonGstBill.findOne({ userId }).sort({ createdAt: -1 }); // Sort by createdAt, latest first

    let invoiceNo = '1'; // Default starting point for invoice number
    let challanNo = '1'; // Default starting point for challan number

    if (lastBill) {
        // Increment the latest invoiceNo and challanNo
        invoiceNo = (parseInt(lastBill.invoiceNo) + 1).toString();
        challanNo = (parseInt(lastBill.challanNo) + 1).toString();
    }

    const validProducts = products.filter(product => product.amount > 0); // Only keep products with valid amounts

    // Create a new Bill with the updated invoiceNo and challanNo
    const newBill = new NonGstBill({
        invoiceNo,
        challanNo,
        date: formattedDate,
        customer,
        products: validProducts,
        totalQuantity,
        totalAmount,
        roundOffAmount,
        grandTotal,
        transporter,
        amountInWords,
        userId, // Save the userId from session
    });

    try {
        // Save the bill to the database
        const savedBill = await newBill.save();
        res.status(200).json({ success: true, bill: savedBill });
    } catch (error) {
        console.error('Error saving bill:', error);
        res.status(500).json({ success: false, message: 'Error saving bill' });
    }
});

app.get('/get-non-gst-next-numbers', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    try {
        // Fetch the latest bill for the user to get the current invoiceNo and challanNo
        const lastBill = await NonGstBill.findOne({ userId }).sort({ _id: -1 }); // Sort by createdAt, latest first

        let nextInvoiceNo = '1'; // Default starting point
        let nextChallanNo = '1'; // Default starting point

        if (lastBill) {
            // If a bill exists, increment the latest numbers
            nextInvoiceNo = (parseInt(lastBill.invoiceNo, 10) + 1).toString();
            nextChallanNo = (parseInt(lastBill.challanNo, 10) + 1).toString();
        }

        res.json({ success: true, nextInvoiceNo, nextChallanNo });
    } catch (error) {
        console.error('Error fetching next numbers:', error);
        res.status(500).json({ success: false, message: 'Error fetching next numbers' });
    }
});

// Fetch customers for the logged-in user
app.get('/get-customers', async (req, res) => {
    try {
        // Check if userId exists in the session
        const userId = req.session?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: User not logged in' });
        }

        // Fetch customers for the logged-in user
        const customers = await Customer.find({ userId }).select('-sensitiveField');
        res.json({ success: true, customers });
    } catch (err) {
        console.error('Error fetching customers:', err);
        res.status(500).json({ success: false, message: 'Error fetching customers' });
    }
});

// Route to serve bill list page
app.get('/bill-list', async (req, res) => {
    res.render('bill-list');
});

// Retrieve all active bills for the logged-in user
// Retrieve active bills with filters
app.get('/get-bills', async (req, res) => {
    const userId = req.session.userId;
    const { startDate, endDate, customerName } = req.query;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const query = { userId, status: 'active' };

    // Apply date filter if provided
    if (startDate && endDate) {
        query.date = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
        };
    }

    // Apply customer name filter if provided
    if (customerName) {
        query['customer.name'] = { $regex: customerName, $options: 'i' }; // Case-insensitive search
    }

    try {
        const bills = await Bill.find(query);

        if (!bills.length) {
            return res.status(404).json({ success: false, message: 'No active bills found' });
        }

        res.status(200).json({ success: true, bills });
    } catch (error) {
        console.error('Error fetching bills:', error);
        res.status(500).json({ success: false, message: 'Error fetching bills' });
    }
});

// Define the API route to fetch owner details by session
app.get('/owner', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        console.log('User ID not found in session');
        return res.status(401).json({ error: 'Unauthorized. Please log in first.' });
    }

    try {
        // Fetch the owner details from the database using session userId
        const owner = await Profile.findOne({ userId });

        // If owner details are found, return them as a JSON response
        if (owner) {
            console.log('Owner details found:', owner);
            res.status(200).json({ success: true, owner });
        } else {
            console.log('No owner details found for userId:', userId);
            res.status(404).json({ error: 'Owner details not found' });
        }
    } catch (err) {
        console.error('Error fetching owner details:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



// Render the edit-bill page
app.get('/edit-bill/:billId', async (req, res) => {
    const { billId } = req.params;

    if (!ObjectId.isValid(billId)) {
        return res.status(400).send('Invalid Bill ID');
    }

    try {
        const bill = await Bill.findOne({ _id: new ObjectId(billId) });

        if (!bill) {
            return res.status(404).send('Bill not found!');
        }

        res.render('edit-bill', { bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).send('Server error');
    }
});

// Fetch a specific bill
app.get('/get-bill/:billId', async (req, res) => {
    const { billId } = req.params;

    if (!ObjectId.isValid(billId)) {
        return res.status(400).json({ success: false, message: 'Invalid Bill ID' });
    }

    try {
        const bill = await Bill.findOne({ _id: new ObjectId(billId) });

        if (!bill) {
            return res.status(404).json({ success: false, message: 'Bill not found' });
        }

        res.json({ success: true, bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/update-bill/:billId', async (req, res) => {
    const billId = req.params.billId;
    const billData = req.body; // Get the data from the request body

    // Validate the required fields
    const { poNumbers, date, customer, products, gstRate, totalAmount, grandTotal, roundOffAmount, amountInWords, transporter, totalQuantity } = billData;

    if (!date || !customer || !products || !gstRate || !totalAmount || !grandTotal || !amountInWords || !transporter || typeof totalQuantity === 'undefined') {
        return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
    }

    // Validate customer details
    if (!customer.name || !customer.gstNumber || !customer.pan || !customer.stateCode || !customer.state || !customer.district || !customer.city || !customer.street || !customer.pincode || !customer.phone) {
        return res.status(400).json({ success: false, message: 'Customer details are incomplete.' });
    }

    // Validate product details
    if (!Array.isArray(products) || products.length === 0 || products.some(product => !product.itemCode || !product.productName || !product.quantity || !product.rate || !product.amount)) {
        return res.status(400).json({ success: false, message: 'Products are required and must have valid fields.' });
    }

    // Validate the date format
    const formattedDate = new Date(date.split('-').reverse().join('-')); // Convert 'DD-MM-YYYY' to 'YYYY-MM-DD'
    if (isNaN(formattedDate)) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Please use DD-MM-YYYY.' });
    }

    try {

        // Retrieve the bill by ID
        const bill = await Bill.findById(billId);

        if (!bill) {
            return res.status(404).json({ success: false, message: 'Bill not found.' });
        }

        // Update the bill fields with the new data
        bill.poNumbers = poNumbers;
        bill.date = formattedDate;
        bill.customer = customer;
        bill.products = products;
        bill.totalQuantity = totalQuantity;
        bill.gstRate = gstRate;
        bill.totalAmount = totalAmount;
        bill.grandTotal = grandTotal;
        bill.roundOffAmount = roundOffAmount;
        bill.amountInWords = amountInWords;
        bill.transporter = transporter;

        // Save the updated bill
        await bill.save();

        // Respond with success
        res.json({ success: true, message: 'Bill updated successfully!' });
    } catch (error) {
        console.error('Error updating bill:', error);
        res.status(500).json({ success: false, message: 'Failed to update bill. Please try again.' });
    }
});

// Delete a bill (soft delete by updating the status)
app.delete('/delete-bill/:billId', async (req, res) => {
    try {
        const bill = await Bill.findByIdAndUpdate(req.params.billId, { status: 'inactive' }, { new: true });

        if (!bill) {
            return res.status(404).json({ success: false, message: 'Bill not found' });
        }

        res.json({ success: true, message: 'Bill deleted successfully' });
    } catch (err) {
        console.error('Error deleting bill:', err);
        res.status(500).json({ success: false, message: 'Error deleting bill' });
    }
});

// Route to serve the print bill page (HTML)
app.get('/print-bill', (req, res) => {
    res.render('print-bill');  // Ensure 'print-bill' is a valid template file
});

// Fetch bill details from database using the billId
// Render the print-bill page
app.get('/print-bill/:billId', async (req, res) => {
    const { billId } = req.params;
    try {
        const bill = await Bill.findOne({ _id: new ObjectId(billId) });

        if (!bill) {
            return res.status(404).send('Bill not found!');
        }

        res.render('print-bill', { bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).send('Server error');
    }
});


// Route to serve Non GST bill list page
app.get('/non-gst-bill-list', async (req, res) => {
    res.render('non-gst-bill-list');
});

// Retrieve all active bills for the logged-in user
app.get('/get-non-gst-bills', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    try {
        const bills = await NonGstBill.find({ userId, status: 'active' });

        if (!bills.length) {
            return res.status(404).json({ success: false, message: 'No active bills found' });
        }

        res.status(200).json({ success: true, bills });
    } catch (error) {
        console.error('Error fetching bills:', error);
        res.status(500).json({ success: false, message: 'Error fetching bills' });
    }
});


// Render the edit-bill page
app.get('/edit-non-gst-bill/:billId', async (req, res) => {
    const { billId } = req.params;

    if (!ObjectId.isValid(billId)) {
        return res.status(400).send('Invalid Bill ID');
    }

    try {
        const bill = await NonGstBill.findOne({ _id: new ObjectId(billId) });

        if (!bill) {
            return res.status(404).send('Bill not found!');
        }

        res.render('edit-non-gst-bill', { bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).send('Server error');
    }
});

// Fetch a specific bill
app.get('/get-non-gst-bill/:billId', async (req, res) => {
    const { billId } = req.params;

    if (!ObjectId.isValid(billId)) {
        return res.status(400).json({ success: false, message: 'Invalid Bill ID' });
    }

    try {
        const bill = await NonGstBill.findOne({ _id: new ObjectId(billId) });

        if (!bill) {
            return res.status(404).json({ success: false, message: 'Bill not found' });
        }

        res.json({ success: true, bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/update-non-gst-bill/:billId', async (req, res) => {
    const billId = req.params.billId;
    const billData = req.body; // Get the data from the request body

    console.log("Received Bill Data: ", billData);  // Log the received data

    // Validate the required fields
    const { date, customer, products, totalAmount, grandTotal, roundOffAmount, amountInWords, transporter, totalQuantity } = billData;

    if (!date || !customer || !products || !totalAmount || !grandTotal || !amountInWords || !transporter || typeof totalQuantity === 'undefined') {
        return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
    }

    // Validate customer details
    if (!customer.name || !customer.stateCode || !customer.state || !customer.district || !customer.city || !customer.street || !customer.pincode || !customer.phone) {
        return res.status(400).json({ success: false, message: 'Customer details are incomplete.' });
    }

    // Validate product details
    if (!Array.isArray(products) || products.length === 0 || products.some(product => !product.itemCode || !product.productName || !product.quantity || !product.rate || !product.amount)) {
        return res.status(400).json({ success: false, message: 'Products are required and must have valid fields.' });
    }

    // Validate the date format
    const formattedDate = new Date(date.split('-').reverse().join('-')); // Convert 'DD-MM-YYYY' to 'YYYY-MM-DD'
    if (isNaN(formattedDate)) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Please use DD-MM-YYYY.' });
    }

    try {

        // Retrieve the bill by ID
        const bill = await NonGstBill.findById(billId);

        if (!bill) {
            return res.status(404).json({ success: false, message: 'Bill not found.' });
        }

        // Update the bill fields with the new data
        bill.date = formattedDate;
        bill.customer = customer;
        bill.products = products;
        bill.totalQuantity = totalQuantity;
        bill.totalAmount = totalAmount;
        bill.grandTotal = grandTotal;
        bill.roundOffAmount = roundOffAmount;
        bill.amountInWords = amountInWords;
        bill.transporter = transporter;

        // Save the updated bill
        await bill.save();

        // Respond with success
        res.json({ success: true, message: 'Bill updated successfully!' });
    } catch (error) {
        console.error('Error updating bill:', error);
        res.status(500).json({ success: false, message: 'Failed to update bill. Please try again.' });
    }
});


// Delete a bill (soft delete by updating the status)
app.delete('/delete-non-gst-bill/:billId', async (req, res) => {
    try {
        const bill = await NonGstBill.findByIdAndUpdate(req.params.billId, { status: 'inactive' }, { new: true });

        if (!bill) {
            return res.status(404).json({ success: false, message: 'Bill not found' });
        }

        res.json({ success: true, message: 'Bill deleted successfully' });
    } catch (err) {
        console.error('Error deleting bill:', err);
        res.status(500).json({ success: false, message: 'Error deleting bill' });
    }
});

// Route to serve the print bill page (HTML)
app.get('/print-non-gst-bill', (req, res) => {
    res.render('print-non-gst-bill');  // Ensure 'print-bill' is a valid template file
});

// Fetch bill details from database using the billId
// Render the print-bill page
app.get('/print-non-gst-bill/:billId', async (req, res) => {
    const { billId } = req.params;
    try {
        const bill = await NonGstBill.findOne({ _id: new ObjectId(billId) });

        if (!bill) {
            return res.status(404).send('Bill not found!');
        }

        res.render('print-non-gst-bill', { bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).send('Server error');
    }
});

app.get('/get-next-product-id', async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            return res.status(403).json({ success: false, message: 'User not authenticated' });
        }

        // Fetch the last product for the logged-in user
        const lastProduct = await Product.findOne({ userId }).sort({ productId: -1 });
        let nextProductId = 1001; // Default starting ID
        if (lastProduct) {
            nextProductId = parseInt(lastProduct.productId) + 1;
        }

        res.status(200).json({ success: true, nextProductId });
    } catch (error) {
        console.error('Error fetching next product ID:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});



// Route to serve product registration page
app.get('/register-product', async (req, res) => {
    res.render('register-product');
});

// Route to register a product
app.post('/register-product', async (req, res) => {
    const { itemCode, productName, hsnCode, rate } = req.body;
    const userId = req.session.userId;
    if (!userId) {
        return res.status(403).json({ success: false, message: 'User not authenticated' });
    }

    try {
        // Fetch the last product for the logged-in user
        const lastProduct = await Product.findOne({ userId }).sort({ productId: -1 });

        let nextProductId = 1001; // Default starting ID
        if (lastProduct) {
            nextProductId = parseInt(lastProduct.productId) + 1;
        }

        // Create and save the new product
        const newProduct = new Product({
            productId: nextProductId.toString(),
            itemCode,
            productName,
            hsnCode,
            rate,
            userId,
        });

        await newProduct.save();

        res.status(200).json({
            success: true,
            message: 'Product registered successfully',
            product: newProduct,
        });
    } catch (error) {
        console.error('Error saving product:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Route to serve product List page
app.get('/product-list', async (req, res) => {
    res.render('product-list');
});

const { ObjectId } = require('mongodb');

app.get('/edit-product', async (req, res) => {
    const { productId } = req.query;

    if (!ObjectId.isValid(productId)) {
        return res.status(400).send('Invalid Product ID');
    }

    try {
        const product = await Product.findOne({ _id: new ObjectId(productId) });

        if (!product) {
            return res.status(404).send('Product not found!');
        }

        res.render('edit-product', { product });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).send('Server error');
    }
});

// Route to serve the edit page
app.get('/edit-product/:productId', async (req, res) => {
    const { productId } = req.query;

    if (!ObjectId.isValid(productId)) {
        return res.status(400).send('Invalid Product ID');
    }

    try {
        const product = await Product.findOne({ _id: new ObjectId(productId) });

        if (!product) {
            return res.status(404).send('Product not found!');
        }

        res.render('edit-product', { product });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).send('Server error');
    }
});

// Update product route
app.put('/update-product/:productId', async (req, res) => {
    const { productId } = req.params;
    const { itemCode, productName, hsnCode, rate } = req.body;

    // Validation: Check if product data is provided
    if (!itemCode || !productName || !hsnCode || !rate) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    try {
        // Find the product by productId
        const product = await Product.findOne({ productId: productId });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Update product details
        product.itemCode = itemCode;
        product.productName = productName;
        product.hsnCode = hsnCode;
        product.rate = rate;

        // Save the updated product
        await product.save();

        // Send success response
        res.json({ success: true, product, message: 'Product updated successfully' });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ success: false, message: 'Server error, please try again later' });
    }
});

app.get('/get-products', async (req, res) => {
    try {
        // Check if userId exists in the session
        const userId = req.session?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: User not logged in' });
        }

        // Fetch products for the logged-in user
        const products = await Product.find({ userId }).select('-sensitiveField');
        res.json({ success: true, products });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ success: false, message: 'Error fetching products' });
    }
});

app.get('/get-product/:productId', async (req, res) => {
    const { productId } = req.params;

    try {
        const product = await Product.findOne({ _id: new ObjectId(productId) });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.json({ success: true, product });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Example Express.js route for deleting a product
app.delete('/delete-product/:productId', async (req, res) => {
    const { productId } = req.params;
    try {
        await Product.findByIdAndDelete(productId); // Assuming you're using MongoDB
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: 'Error deleting product' });
    }
});


// Route to serve Customer Registration page
app.get('/register-customer', async (req, res) => {
    res.render('register-customer');
});


app.get('/get-next-customer-id', async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            return res.status(403).json({ success: false, message: 'User not authenticated' });
        }

        const lastCustomer = await Customer.findOne({ userId }).sort({ customerId: -1 });
        let nextCustomerId = 1001;
        if (lastCustomer) {
            nextCustomerId = parseInt(lastCustomer.customerId) + 1;
        }

        res.status(200).json({ success: true, nextCustomerId });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


app.post('/register-customer', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { customerId, customerName, email, phone, stateCode, state, district, city, pincode, gstNumber, panNumber, street } = req.body;

    if (!customerId || !customerName || !email || !phone || !stateCode || !state || !district || !city || !pincode || !gstNumber || !panNumber || !street) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    try {
        const existingCustomer = await Customer.findOne({ email });
        if (existingCustomer) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }

        const newCustomer = new Customer({
            userId: req.session.userId,
            customerId,
            customerName,
            email,
            phone,
            stateCode,
            state,
            district,
            city,
            pincode,
            gstNumber,
            panNumber,
            street,
        });

        await newCustomer.save();

        res.status(200).json({ success: true, message: 'Customer registered successfully', customer: newCustomer });
    } catch (error) {
        console.error('Error saving customer:', error);
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Email already exists' }); // Handle duplicate email error
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});



// Route to serve Customer List Page
app.get('/customer-list', async (req, res) => {
    res.render('customer-list');
});

// Example Express.js route for fetching Customers
app.get('/customers', async (req, res) => {
    try {
        // Check if userId exists in the session
        const userId = req.session?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: User not logged in' });
        }

        // Fetch customers for the logged-in user
        const customers = await Customer.find({ userId }).select('-sensitiveField');
        res.json({ success: true, customers });
    } catch (err) {
        console.error('Error fetching customers:', err);
        res.status(500).json({ success: false, message: 'Error fetching customers' });
    }
});

// Example Express.js route for fetching products for the logged-in user
app.get('/products', async (req, res) => {
    try {
        const userId = req.session?.userId;
        if (!userId) {
            console.error("User not logged in");
            return res.status(401).json({ success: false, message: 'Unauthorized: User not logged in' });
        }

        // Fetch products from the database
        const products = await Product.find({ userId }).select('-sensitiveField');

        console.log("Fetched products from the database:", products); // Log fetched products

        if (!products || products.length === 0) {
            return res.status(404).json({ success: false, message: 'No products found for the user' });
        }

        res.json({ success: true, products });
    } catch (err) {
        console.error('Error fetching products:', err); // Log error message
        res.status(500).json({ success: false, message: 'Error fetching products', error: err.message });
    }
});

// Route to serve Edit Customer  Page
app.get('/edit-customer', async (req, res) => {
    const { customerId } = req.query;

    if (!ObjectId.isValid(customerId)) {
        return res.status(400).send('Invalid Customer ID');
    }

    try {
        const customer = await Product.findOne({ _id: new ObjectId(customerId) });

        if (!customerId) {
            return res.status(404).send('Customer not found!');
        }

        res.render('edit-customer', { customer });
    } catch (error) {
        console.error('Error fetching Customer:', error);
        res.status(500).send('Server error');
    }
});

// Route to fetch customer data by customerId
app.get('/get-customer/:customerId', async (req, res) => {
    const { customerId } = req.params;

    try {
        // Fetch customer from the database
        const customer = await Customer.findById(customerId);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        res.json({ success: true, customer });
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/update-customer/:customerId', async (req, res) => {
    const { customerId } = req.params;
    const { customerName, email, phone, gstNumber, panNumber, state, district, city, street, pincode } = req.body;

    try {
        const customer = await Customer.findByIdAndUpdate(
            customerId,
            { customerName, email, phone, gstNumber, panNumber, state, district, city, street, pincode },
            { new: true } // Return the updated customer document
        );

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        res.json({ success: true, customer });
    } catch (error) {
        console.error('Error updating customer:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


app.delete('/delete-customer/:customerId', async (req, res) => {
    const { customerId } = req.params;

    try {
        const customer = await Customer.findByIdAndDelete(customerId);
        if (customer) {
            res.json({ success: true, message: 'Customer deleted successfully.' });
        } else {
            res.json({ success: false, message: 'Customer not found.' });
        }
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});


// Route to serve Customer Registration page
app.get('/register-transporter', async (req, res) => {
    res.render('register-transporter');
});

// Transporter Registration Route
app.post('/register-transporter', async (req, res) => {
    console.log(req.body);  // Log the incoming request body
    const { transporterName, email, phone, vehicleNumber, stateCode, state, district, city, pincode } = req.body;

    // Check if the user is logged in (session exists)
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Retrieve user ID from session
    const userId = req.session.userId;

    try {
        // Find the last transporter for this user
        const lastTransporter = await Transporter.findOne({ userId }).sort({ transporterId: -1 });
        let nextTransporterId = 1001; // Default starting ID
        if (lastTransporter) {
            nextTransporterId = lastTransporter.transporterId + 1;
        }

        const newTransporter = new Transporter({
            transporterId: nextTransporterId,
            transporterName,
            email,
            phone,
            vehicleNumber,
            stateCode,
            state,
            district,
            city,
            pincode,
            userId
        });

        await newTransporter.save();
        res.json({ success: true, message: 'Transporter registered successfully.' }); // Send success response
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Error saving transporter data' }); // Send failure response
    }
});


app.get('/get-next-transporter-id', async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            return res.status(403).json({ success: false, message: 'User not authenticated' });
        }

        const lastTransporter = await Transporter.findOne({ userId }).sort({ transporterId: -1 });
        let nextTransporterId = 1001;
        if (lastTransporter) {
            nextTransporterId = lastTransporter.transporterId + 1;
        }

        res.status(200).json({ success: true, nextTransporterId });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


// Transporter List Route
app.get('/transporter-list', async (req, res) => {
    try {
        const transporters = await Transporter.find();
        res.render('transporter-list', { transporters }); // Render a transporter list view
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Fetch all transporters for the logged-in user
app.get('/get-transporters', (req, res) => {
    const userId = req.session.userId;  // Get userId from the session

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not logged in' });
    }

    // Fetch transporters for the logged-in user
    Transporter.find({ userId })
        .then(transporters => {
            res.json({ success: true, transporters });
        })
        .catch(error => {
            console.error(error);
            res.status(500).json({ success: false, message: 'Failed to fetch transporters.' });
        });
});


app.get('/get-transporter/:transporterId', async (req, res) => {
    const { transporterId } = req.params;

    if (!ObjectId.isValid(transporterId)) {
        return res.status(400).json({ success: false, message: 'Invalid Transporter ID' });
    }

    try {
        const transporter = await Transporter.findOne({ _id: new ObjectId(transporterId) });

        if (!transporter) {
            return res.status(404).json({ success: false, message: 'Transporter not found' });
        }

        res.json({ success: true, transporter });
    } catch (error) {
        console.error('Error fetching transporter:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


app.get('/edit-transporter', async (req, res) => {
    const { transporterId } = req.query;

    console.log('Received transporterId:', transporterId); // Debug log

    if (!ObjectId.isValid(transporterId)) {
        console.error('Invalid Transporter ID:', transporterId);
        return res.status(400).send('Invalid Transporter ID');
    }

    try {
        // Use the correct model and query
        const transporter = await Transporter.findOne({ _id: new ObjectId(transporterId) });

        if (!transporter) {
            console.error('Transporter not found for ID:', transporterId);
            return res.status(404).send('Transporter not found!');
        }

        console.log('Fetched transporter:', transporter); // Debug log
        res.render('edit-transporter', { transporter });
    } catch (error) {
        console.error('Error fetching transporter:', error);
        res.status(500).send('Server error');
    }
});

// Edit an existing transporter
app.put('/edit-transporter/:transporterId', async (req, res) => {
    const { transporterId } = req.params;
    console.log("Received Transporter ID :", transporterId)

    if (!ObjectId.isValid(transporterId)) {
        return res.status(400).json({ success: false, message: 'Invalid Transporter ID' });
    }

    const {
        transporterName,
        email,
        phone,
        vehicleNumber,
        stateCode,
        state,
        district,
        city,
        pincode,
    } = req.body;

    try {
        const result = await Transporter.updateOne(
            { _id: new ObjectId(transporterId) },
            {
                $set: {
                    transporterName,
                    email,
                    phone,
                    vehicleNumber,
                    stateCode,
                    state,
                    district,
                    city,
                    pincode,
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Transporter not found' });
        }

        res.json({ success: true, message: 'Transporter updated successfully' });
    } catch (error) {
        console.error('Error updating transporter:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete a transporter
app.delete('/delete-transporter/:id', (req, res) => {
    const userId = req.session.userId;  // Get userId from the session

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not logged in' });
    }

    Transporter.findOneAndDelete({ _id: req.params.id, userId })
        .then(transporter => {
            if (!transporter) {
                return res.status(404).json({ success: false, message: 'Transporter not found or not authorized' });
            }
            res.json({ success: true, message: 'Transporter deleted successfully.' });
        })
        .catch(error => {
            console.error(error);
            res.status(500).json({ success: false, message: 'Failed to delete transporter.' });
        });
});

// Serve the profile page
app.get('/profile', (req, res) => {
    res.render('profile'); // Render signup.hbs from the views folder
});

// Route to get profile data by userId from session
app.get('/get-profile', async (req, res) => {
    const userId = req.session.userId; // Get the user ID from the session
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized, please log in' });
    }

    try {
        // Fetch the profile for the logged-in user using the userId from session
        const profile = await Profile.findOne({ userId: userId });

        if (!profile) {
            return res.status(404).json({ message: 'Profile not found' });
        }
        console.log("profile : ", profile);
        res.json(profile); // Send profile data as JSON
    } catch (error) {
        console.error('Error fetching profile from database:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Serve the update profile page
app.get('/update-profile', (req, res) => {
    res.render('update-profile'); // Render signup.hbs from the views folder
});

// Route to handle profile update
app.post('/update-profile', async (req, res) => {
    try {
        const { businessName, gstNumber, panNumber, state, district, city, address, email, phone } = req.body;
        const userId = req.session.userId;  // Assuming you're getting the userId from session

        if (!userId) {
            return res.status(401).json({ message: 'User not logged in' });
        }

        // Update or create a new profile
        let profile = await Profile.findOne({ userId });

        if (profile) {
            // Update the existing profile
            profile.businessName = businessName;
            profile.gstNumber = gstNumber;
            profile.panNumber = panNumber;
            profile.state = state;
            profile.district = district;
            profile.city = city;
            profile.address = address;
            profile.email = email;
            profile.phone = phone;
        } else {
            // Create a new profile if none exists
            profile = new Profile({
                userId,
                businessName,
                gstNumber,
                panNumber,
                state,
                district,
                city,
                address,
                email,
                phone
            });
        }

        await profile.save();
        res.status(200).json({ success: true, message: 'Profile updated successfully', profile });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'Error updating profile' });
    }
});


// Serve the forgot password page
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password'); // Render signup.hbs from the views folder
});

const cookieParser = require('cookie-parser');
app.use(cookieParser());

const randomstring = require('randomstring');
const { console } = require('inspector');
const otpCache = {}

function generateOTP() {
    return randomstring.generate({ length: 4, charset: 'numeric' })
}

function sendOTP(email, otp, res) {
    const mailOptions = {
        from: 'invoicehub7@gmail.com',
        to: email,
        subject: 'Password Reset OTP',
        text: `Your OTP for InvoiceHub password reset is: ${otp}`,
    };
    let transporter = nodemailer.createTransport({
        service: 'Gmail', // Replace with your email service
        auth: {
            user: 'invoicehub7@gmail.com', // Your email
            pass: 'ylec ycmp oijh rsso', // Your email password or app password
        },
        tls: {
            rejectUnauthorized: false
        }
    });
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error sending OTP email:", error);
            return res.status(500).send({ msg: 'Error sending OTP email' });
        }
        console.log('OTP email sent:', info.response);
        return res.status(200).send({ msg: 'OTP sent successfully' });
    })
}

// Handle /reqOTP POST request
app.post('/reqOTP', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send('Email is required');
    }

    const otp = generateOTP();
    otpCache[email] = otp;

    // Send OTP
    sendOTP(email, otp, res);

    // Set OTP in cookies (optional)
    res.cookie('otpCache', otpCache, { maxAge: 30000, httpOnly: true });
});

// Serve the Verify OTP page
app.get('/verify', (req, res) => {
    res.render('verify'); // Render signup.hbs from the views folder
});

app.post('/verifyOTP', (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).send({ msg: 'Email and OTP are required' });
    }

    const cachedOTP = otpCache[email];

    if (cachedOTP && cachedOTP === otp) {
        delete otpCache[email]; // Clear OTP after successful verification
        return res.status(200).send({ msg: 'OTP verified successfully' });
    }

    return res.status(400).send({ msg: 'Invalid or expired OTP' });
});

app.post('/resendOTP', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ msg: 'Email is required' });
    }

    try {
        // Generate and send OTP (Implement your logic here)
        const otp = generateOTP(); // Replace with your OTP generation logic
        await sendOTP(email, otp, res);// Replace with your email sending logic

        res.status(200).json({ msg: 'OTP has been resent to your email' });
    } catch (error) {
        console.error('Error resending OTP:', error);
        res.status(500).json({ msg: 'Failed to resend OTP. Please try again later.' });
    }
});


// Serve the Change password with login page
app.get('/change-pass-without-login', (req, res) => {
    const email = req.query.email;
    if (!email) {
        console.error('Email query param missing');
        return res.status(400).send('Email is required');
    }
    console.log('Email received for password change:', email);
    res.render('change-pass-without-login', { email });
});

// Handle /changePassword POST request
app.post('/changePassword', async (req, res) => {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return res.status(400).json({ msg: 'Email and new password are required' });
    }

    try {
        // Find the user by email
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password in the database
        user.password = hashedPassword;
        await user.save();

        // Send a response indicating success
        res.status(200).json({ msg: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ msg: 'An error occurred while changing password' });
    }
});

//Reports

// Serve the report-gst-bill page
app.get('/report-gst-bill', (req, res) => {
    res.render('report-gst-bill');
});

app.get('/get-customers-summary', async (req, res) => {
    const { name, minAmount, maxAmount, minQuantity, maxQuantity, startDate, endDate } = req.query;

    // Get userId from the session
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Build the filter query dynamically
    const filters = { 'userId': userId };  // Ensure only this user's data is fetched
    if (name) {
        filters['customer.name'] = { $regex: name, $options: 'i' }; // Case-insensitive match
    }
    if (minAmount) {
        filters.grandTotal = { $gte: parseFloat(minAmount) };
    }
    if (maxAmount) {
        filters.grandTotal = { $lte: parseFloat(maxAmount) };
    }
    if (minQuantity) {
        filters.totalQuantity = { $gte: parseInt(minQuantity) };
    }
    if (maxQuantity) {
        filters.totalQuantity = { $lte: parseInt(maxQuantity) };
    }
    if (startDate) {
        filters.date = { $gte: new Date(startDate) };
    }
    if (endDate) {
        filters.date = filters.date || {};
        filters.date.$lte = new Date(endDate);
    }

    try {
        const customers = await Bill.aggregate([
            { $match: filters },
            {
                $group: {
                    _id: '$customer.customerId',
                    customerId: { $first: '$customer.customerId' },
                    name: { $first: '$customer.name' },
                    gstNumber: { $first: '$customer.gstNumber' },
                    phone: { $first: '$customer.phone' },
                    billCount: { $sum: 1 },
                    totalQuantity: { $sum: '$totalQuantity' },
                    totalAmount: { $sum: '$grandTotal' },
                },
            },
            { $sort: { name: 1 } },
        ]);

        res.status(200).json({ success: true, customers });
    } catch (error) {
        console.error('Error fetching customer summaries:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customer summaries.' });
    }
});

app.get('/get-gst-reports', async (req, res) => {
    const { period, month, startDate, endDate, name } = req.body;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const filters = { userId };

    if (name) {
        filters['customer.name'] = { $regex: name, $options: 'i' };
    }

    if (period === 'monthly' && month) {
        const [year, monthNum] = month.split("-");
        filters.date = {
            $gte: new Date(`${year}-${monthNum}-01`),
            $lte: new Date(`${year}-${monthNum}-31`)
        };
    } else if (startDate && endDate) {
        filters.date = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    try {
        console.log("Filters:", filters);
        const bills = await Bill.find(filters).sort({ date: -1 });
        console.log("Fetched Bills:", bills);
        res.status(200).json({ success: true, bills });
    } catch (error) {
        console.error("Error fetching GST reports:", error);
        res.status(500).json({ success: false, message: "Failed to fetch reports." });
    }
});


app.get('/get-customer-report/:customerId', async (req, res) => {
    try {
        const userId = req.session.userId;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const customerId = req.params.customerId;

        const customer = await Bill.aggregate([
            {
                $match: {
                    'customer.customerId': customerId,
                    userId: userId,  // Only fetch the report for the logged-in user
                },
            },
            {
                $group: {
                    _id: '$customer.customerId',
                    name: { $first: '$customer.name' },
                    gstNumber: { $first: '$customer.gstNumber' },
                    phone: { $first: '$customer.phone' },
                    billCount: { $sum: 1 },
                    totalQuantity: { $sum: '$totalQuantity' },
                    totalAmount: { $sum: '$grandTotal' },
                    bills: {
                        $push: {
                            invoiceNo: '$invoiceNo',
                            total: '$totalQuantity',
                            amount: '$grandTotal',
                            date: '$date',
                        },
                    },
                },
            },
        ]);

        if (!customer || customer.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found!' });
        }

        res.status(200).json({ success: true, customer: customer[0] });
    } catch (error) {
        console.error('Error fetching customer report:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customer report.' });
    }
});


// Serve the report-gst-bill page
app.get('/report-sales', (req, res) => {
    res.render('report-sales');
});

app.get('/salesreport/summary', async (req, res) => {
    try {
        const userId = req.session.userId;

        if (!userId) {
            return res.status(401).json({ message: 'User not authenticated' });
        }

        // Get filters from query parameters
        const { startDate, endDate, month, quarter, year, customerId } = req.query;

        // Build match filter
        const matchFilter = { userId: userId };

        // Apply date filters
        if (startDate && endDate) {
            matchFilter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        } else if (month && year) {
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month, 0);
            matchFilter.date = { $gte: start, $lte: end };
        } else if (quarter && year) {
            const quarterStartMonths = { 1: 0, 2: 3, 3: 6, 4: 9 }; // Quarters start at Jan, Apr, Jul, Oct
            const start = new Date(year, quarterStartMonths[quarter], 1);
            const end = new Date(year, quarterStartMonths[quarter] + 3, 0);
            matchFilter.date = { $gte: start, $lte: end };
        } else if (year) {
            const start = new Date(year, 0, 1);
            const end = new Date(year, 11, 31);
            matchFilter.date = { $gte: start, $lte: end };
        }

        if (customerId) {
            matchFilter.customerId = customerId;
        }

        // Aggregate GST Sales
        const gstSales = await Bill.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$totalAmount' },
                    billCount: { $sum: 1 },
                },
            },
        ]);

        // Aggregate Non-GST Sales
        const nonGstSales = await NonGstBill.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$totalAmount' },
                    billCount: { $sum: 1 },
                },
            },
        ]);

        const totalSales =
            (gstSales[0]?.totalAmount || 0) + (nonGstSales[0]?.totalAmount || 0);
        const totalBillCount =
            (gstSales[0]?.billCount || 0) + (nonGstSales[0]?.billCount || 0);

        const customerFilter = { userId: userId };
        if (customerId) {
            customerFilter._id = customerId;
        }
        const totalCustomers = await Customer.countDocuments(customerFilter);

        res.json({
            totalSales,
            gstSales: gstSales[0]?.totalAmount || 0,
            nonGstSales: nonGstSales[0]?.totalAmount || 0,
            gstBillCount: gstSales[0]?.billCount || 0,
            nonGstBillCount: nonGstSales[0]?.billCount || 0,
            totalBillCount,
            totalCustomers,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.get('/salesreport/customers', async (req, res) => {
    const { name, startDate, endDate, month, quarter, year } = req.query;

    // Get userId from the session
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
    }

    // Build dynamic filters
    const filters = { userId: userId };

    // Name filter
    if (name) {
        filters['customer.name'] = { $regex: name, $options: 'i' };
    }

    // Date range filter
    if (startDate || endDate) {
        filters['createdAt'] = {};
        if (startDate) {
            filters['createdAt'].$gte = new Date(startDate);
        }
        if (endDate) {
            filters['createdAt'].$lte = new Date(endDate);
        }
    }

    // Specific month filter
    if (month) {
        const start = new Date(`${year}-${month}-01`);
        const end = new Date(start);
        end.setMonth(start.getMonth() + 1);
        filters['createdAt'] = { $gte: start, $lt: end };
    }

    // Quarterly filter
    if (quarter) {
        const quarters = {
            'Q1': { start: '01-01', end: '03-31' }, // Jan-Mar
            'Q2': { start: '04-01', end: '06-30' }, // Apr-Jun
            'Q3': { start: '07-01', end: '09-30' }, // Jul-Sep
            'Q4': { start: '10-01', end: '12-31' }, // Oct-Dec
        };

        if (quarters[quarter]) {
            const { start, end } = quarters[quarter];
            filters['createdAt'] = {
                $gte: new Date(`${year}-${start}`),
                $lte: new Date(`${year}-${end}`),
            };
        }
    }

    // Yearly filter
    if (year) {
        filters['createdAt'] = {
            $gte: new Date(`${year}-01-01`),
            $lte: new Date(`${year}-12-31`),
        };
    }

    try {
        // Fetch data from GST Bills
        const gstBills = await Bill.aggregate([
            { $match: filters },
            {
                $group: {
                    _id: '$customer.customerId',
                    customerId: { $first: '$customer.customerId' },
                    name: { $first: '$customer.name' },
                    phone: { $first: '$customer.phone' },
                    totalBills: { $sum: 1 },
                    totalQuantity: { $sum: '$totalQuantity' },
                    totalAmount: { $sum: '$grandTotal' },
                },
            },
        ]);

        // Fetch data from Non-GST Bills
        const nonGstBills = await NonGstBill.aggregate([
            { $match: filters },
            {
                $group: {
                    _id: '$customer.customerId',
                    customerId: { $first: '$customer.customerId' },
                    name: { $first: '$customer.name' },
                    phone: { $first: '$customer.phone' },
                    totalBills: { $sum: 1 },
                    totalQuantity: { $sum: '$totalQuantity' },
                    totalAmount: { $sum: '$grandTotal' },
                },
            },
        ]);

        const gstMap = gstBills.reduce((acc, bill) => {
            acc[bill._id] = bill;
            return acc;
        }, {});

        const nonGstMap = nonGstBills.reduce((acc, bill) => {
            acc[bill._id] = bill;
            return acc;
        }, {});

        // Fetch customer data
        const customers = await Customer.find({ userId: userId }).lean();

        const customerData = customers.map((customer) => {
            const gstData = gstMap[customer.customerId] || { totalAmount: 0, totalQuantity: 0, totalBills: 0 };
            const nonGstData = nonGstMap[customer.customerId] || { totalAmount: 0, totalQuantity: 0, totalBills: 0 };

            return {
                ...customer,
                totalBills: gstData.totalBills + nonGstData.totalBills,
                totalQuantity: gstData.totalQuantity + nonGstData.totalQuantity,
                totalAmount: gstData.totalAmount + nonGstData.totalAmount,
            };
        });

        res.json(customerData);
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ error: error.message });
    }
});


// Serve the report-tax page
app.get('/report-tax', (req, res) => {
    res.render('report-tax');
});

app.get('/tax-summary', async (req, res) => {
    try {
        // Get userId from the session
        const userId = req.session.userId;

        if (!userId) {
            return res.status(401).json({ message: 'User not authenticated' });
        }

        // Aggregate GST Sales, CGST, SGST, and Total Sales for the logged-in user
        const gstSummary = await Bill.aggregate([
            { $match: { userId } }, // Match only bills of the logged-in user
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: '$totalAmount' },
                    cgstAmount: { $sum: '$cgstAmount' },
                    sgstAmount: { $sum: '$sgstAmount' },
                    totalQuantity: { $sum: '$totalQuantity' },
                },
            },
        ]);

        // Aggregate Non-GST Sales for the logged-in user
        const nonGstSummary = await NonGstBill.aggregate([
            { $match: { userId } }, // Match only non-GST bills of the logged-in user
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: '$totalAmount' },
                    totalQuantity: { $sum: '$totalQuantity' },
                },
            },
        ]);

        // Calculate overall sales and GST totals
        const totalSales = (gstSummary[0]?.totalSales || 0) + (nonGstSummary[0]?.totalSales || 0);
        const totalCgst = gstSummary[0]?.cgstAmount || 0;
        const totalSgst = gstSummary[0]?.sgstAmount || 0;

        res.json({
            totalSales,
            gstSales: gstSummary[0]?.totalSales || 0,
            nonGstSales: nonGstSummary[0]?.totalSales || 0,
            totalCgst,
            totalSgst,
            totalGstAmount: totalCgst + totalSgst,
            totalQuantity: (gstSummary[0]?.totalQuantity || 0) + (nonGstSummary[0]?.totalQuantity || 0),
        });
    } catch (error) {
        console.error('Error fetching tax summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve the report-customer page
app.get('/report-customer', (req, res) => {
    res.render('report-customer');
});

app.get('/customer-report/:customerId', async (req, res) => {
    const customerId = req.params.customerId;
    res.render('customer-report', { customerId });
});

// Fetch customer along with their bills and non-GST bills
app.get('/customer-report-per/:customerId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { customerId } = req.params;

        console.log('Customer ID:', customerId);
        console.log('User ID:', userId);

        if (!userId || !customerId) {
            return res.status(400).json({ error: 'User ID or Customer ID is missing' });
        }

        const customer = await Customer.findOne({ userId, customerId });
        console.log('Customer:', customer);

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Fetch GST Bills
        const gstBills = await Bill.find({ userId, 'customer.customerId': customer.customerId }).sort({ createdAt: -1 });
        console.log('GST Bills:', gstBills);

        const gstTotalSales = gstBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
        const gstTotalGst = gstBills.reduce((sum, bill) => sum + bill.cgstAmount + bill.sgstAmount, 0);
        const gstLastOrderDate = gstBills.length > 0 ? gstBills[0].createdAt : 'N/A';

        // Fetch Non-GST Bills
        const nonGstBills = await NonGstBill.find({ userId, 'customer.customerId': customer.customerId }).sort({ createdAt: -1 });
        console.log('NonGST Bills:', nonGstBills);

        const nonGstTotalSales = nonGstBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
        const nonGstLastOrderDate = nonGstBills.length > 0 ? nonGstBills[0].createdAt : 'N/A';

        res.json({
            customer,
            gstBills,
            nonGstBills,
            gstSummary: {
                totalSales: gstTotalSales,
                totalGst: gstTotalGst,
                lastOrderDate: gstLastOrderDate,
            },
            nonGstSummary: {
                totalSales: nonGstTotalSales,
                lastOrderDate: nonGstLastOrderDate,
            },
        });
    } catch (error) {
        console.error('Error fetching customer report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});