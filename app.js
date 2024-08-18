const express = require('express')
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { generateBitmap } = require('./convert');

const app = express()
const API_PORT = 3000;
const HOSTNAME = process.env.HOSTNAME || undefined;

const MIN_CONTENT_LENGTH_BYTES = 1000;
const MAX_PHOTO_SIZE_BYTES = 164391; // ~165 KB
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const QR_DIR = path.join(__dirname, 'public/qr_codes');
const WORK_UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

if (!fs.existsSync(QR_DIR)) {
    fs.mkdirSync(QR_DIR);
}

if (!fs.existsSync(WORK_UPLOAD_DIR)) {
    fs.mkdirSync(WORK_UPLOAD_DIR);
}

app.use(express.static('public'));

// URL that gets requested from playsega's front page, so we simply redirect to our index.html
app.get('/redirector', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/submit', (req, res) => {
    let rawData = [];
    let uploadedPohotoURL = "";

    req.on('data', (chunk) => {
        // Chunks must be treated as bytes, not strings
        rawData.push(chunk);
    });

    req.on('end', () => {
        try {
            // Parsing the boundary from the Content-Type header
            let contentLength = req.headers['content-length'];

            // Sometimes the upload only sends 551 bytes for some reason, this way we prompt the user to try again
            if (contentLength < MIN_CONTENT_LENGTH_BYTES) {
                res.send(`<h1>Sorry.</h1><p>Something went wrong, that photo file is too small.</p><a href="/">Try with a different one.</a>`);   
                return;
            }

            // This way we about people sending aything bigger than GC screenshots
            if (contentLength > MAX_PHOTO_SIZE_BYTES) {
                res.send(`<h1>Sorry.</h1><p>That photo is too big.</p><a href="/">Try with a different one.</a>`);   
                return;   
            }

            rawData = Buffer.concat(rawData);

            // DEBUG
            //const rawDataPath = path.join(WORK_UPLOAD_DIR, 'raw_data');
            //fs.writeFileSync(rawDataPath, rawData);

            const boundary = '--' + req.headers['content-type'].split('; ')[1].replace('boundary=', '');
            const boundaryBuffer = Buffer.from(boundary);
            const parts = splitBuffer(rawData, boundaryBuffer).filter(part => part.length > 0);

            parts.forEach(part => {
                if (part.includes('Content-Disposition: form-data')) {
                    const nameMatch = part.toString().match(/name="(.+?)"/);
                    const name = nameMatch ? nameMatch[1] : null;

                    if (name === 'gcfile') {
                        const timestamp = new Date().getTime();
                        const filename = "PSO_SCREEN_" + timestamp + ".png";

                        // Isolate the binary data by finding the position after the headers
                        const headerEndIndex = part.toString().indexOf('\r\n\r\n') + 4;
                        const fileData = part.slice(headerEndIndex, part.length - 4);

                        const filePath = path.join(UPLOAD_DIR, filename);

                        generateBitmap(fileData, filePath);
                        const host = HOSTNAME || req.socket.localAddress.replace("::ffff:", "");
                        uploadedPohotoURL = "http://" + host + ":" + API_PORT + "/uploads/" + filename;
                    }
                }
            });

            if (uploadedPohotoURL.length > 0) {
                const fileName = `qrcode-${Date.now()}.png`;
                const qrFilePath = path.join(QR_DIR, fileName);
                QRCode.toFile(qrFilePath, uploadedPohotoURL, { errorCorrectionLevel: 'H' }, (err) => {
                    if (err) res.send('Error generating QR Code');
                    res.send(`<h1>Thank you!</h1><p>Your photo was succesfully uploaded.</p><p>You can access it via this QR Code:</p><img src="/qr_codes/${fileName}"/><p>URL: <a href="${uploadedPohotoURL}>${uploadedPohotoURL}</a></p>"> <br> <a href="/">Upload another snapshot</a>`);   
                });
            } else {
                res.send(`<h1>WAT</h1><p>Your photo was succesfully uploaded, but I can find the path where it was stored....</p><p>sorry.</p><a href="/">Try again maybe?</a>`);   
            }

        } catch(error) {
            console.log(error);
            res.send(`<h1>Sorry.</h1><p>Something went wrong.</p><a href="/">Try again.</a>`);   
        }
    });
});

app.listen(API_PORT, () => {
    console.log(`App listening on port ${API_PORT}`);
});

// Helper functions

function splitBuffer(buffer, boundary) {
    let parts = [];
    let currentIndex = 0;
    let boundaryIndex;

    while ((boundaryIndex = buffer.indexOf(boundary, currentIndex)) !== -1) {
        parts.push(buffer.slice(currentIndex, boundaryIndex));
        currentIndex = boundaryIndex + boundary.length;
    }

    parts.push(buffer.slice(currentIndex));
    return parts;
}