const express = require('express')
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { generateBitmap, generateBitmapDC } = require('./convert');

const app = express()
const API_PORT = 3000;

const MIN_CONTENT_LENGTH_BYTES = 1000;
const MAX_PHOTO_SIZE_BYTES = 164391; // ~165 KB
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const QR_DIR = path.join(__dirname, 'public/qr_codes');
const WORK_UPLOAD_DIR = path.join(__dirname, 'uploads');
const enableCleanup = false;
const MAX_FILE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in ms
const DELETION_TASK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour in ms

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

// Periodic deletion task
setInterval(() => {
    if (!enableCleanup) {
        console.log(getFormattedDate(new Date()) + " - Deletion task is disabled, skipping.");
        return;
    }

    const now = Date.now();
    console.log(getFormattedDate(new Date()) + " - Launching deletion task - Timestamp: " + now);

    try {
        deleteOldFilesFrom(now, UPLOAD_DIR);
        deleteOldFilesFrom(now, QR_DIR);
    } catch(error) {
        console.log(getFormattedDate(new Date()) + " - Deletion task Error: " + error);
    }
}, DELETION_TASK_INTERVAL_MS);

app.use(express.static('public'));

// URL that gets requested from playsega's front page, so we simply redirect to our index.html
app.get('/redirector', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pso_ep12', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pso_ep12.html'));
});

app.get('/pso_ep3', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pso_ep3.html'));
});

app.get('/dc', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dc.html'));
});

app.get('/gallery', (_req, res) => {
    const galleryPath = path.join(__dirname, 'public' ,'gallery.html');

    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) {
            console.log("err");
            return res.send(renderMessage(`<p>Something went wrong.</p>`));   
        }

        const images = files.filter(file => file.endsWith(".png")).map(file => {
            const parts = file.split('_');
            const platform = parts[1];
            const uuid = parts[2];
            const timestamp = parseInt(parts[3].replace('.png', ''));

            return {
                src: 'uploads/' + file,
                qr_src: 'qr_codes/qrcode-' + uuid + ".png",
                platform,
                uuid,
                timestamp,
                date: getFormattedDate(new Date(timestamp)),
            };
        }).sort((a, b) => b.timestamp - a.timestamp);

        let rows = "";
        for (let i = 0; i < images.length; i++ ) {
            rows += renderGalleryEntry(images[i]);
        }

        fs.readFile(galleryPath, 'utf8', (err, html) => {
            if (err) {
                console.log(err);
                res.send(renderMessage(`<p>Something went wrong.</p>`));
                return;
            }

            if (rows === "") {
               rows = `<tr><td><font face="arial, helvetica, sans-serif" size="2" color="#ffffff">There's nothing here yet.<font></td></tr><tr><td width="530" height="20">&nbsp;</td></tr>`;
            }

            const filledGallery = html.replace('<!-- GALLERY GOES HERE -->', rows);
            res.send(filledGallery);
        });

    });
});

app.post('/submit', (req, res) => {
    let rawData = [];
    let uploadedPhotoURL = "";
    let uuid = "";

    req.on('data', (chunk) => {
        // Chunks must be treated as bytes, not strings
        rawData.push(chunk);
    });
    console.log(req.headers);

    req.on('end', () => {
        try {
            // Parsing the boundary from the Content-Type header
            let contentLength = req.headers['content-length'];

            // Sometimes the upload only sends 551 bytes for some reason, this way we prompt the user to try again
            if (contentLength < MIN_CONTENT_LENGTH_BYTES) {
                console.log(getFormattedDate(new Date()) + " - Photo is too small: " + contentLength + " bytes");
                renderMessage(res, `<p>Something went wrong, that photo file is too small.</p><a href="/">Try with a different one.</a><br>`);
                return;
            }

            // This way we stop people sending aything bigger than GC screenshots
            if (contentLength > MAX_PHOTO_SIZE_BYTES) {
                console.log(getFormattedDate(new Date()) + " - Photo is too big: " + contentLength + " bytes");
                renderMessage(res, `<p>That photo is too big.</p><a href="/">Try with a different one.</a><br>`);   
                return;   
            }

            rawData = Buffer.concat(rawData);

            const boundary = '--' + req.headers['content-type'].split('; ')[1].replace('boundary=', '');
            const boundaryBuffer = Buffer.from(boundary);
            const parts = splitBuffer(rawData, boundaryBuffer).filter(part => part.length > 0);

            parts.forEach(part => {
                if (part.includes('Content-Disposition: form-data')) {
                    const stringPart = part.toString();
                    const nameMatch = stringPart.match(/name="(.+?)"/);
                    const name = nameMatch ? nameMatch[1] : null;
                    const acceptFilename = stringPart.split('filename=')[1].split('&')[0]; 
                    const platform = getPlatformFromFilename(acceptFilename);
                    const baseURL = "http://" + req.socket.localAddress.replace("::ffff:", "") + ":" + API_PORT;

                    if (name === 'gcfile' || name === 'vmfile' ) {
                        const { photoPath, photoURL, photoUUID } = processImagePart(part, baseURL, platform);
                        uploadedPhotoURL = photoURL;
                        uploadedPhotoPath = photoPath;
                        uuid = photoUUID;

                        // Debug
                        if (platform === 'DC') {
                            const rawDataPath = path.join(WORK_UPLOAD_DIR, 'raw_data_dc_' + uuid);
                            fs.writeFileSync(rawDataPath, rawData);
                        }
                    } else {
                        console.log("name: " + name + "part: " + part);
                    }
                }
            });

            if (uploadedPhotoURL.length > 0) {
                console.log(getFormattedDate(new Date()) + " - Uploaded snapshot: " + uploadedPhotoURL);
                const fileName = `qrcode-${uuid}.png`;
                const qrFilePath = path.join(QR_DIR, fileName);
                QRCode.toFile(qrFilePath, uploadedPhotoURL, { errorCorrectionLevel: 'H' }, (err) => {
                    if (err) {
                        console.log(getFormattedDate(new Date()) + " - Error generating QR code for " + uploadedPhotoURL);
                        renderMessage(res,'Error generating QR Code');
                    } else {
                        console.log(getFormattedDate(new Date()) + " - Generated QR: " + fileName);
                        renderMessage(res, `<h1>Thank you!</h1><p>Your photo was succesfully uploaded.</p><img src="${uploadedPhotoPath}" /> <p>You can access it via this QR Code:</p> <img src="/qr_codes/${fileName}"/> <br><br> <a href="/">Upload another snapshot</a> <br><br> <a href="/gallery">Go to gallery</a><br>`);   
                    }
                });
            } else {
                console.log(getFormattedDate(new Date()) + " - Error - Uploaded photo is missing url");
                renderMessage(res, `<p>Your photo was succesfully uploaded, but it appears something went wrong during conversion.</p><a href="/">Try again, maybe?</a>`);   
            }

        } catch(error) {
            console.log(getFormattedDate(new Date()) + " - " + error);
            renderMessage(res, `<p>Something went wrong.</p><a href="/">Try again.</a>`);        }
    });
});

