/**
 * Edge TTS Service - Vietnamese Text-to-Speech
 * Sử dụng Microsoft Edge TTS API - Không cần Python!
 * 
 * Voices Vietnamese:
 * - vi-VN-HoaiMyNeural (Nữ) - Recommended
 * - vi-VN-NamMinhNeural (Nam)
 */

const EdgeTTS = require('edge-tts');
const path = require('path');
const fs = require('fs');

// Vietnamese voices
const VOICES = {
    female: 'vi-VN-HoaiMyNeural',
    male: 'vi-VN-NamMinhNeural'
};

// Output directory
const OUTPUT_DIR = path.join(__dirname, '..', 'tts-output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Get list of available Vietnamese voices
 */
async function getVoices() {
    try {
        const voices = await EdgeTTS.getVoices();
        return voices.filter(v => v.Locale.startsWith('vi-VN'));
    } catch (error) {
        console.error('Error getting voices:', error);
        return [
            { Name: VOICES.female, Locale: 'vi-VN', Gender: 'Female' },
            { Name: VOICES.male, Locale: 'vi-VN', Gender: 'Male' }
        ];
    }
}

/**
 * Generate speech from text
 * @param {string} text - Text to convert to speech
 * @param {object} options - Generation options
 * @returns {Promise<{audioPath: string, audioUrl: string}>}
 */
async function generateSpeech(text, options = {}) {
    const {
        voice = VOICES.female,
        rate = '+0%',      // Speed: -50% to +100%
        pitch = '+0Hz',    // Pitch adjustment
        volume = '+0%'     // Volume adjustment
    } = options;

    const timestamp = Date.now();
    const filename = `tts_${timestamp}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    try {
        const tts = new EdgeTTS({
            voice: voice,
            rate: rate,
            pitch: pitch,
            volume: volume
        });

        await tts.ttsPromise(text, outputPath);

        return {
            success: true,
            audioPath: outputPath,
            filename: filename,
            voice: voice,
            text: text.substring(0, 100)
        };
    } catch (error) {
        console.error('TTS Generation error:', error);
        throw error;
    }
}

/**
 * Generate speech with subtitle/timing data
 */
async function generateWithSubtitles(text, options = {}) {
    const {
        voice = VOICES.female,
        rate = '+0%'
    } = options;

    const timestamp = Date.now();
    const audioPath = path.join(OUTPUT_DIR, `tts_${timestamp}.mp3`);
    const subtitlePath = path.join(OUTPUT_DIR, `tts_${timestamp}.vtt`);

    try {
        const tts = new EdgeTTS({
            voice: voice,
            rate: rate
        });

        // Generate audio with subtitles
        await tts.ttsPromise(text, audioPath);

        // Get subtitle data if available
        let subtitles = null;
        if (tts.subtitles) {
            fs.writeFileSync(subtitlePath, tts.subtitles);
            subtitles = subtitlePath;
        }

        return {
            success: true,
            audioPath: audioPath,
            subtitlePath: subtitles,
            voice: voice
        };
    } catch (error) {
        console.error('TTS with subtitles error:', error);
        throw error;
    }
}

/**
 * Clean up old TTS files (older than 1 hour)
 */
function cleanupOldFiles() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    try {
        const files = fs.readdirSync(OUTPUT_DIR);
        files.forEach(file => {
            const filePath = path.join(OUTPUT_DIR, file);
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs < oneHourAgo) {
                fs.unlinkSync(filePath);
            }
        });
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

// Export functions
module.exports = {
    generateSpeech,
    generateWithSubtitles,
    getVoices,
    cleanupOldFiles,
    VOICES,
    OUTPUT_DIR
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
Edge TTS Vietnamese - CLI Usage:
  node edge-tts.js "Văn bản cần đọc"
  node edge-tts.js "Văn bản" --voice male
  node edge-tts.js --list-voices
        `);
        process.exit(0);
    }

    if (args[0] === '--list-voices') {
        getVoices().then(voices => {
            console.log('Vietnamese Voices:');
            voices.forEach(v => console.log(`  - ${v.Name} (${v.Gender})`));
        });
    } else {
        const text = args[0];
        const voiceArg = args.indexOf('--voice');
        const voice = voiceArg > -1 ? VOICES[args[voiceArg + 1]] || VOICES.female : VOICES.female;

        console.log(`🎙️ Generating: "${text.substring(0, 50)}..."`);
        console.log(`   Voice: ${voice}`);

        generateSpeech(text, { voice }).then(result => {
            console.log(`✅ Generated: ${result.audioPath}`);
        }).catch(err => {
            console.error('❌ Error:', err.message);
            process.exit(1);
        });
    }
}
