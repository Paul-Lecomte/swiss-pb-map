const allowedOrigins = require('./allowedOrigins')

//function for the cors API
const corsOptions = {
    origin: (origin, callback) => {
        if (allowedOrigins.indexOf(origin) !== -1 || !origin){
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    },
    credentials: true,
    optionsSuccesStatus: 200
}

module.exports = corsOptions