app.listen(API_PORT, () => {
    console.log(`App listening on port ${API_PORT}`);
});

// Helper functions

function processImagePart(part, baseURL, platform) {
    const timestamp = new Date().getTime();
    const uuid = uuidv4();
    const filename = "PSO_" + platform + "_" + uuid +"_" + timestamp + ".png";
    const filePath = path.join(UPLOAD_DIR, filename);
    const stringPart = part.toString();

    if (platform === "DC") {
        const headerEndIndex = getPosition(stringPart, "\n\n", 1);
        const dataEndIndex = getPosition(stringPart, "\n\n", 2) - 1;
        const fileData = part.slice(headerEndIndex, dataEndIndex);

        generateBitmapDC(fileData, filePath);
    } else {
        // Isolate the binary data by finding the position after the headers
        const headerEndIndex = stringPart.indexOf('\r\n\r\n') + 4;
        const fileData = part.slice(headerEndIndex, part.length - 4);

        generateBitmap(fileData, filePath);
    }

    const photoPath = "/uploads/" + filename; 
    const photoURL = baseURL + photoPath;
    const photoUUID = uuid;

    return { photoURL, photoPath, photoUUID };
}

function getFormattedDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); 
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getPlatformFromFilename(filename) {
    switch(filename) {
        case "PSO_SCREEN":
            return "GC-EP12";
        case "PSO3_SCREEN":
            return "GC-EP3";
        case "PSO______IMG":
            return "DC";
        default:
            return "";
    }
}

function getFormattedPlatform(platform) {
    switch(platform) {
        case "GC-EP12":
            return "Gamecube Ep 1,2";
        case "GC-EP3":
            return "Gamecube Ep 3";
        case "DC":
            return "Dreamcast (ver 1,2)";
        default:
            return "Unknown platform";
    }
}

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

                if (now - stats.mtimeMs > MAX_FILE_LIFETIME_MS) {
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

function renderGalleryEntry(image) {
    return `<tr>
                <td>
                    <img src="${image.src}">
                    <font face="arial, helvetica, sans-serif" size="4" color="#ffffff">${image.date}</font>
                </td>
                <td>
                    <table width="200" border="0" cellspacing="5" cellpadding="0" align="center">
                        <tbody>
                            <tr><td><img width=180 src="${image.qr_src}"></td></tr>
                            <tr>
                                <td>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <font face="arial, helvetica, sans-serif" size="2" color="#ffffff">${getFormattedPlatform(image.platform)}</font>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    
                </td>
            </tr>
            <tr><td width="530" height="20">&nbsp;</td></tr>`

}

function renderMessage(res, message) {
    const messagePath = path.join(__dirname, 'public' ,'message.html');

    fs.readFile(messagePath, 'utf8', (err, html) => {
        if (err) {
            console.log(err);
            message = `<p>Something went wrong.</p>`;
        }

        const filledMessage = html.replace('<!-- MESSAGE GOES HERE -->', message);
        res.send(filledMessage);
    });
}


function getPosition(string, subString, index) {
    return string.split(subString, index).join(subString).length;
}
