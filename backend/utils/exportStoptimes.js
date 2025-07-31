// exportStoptimes.js
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

async function exportStoptimes() {
    const uri = 'mongodb://localhost:27017/swissgtfsnetworkmap';
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db();
        const collection = db.collection('stoptimes');

        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const filePath = path.join(dataDir, 'stoptimes.json');
        const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });

        writeStream.write('[\n');
        let first = true;
        const cursor = collection.find({}, { projection: { _id: 0, __v: 0 } });
        for await (const doc of cursor) {
            if (!first) writeStream.write(',\n');
            writeStream.write(JSON.stringify(doc));
            first = false;
        }
        writeStream.write('\n]\n');
        writeStream.end();
        console.log('Export terminé !');
    } finally {
        await client.close();
    }
}

exportStoptimes().catch(console.error);