// This is a javascript conversion of PSOProxy's ProcessData.cpp/h class
// Coded by Adrian O'Grady and James Sutherland in 2003 
// Original program and source code: https://psoproxy.sourceforge.net/

const fs = require('fs');
const { PNG } = require('pngjs');

const pDecoderSet = "TAZOLYNdnE9mP6ci3SzeqIyXBhDgfQp7l5batM4rFKJj8CusxR1+k2V0wUGovWH/";
const pTable = Buffer.alloc(128, 0);
const pRedLookup = Buffer.alloc(32);
const pGreenLookup = Buffer.alloc(64);
const pBlueLookup = Buffer.alloc(32);

// Initialize the decoder mapping table
for (let i = 64; i > 0; i--) {
    pTable[pDecoderSet.charCodeAt(64 - i) & 0x7F] = 64 - i;
}

// Initialize the RGB lookup tables
const gamma = 1.0;
for (let i = 0; i < 32; i++) {
    const val = Math.pow(i / 31.0, 1.0 / gamma);
    pRedLookup[i] = Math.round(val * 255);
    pBlueLookup[i] = Math.round(val * 255);
}

for (let i = 0; i < 64; i++) {
    const val = Math.pow(i / 63.0, 1.0 / gamma);
    pGreenLookup[i] = Math.round(val * 255);
}

function decode(input) {
    const output = Buffer.alloc((input.length / 4) * 3);
    let outIndex = 0;

    for (let i = 0; i < input.length; i += 4) {
        const decoded = decodeBytes(input.slice(i, i + 4));
        output[outIndex++] = decoded[0];
        output[outIndex++] = decoded[1];
        output[outIndex++] = decoded[2];
    }

    return output;
}

function decodeBytes(input) {
    const out = Buffer.alloc(3);

    out[0] = (decodeByte(input[0]) << 2) | (decodeByte(input[1]) >> 4);
    out[1] = (decodeByte(input[1]) << 4) | (decodeByte(input[2]) >> 2);
    out[2] = (decodeByte(input[2]) << 6) | decodeByte(input[3]);

    return out;
}

function decodeByte(byte) {
    return pTable[byte & 0x7F] & 0x7F;
}

const getCol16 = (x, y, bitmap16) => {
    if (x < 0 || x > 255 || y < 0 || y > 191) return -1;
    return bitmap16[x + 256 * y];
};

const setCol16 = (x, y, value, bitmap16) => {
    if (x >= 0 && x <= 255 && y >= 0 && y <= 191) {
        bitmap16[x + 256 * y] = value;
    }
};

// Generate 24-bit color values from the 16-bit data
function generate24BitValue(x, y, sharp, bitmap16) {
    let r = pRedLookup[(getCol16(x, y, bitmap16) >> 11) & 0x1F];
    let g = pGreenLookup[(getCol16(x, y, bitmap16) >> 5) & 0x3F];
    let b = pBlueLookup[getCol16(x, y, bitmap16) & 0x1F];

    if (!sharp) {
        return { r, g, b };
    }

    let rUp = pRedLookup[(getCol16(x, y > 0 ? y - 1 : y, bitmap16) >> 11) & 0x1F];
    let gUp = pGreenLookup[(getCol16(x, y > 0 ? y - 1 : y, bitmap16) >> 5) & 0x3F];
    let bUp = pBlueLookup[getCol16(x, y > 0 ? y - 1 : y, bitmap16) & 0x1F];

    let rDown = pRedLookup[(getCol16(x, y < 191 ? y + 1 : y, bitmap16) >> 11) & 0x1F];
    let gDown = pGreenLookup[(getCol16(x, y < 191 ? y + 1 : y, bitmap16) >> 5) & 0x3F];
    let bDown = pBlueLookup[getCol16(x, y < 191 ? y + 1 : y, bitmap16) & 0x1F];

    if (sharp === 1) {
        r = ((r * 4) - rUp - rDown) / 2;
        g = ((g * 4) - gUp - gDown) / 2;
        b = ((b * 4) - bUp - bDown) / 2;
    } else {
        r = ((r * 3) - rUp - rDown);
        g = ((g * 3) - gUp - gDown);
        b = ((b * 3) - bUp - bDown);
    }

    return {
        r: Math.min(Math.max(r, 0), 255),
        g: Math.min(Math.max(g, 0), 255),
        b: Math.min(Math.max(b, 0), 255)
    };
}

