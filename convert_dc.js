const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function generateBitmapDC(fileData, outputFilePath) {
    // Image data is bmp 2 bytes per pixel 2x8 16 bit color in RGB565
    const width = 256;
    const height = 192;
    const bytesPerColor = 2;
    const vmsHeaderLength = 645;
    const targetLen = width * height * bytesPerColor;

    let buffer = Buffer.from(fileData);

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

module.exports = {
    generateBitmapDC,
}