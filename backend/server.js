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
app.use('/api/fastest_path', require('./route/fastestRoute'));
app.use('/api/stops', require('./route/stopRoute'));
app.use('/api/routes', require('./route/routeRoute'));
app.use('/api/realtime', require('./route/realtimeRoute'));
console.log('Routes loaded');


app.get('/readme', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../README.md'));
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Swiss GTFS Network API</title>
                <style>
                    body {
                        margin: 0;
                        height: 100vh;
                        font-family: 'Segoe UI', Arial, sans-serif;
                        color: #222222;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        background: linear-gradient(135deg, #BBCDE5 0%, #639FAB 100%);
                        position: relative;
                        overflow: hidden;
                    }
                    .rails {
                        position: absolute;
                        top: 0; left: 0; width: 100%; height: 100%;
                        pointer-events: none;
                        z-index: 0;
                    }
                    .rail {
                        position: absolute;
                        width: 100vw;
                        height: 6px;
                        background: repeating-linear-gradient(
                            to right,
                            #FFFFFF 0px, #FFFFFF 40px,
                            #1C5D99 40px, #1C5D99 60px
                        );
                        opacity: 0.18;
                        animation: moveRail 8s linear infinite;
                    }
                    .rail:nth-child(1) { top: 20%; left: 0; }
                    .rail:nth-child(2) { top: 40%; left: 0; animation-delay: 2s; }
                    .rail:nth-child(3) { top: 60%; left: 0; animation-delay: 4s; }
                    @keyframes moveRail {
                        0% { transform: translateX(-20vw); }
                        100% { transform: translateX(20vw); }
                    }
                    .container {
                        background: rgba(255,255,255,0.97);
                        padding: 2rem 3rem;
                        border-radius: 16px;
                        box-shadow: 0 8px 32px rgba(34,34,34,0.10);
                        text-align: center;
                        z-index: 1;
                        position: relative;
                    }
                    h1 {
                        font-size: 2.4em;
                        margin-bottom: 0.5em;
                        font-weight: 700;
                        letter-spacing: 1px;
                        color: #1C5D99;
                        text-shadow: 0 2px 8px #BBCDE5;
                    }
                    p {
                        font-size: 1.15em;
                        margin: 0.7em 0;
                        color: #222222;
                    }
                    a {
                        color: #1C5D99;
                        text-decoration: none;
                        font-weight: 500;
                        margin: 0 0.5em;
                        transition: color 0.2s;
                    }
                    a:hover {
                        color: #639FAB;
                        text-decoration: underline;
                    }
                    .btn {
                        display: inline-block;
                        padding: 0.7em 1.5em;
                        background: linear-gradient(90deg, #1C5D99 60%, #639FAB 100%);
                        color: #FFFFFF;
                        border-radius: 8px;
                        text-decoration: none;
                        font-weight: 600;
                        margin-top: 1em;
                        margin-right: 0.5em;
                        box-shadow: 0 2px 8px rgba(34,34,34,0.15);
                        border: none;
                        transition: background 0.2s, transform 0.2s;
                        position: relative;
                    }
                    .btn:hover {
                        background: linear-gradient(90deg, #639FAB 60%, #1C5D99 100%);
                        color: #FFFFFF;
                        transform: scale(1.05);
                    }
                </style>
            </head>
            <body>
                <div class="rails">
                    <div class="rail"></div>
                    <div class="rail"></div>
                    <div class="rail"></div>
                </div>
                <div class="container">
                    <h1>Welcome to the Swiss PB map API</h1>
                    <p>Your starting point to explore Swiss railway schedules and routes.</p>
                    <p>
                        <a href="/docs">View the documentation</a> or try our endpoints to get started.
                    </p>
                    <a class="btn" href="https://github.com/Paul-Lecomte/swiss-pb-map" target="_blank">View README</a>
                    <a class="btn" href="https://swiss-gtfs-network.vercel.app" target="_blank">View Website</a>
                </div>
            </body>
        </html>
    `);
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