function generateBitmap(fileData, outputFilePath) {
    const decodedData = decode(fileData);
    const OFFSET = 8272;
    const GC_FILE_SIZE = decodedData.length;
    const width = 256;
    const height = 192;
    const png = new PNG({ width, height });
    const bitmap16 = new Uint16Array(49152); // 256x192

    let x = 0, y = 0;

    // First pass of setting pixels
    for (let i = OFFSET; i < GC_FILE_SIZE; i += 8) {
        setCol16(x, y, decodedData.readUInt16BE(i), bitmap16);
        x++;
        if (x === 256) {
            x = 0;
            y += 4;
        }
    }

    //Second pass with y offset of 1
    x = 0;
    y = 1;
    for (let i = OFFSET + 2; i < GC_FILE_SIZE; i += 8) {
        setCol16(x, y, decodedData.readUInt16BE(i), bitmap16);
        x++;
        if (x === 256) {
            x = 0;
            y += 4;
        }
    }

    // Third pass with y offset of 2
    x = 0;
    y = 2;
    for (let i = OFFSET + 4; i < GC_FILE_SIZE; i += 8) {
        setCol16(x, y, decodedData.readUInt16BE(i), bitmap16);
        x++;
        if (x === 256) {
            x = 0;
            y += 4;
        }
    }

    // Fourth pass with y offset of 3
    x = 0;
    y = 3;
    for (let i = OFFSET + 6; i < GC_FILE_SIZE; i += 8) {
        setCol16(x, y, decodedData.readUInt16BE(i), bitmap16);
        x++;
        if (x === 256) {
            x = 0;
            y += 4;
        }
    }

    // Unswizzling process to rearrange the pixels
    for (x = 0; x < 256; x += 4) {
        for (y = 0; y < 192; y += 4) {
            let v = [
                [0, 0, 0, 0],
                [0, 0, 0, 0],
                [0, 0, 0, 0],
                [0, 0, 0, 0]
            ];

            v[0][0]=getCol16(0+x,0+y, bitmap16);
			v[1][0]=getCol16(1+x,0+y, bitmap16);
			v[2][0]=getCol16(2+x,0+y, bitmap16);
			v[3][0]=getCol16(3+x,0+y, bitmap16);
			v[0][1]=getCol16(0+x,1+y, bitmap16);
			v[1][1]=getCol16(1+x,1+y, bitmap16);
			v[2][1]=getCol16(2+x,1+y, bitmap16);
			v[3][1]=getCol16(3+x,1+y, bitmap16);
			v[0][2]=getCol16(0+x,2+y, bitmap16);
			v[1][2]=getCol16(1+x,2+y, bitmap16);
			v[2][2]=getCol16(2+x,2+y, bitmap16);
			v[3][2]=getCol16(3+x,2+y, bitmap16);
			v[0][3]=getCol16(0+x,3+y, bitmap16);
			v[1][3]=getCol16(1+x,3+y, bitmap16);
			v[2][3]=getCol16(2+x,3+y, bitmap16);
			v[3][3]=getCol16(3+x,3+y, bitmap16);

            setCol16(x, y, v[0][0], bitmap16);
            setCol16(x + 1, y, v[0][1], bitmap16);
            setCol16(x + 2, y, v[0][2], bitmap16);
            setCol16(x + 3, y, v[0][3], bitmap16);
            setCol16(x, y + 1, v[1][0], bitmap16);
            setCol16(x + 1, y + 1, v[1][1], bitmap16);
            setCol16(x + 2, y + 1, v[1][2], bitmap16);
            setCol16(x + 3, y + 1, v[1][3], bitmap16);
            setCol16(x, y + 2, v[2][0], bitmap16);
            setCol16(x + 1, y + 2, v[2][1], bitmap16);
            setCol16(x + 2, y + 2, v[2][2], bitmap16);
            setCol16(x + 3, y + 2, v[2][3], bitmap16);
            setCol16(x, y + 3, v[3][0], bitmap16);
            setCol16(x + 1, y + 3, v[3][1], bitmap16);
            setCol16(x + 2, y + 3, v[3][2], bitmap16);
            setCol16(x + 3, y + 3, v[3][3], bitmap16);
        }
    }

    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            const { r, g, b } = generate24BitValue(x, y, 1, bitmap16);
            const idx = (width * y + x) << 2;
            png.data[idx] = r;
            png.data[idx + 1] = g;
            png.data[idx + 2] = b;
            png.data[idx + 3] = 0xFF;
        }
    }

    png.pack().pipe(fs.createWriteStream(outputFilePath));
}

function generateBitmapDC(fileData, outputFilePath, decodeImage = true) {
    const trimmedData = decodeImage ? removeLineBreaks(fileData) : fileData;
    const decodedData = decodeImage ? decode(trimmedData) : trimmedData;
    fs.writeFileSync('raw_dc_inline', decodedData);
 
    // Image data is bmp 2 bytes per pixel 2x8 16 bit color in RGB565
    const width = 256;
    const height = 192;
    const bytesPerColor = 2;
    const vmsHeaderLength = 643;
    const targetLen = width * height * bytesPerColor;

    let buffer = Buffer.from(decodedData);

    // Trim header
    // const header = buffer.slice(0, vmsHeaderLength);
    // console.log("Header " + header);
    buffer = buffer.slice(vmsHeaderLength, buffer.length);

    // Extract metadata at the end
    // const metadata = buffer.slice(targetLen, buffer.length);
    // console.log("Metadata " + metadata);

    const bmp = Array.from({ length: width }, () => Array(height));

    let x = 0;
    let y = 0;
    for (let i = 0; i < targetLen; i += 2) {
        let colorBits = buffer.slice(i, i + 2);
        let color = (colorBits[0] << 8) | colorBits[1];

        let r = (color >> 11) & 0x1F; // Extract the top 5 bits for red
        let g = (color >> 5) & 0x3F;  // Extract the next 6 bits for green
        let b = color & 0x1F;         // Extract the last 5 bits for blue
        
        // Scale them to 8-bit values
        r = (r << 3) | (r >> 2); 
        g = (g << 2) | (g >> 4); 
        b = (b << 3) | (b >> 2);

        bmp[x][y] = { r, g, b };

        x++;
        if (x >= width) {
            x = 0;
            y++;
        }
    }

    const png = new PNG({ width, height });

    // Fill the PNG data with the BMP image data
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pngIndex = (x + y * width) * 4; // PNG uses RGBA (4 bytes per pixel)

            png.data[pngIndex] = bmp[x][y].r; // R
            png.data[pngIndex + 1] = bmp[x][y].g; // G
            png.data[pngIndex + 2] = bmp[x][y].b; // B
            png.data[pngIndex + 3] = 0xFF; // A (full opacity)
        }
    }

    png.pack().pipe(fs.createWriteStream(outputFilePath));
}

function removeLineBreaks(data) {
    let trimmedData = [];
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== 10 && data[i] !== 13) {
            trimmedData.push(data[i]);
        }
    }

    return trimmedData;
}

module.exports = {
    generateBitmap,
    generateBitmapDC,
};