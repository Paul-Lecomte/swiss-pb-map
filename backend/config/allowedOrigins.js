const {all} = require("express/lib/application");
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174'
]

module.exports = allowedOrigins