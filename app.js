const express = require('express')
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { generateBitmap } = require('./convert');

const app = express()
const API_PORT = 3000;

const MIN_CONTENT_LENGTH_BYTES = 1000;
const MAX_PHOTO_SIZE_BYTES = 164391; // ~165 KB
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const QR_DIR = path.join(__dirname, 'public/qr_codes');
const WORK_UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_FILETIME_MS = 30 * 60 * 1000 // 30 minutes in MS
const DELETION_TASK_INTERVAL_MS = 5 * 60 * 1000; // Runs every 5 minutes

// File management
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

if (!fs.existsSync(QR_DIR)) {
    fs.mkdirSync(QR_DIR);
}

if (!fs.existsSync(WORK_UPLOAD_DIR)) {
    fs.mkdirSync(WORK_UPLOAD_DIR);
}

// Periodicc deletion task
setInterval(() => {
    const now = Date.now();
    console.log("Launching deletion task - " + now);

    try {
        deleteOldFilesFrom(now, UPLOAD_DIR);
        deleteOldFilesFrom(now, QR_DIR);
    } catch(error) {
        console.log("Deletion task Error: " + error);
    }
}, DELETION_TASK_INTERVAL_MS);

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
    let uploadedPhotoURL = "";

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
                        uploadedPhotoPath = "/uploads/" + filename; 
                        uploadedPhotoURL = "http://" + req.socket.localAddress.replace("::ffff:", "") + ":" + API_PORT + uploadedPhotoPath;
                    }
                }
            });

            if (uploadedPhotoURL.length > 0) {
                const fileName = `qrcode-${Date.now().getTime()}.png`;
                const qrFilePath = path.join(QR_DIR, fileName);
                QRCode.toFile(qrFilePath, uploadedPhotoURL, { errorCorrectionLevel: 'H' }, (err) => {
                    if (err) res.send('Error generating QR Code');
                    res.send(`<h1>Thank you!</h1><p>Your photo was succesfully uploaded.</p> <img src="${uploadedPhotoPath}" /> <p>You can access it via this QR Code:</p> <img src="/qr_codes/${fileName}"/> <br> <a href="/">Upload another snapshot</a>`);   
                });
            } else {
                res.send(`<h1>WAT</h1><p>Your photo was succesfully uploaded, but I can't find the path where it was stored....</p><p>Sorry.</p><a href="/">Try again, maybe?</a>`);   
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

function deleteOldFilesFrom(now, dirPath) {
    fs.readdir(dirPath, (err, files) => {
        if (err) {
            console.log("Error deleting files from: " + dirPath);
            throw err;
        }

        files.forEach(file => {
            const filePath = path.join(dirPath, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.log("Error reading: " + filePath + " for deletion");
                }

                if (now - stats.mtimeMs > MAX_FILE_FILETIME_MS) {
                    fs.unlink(filePath, err => {
                        if (err) {
                            console.log("Error deleting: " + filePath);
                        }
                        console.log("Deleted outdated file: " + filePath);
                    })
                }
            });
        });
    });
}