const fs = require('fs');
const { PNG } = require('pngjs');

function generateBitmapDC(fileData, outputFilePath) {
    const width = 256;
    const height = 192;
    const bytesPerColor = 2;
    const targetLen = width * height * bytesPerColor;
    console.log(targetLen);
    const png = new PNG({ width, height });

    let buffer = Buffer.from(fileData);
    const bufferLen = buffer.length;
    const imageLen = 99840;
    const extraBytes = bufferLen - imageLen;
    console.log(bufferLen, imageLen, extraBytes);

    // Trim extra bytes from beginning
    // buffer = buffer.slice(0, bufferLen - extraBytes - 1);

    // Trim extra bytes from end
    // buffer = buffer.slice(extraBytes - 1, buffer);

    // trim extra bytes from the end due to color format
    // buffer = buffer.slice(0, targetLen)

    // console.log("Working buffer size " + targetLen);

    const bmp = Array.from({ length: width }, () => Array(height));

    let x = 0;
    let y = 0;
    // Image data is bmp 2 bytes per pixel 2x8 16 bit color in RGB565?
    console.log(buffer.length)

    for (let i = 0; i < targetLen; i += 2) {
        let colorBits = buffer.slice(i, i + 2);
        let color = (colorBits[0] << 8) | colorBits[1];

        let r = (color >> 11) & 0x1F; // Extract the top 5 bits for red
        let g = (color >> 5) & 0x3F;  // Extract the next 6 bits for green
        let b = color & 0x1F;         // Extract the last 5 bits for blue
        
        // Scale them to 8-bit values
        r = (r * 255) / 31;
        g = (g * 255) / 63;
        b = (b * 255) / 31;

        //console.log("Setting pixel " + x + ", " + y + " to: " + r + " - " + g + " - " + b)
        bmp[x][y] = { r, g, b };

        x++;
        if (x >= width) {
            //console.log("next row", x, y);
            x = 0;
            y++;
        }


    }

    console.log("Final x y", x, y);
    console.log(bmp[255][191])

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

    // Write the PNG file
    png.pack().pipe(fs.createWriteStream(outputFilePath));
}

module.exports = {
    generateBitmapDC,
}