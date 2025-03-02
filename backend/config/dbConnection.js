const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        mongoose.set('bufferCommands', false);
        mongoose.set('bufferTimeoutMS', 30000);
        await mongoose.connect(process.env.DATABASE_URI);
        console.log('MongoDB connected');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err);
        process.exit(1); // Exit the process if the connection fails
    }
};

module.exports = connectDB;