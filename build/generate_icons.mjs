import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';

const buildDir = path.join(process.cwd(), 'build');
const svgPath = path.join(buildDir, 'icon.svg');

async function generateIcons() {
    console.log('Reading SVG...');
    const svgBuffer = fs.readFileSync(svgPath);

    // Generate 256x256 PNG for electron-builder
    const png256Path = path.join(buildDir, 'icon.png');
    await sharp(svgBuffer).resize(256, 256).png().toFile(png256Path);
    console.log('Generated icon.png (256x256)');

    // Generate ICO with sizes NSIS can handle (keep total < 150KB)
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const pngBuffers = [];

    for (const size of icoSizes) {
        const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
        pngBuffers.push(buf);
        console.log(`Prepared ${size}x${size} for ICO`);
    }

    const icoBuffer = await pngToIco(pngBuffers);
    const icoPath = path.join(buildDir, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`Generated icon.ico (${Math.round(icoBuffer.length / 1024)} KB)`);

    console.log('Done!');
}

generateIcons().catch(console.error);
