require('dotenv').config();
const express = require('express');
const { errorHandler } = require('./middleware/errorHandler');
const app = express();
const mongoose = require('mongoose');
const cors = require('cors');
const corsOptions = require('./config/corsOptions');
const connectDB = require('./config/dbConnection');
const cookieParser = require('cookie-parser');
const http = require('http');
const morgan = require('morgan');

const PORT = process.env.PORT || 3000;

// Connect to the database
connectDB();

// Server config
app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// Routes
app.use('/api/gtfs', require('./route/tripRoute'));
console.log('Routes loaded');

app.get('/', (req, res) => {
    res.send('Welcome to the RailQuest API!');
});

// Error handling middleware
app.use(errorHandler);

// Create an HTTP server for WebSockets
const server = http.createServer(app);

// Start the server after connecting to MongoDB
mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB');
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});

// Handle MongoDB connection errors
mongoose.connection.on('error', (err) => {
    console.log(`MongoDB connection error: ${err}`);
});