const allowedOrigins = require('./allowedOrigins')
const {all} = require("express/lib/application");

//function for the cors API
const corsOptions = {
    origin: (origin, callback) => {
        if (allowedOrigins.indexOf(origin) !== -1 || !origin){
            callback(null, true)
        } else {
            callback(new Error('Non autorisé par CORS'))
        }
    },
    credentials: true,
    optionsSuccesStatus: 200
}

module.exports = corsOptions