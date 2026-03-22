import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { initDB, dbAPI } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prevent EPIPE crashes from child process pipes
process.on('uncaughtException', (err) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return;
    console.error('Uncaught exception:', err);
});

const isDev = process.env.NODE_ENV === 'development';

// ===========================================
// TTS Server Management
// ===========================================
const TTS_SERVER_PORT = 5111;
const TTS_SERVER_URL = `http://127.0.0.1:${TTS_SERVER_PORT}`;
let ttsServerProcess = null;

let ttsServerStopping = false;
let ttsRestartCount = 0;
const TTS_MAX_RESTARTS = 5;

function startTTSServer() {
    if (ttsServerStopping) return;

    const pythonDir = path.join(__dirname, '..', 'python');
    const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
    const serverScript = path.join(pythonDir, 'tts_server.py');

    console.log('Starting TTS server...');
    ttsServerProcess = spawn(venvPython, [serverScript, String(TTS_SERVER_PORT)], {
        cwd: pythonDir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    ttsServerProcess.stdout.on('data', (data) => {
        try {
            const msg = data.toString().trim();
            if (msg) console.log('[TTS Server]', msg);
            if (msg.includes('Running on') || msg.includes('started')) {
                ttsRestartCount = 0;
            }
        } catch {}
    });

    ttsServerProcess.stderr.on('data', (data) => {
        try {
            const msg = data.toString().trim();
            if (msg) console.log('[TTS Server]', msg);
        } catch {}
    });

    ttsServerProcess.on('error', (err) => {
        console.error('TTS server process error:', err.message);
    });

    ttsServerProcess.stdin?.on('error', () => {});
    ttsServerProcess.stdout?.on('error', () => {});
    ttsServerProcess.stderr?.on('error', () => {});

    ttsServerProcess.on('close', (code) => {
        console.log(`TTS server exited with code ${code}`);
        ttsServerProcess = null;
        // Auto-restart with exponential backoff + max retries
        if (!ttsServerStopping && code !== 0) {
            ttsRestartCount++;
            if (ttsRestartCount > TTS_MAX_RESTARTS) {
                console.error(`TTS server crashed ${TTS_MAX_RESTARTS} times, giving up`);
                return;
            }
            const delay = Math.min(3000 * Math.pow(2, ttsRestartCount - 1), 30000);
            console.log(`TTS server crashed, restarting in ${delay / 1000}s (attempt ${ttsRestartCount}/${TTS_MAX_RESTARTS})...`);
            setTimeout(() => startTTSServer(), delay);
        }
    });

    ttsServerProcess.on('error', (err) => {
        console.error('Failed to start TTS server:', err);
        ttsServerProcess = null;
    });
}

function stopTTSServer() {
    ttsServerStopping = true;
    if (ttsServerProcess) {
        console.log('Stopping TTS server...');
        ttsServerProcess.kill('SIGTERM');
        ttsServerProcess = null;
    }
}

async function ttsServerFetch(endpoint, options = {}) {
    const url = `${TTS_SERVER_URL}${endpoint}`;
    // Timeout: 5s for status/health, 180s for generate/transcribe
    const isHeavy = endpoint === '/generate' || endpoint === '/transcribe' || endpoint === '/auto-train';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), isHeavy ? 600000 : 5000); // 10 min for heavy ops

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...options.headers },
        });
        const data = await response.json();
        // FastAPI HTTPException returns {"detail": "..."}, normalize to {success, error}
        if (!response.ok) {
            return { success: false, error: data.detail || data.error || `HTTP ${response.status}` };
        }
        return data;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ===========================================

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a12',
        show: false,
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Prevent opening new Electron windows when clicking links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Open external links in the system browser
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' }; // Always deny new BrowserWindow creation
    });

    // Prevent navigation away from the app (e.g. accidental <a href> full reload)
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const appUrl = isDev ? 'http://localhost:5173' : `file://`;
        if (!url.startsWith(appUrl)) {
            event.preventDefault();
            // If it's an external URL, open in browser
            if (url.startsWith('http://') || url.startsWith('https://')) {
                shell.openExternal(url);
            }
        }
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    return mainWindow;
}

app.whenReady().then(() => {
    // Initialize Database
    try {
        initDB();
    } catch (err) {
        console.error('Database initialization failed:', err);
    }

    // Start TTS server in background (model loads once, stays in memory)
    startTTSServer();

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopTTSServer();
});

// IPC Handlers
ipcMain.handle('app:version', () => app.getVersion());

// ===========================================
// System Setup / Dependency Check IPC
// ===========================================

function checkCommand(cmd) {
    try {
        const result = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return result ? result.split('\n')[0] : null;
    } catch {
        return null;
    }
}

function getCommandVersion(cmd, args = ['--version']) {
    try {
        const result = execSync(`${cmd} ${args.join(' ')}`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return result.split('\n')[0];
    } catch {
        return null;
    }
}

ipcMain.handle('setup:check-all', async () => {
    const pythonDir = path.join(__dirname, '..', 'python');
    const projectRoot = path.join(__dirname, '..');

    // 1. Check ffmpeg
    const ffmpegPath = checkCommand('ffmpeg');
    const ffmpegVersion = ffmpegPath ? getCommandVersion('ffmpeg', ['-version']) : null;

    // 2. Check Python 3.11+
    let pythonPath = null;
    let pythonVersion = null;
    for (const cmd of ['python3', 'python']) {
        const p = checkCommand(cmd);
        if (p) {
            const ver = getCommandVersion(cmd, ['--version']);
            if (ver) {
                const match = ver.match(/(\d+)\.(\d+)/);
                if (match && parseInt(match[1]) === 3 && parseInt(match[2]) >= 11) {
                    pythonPath = p;
                    pythonVersion = ver;
                    break;
                }
            }
        }
    }

    // 3. Check Python venv
    const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
    const venvExists = fs.existsSync(venvPython);

    // 4. Check VieNeu-TTS venv
    const vieneuVenv = path.join(pythonDir, 'VieNeu-TTS', '.venv', 'bin', 'python');
    const vieneuVenvExists = fs.existsSync(vieneuVenv);

    // 5. Check node-llama-cpp
    const llamaDir = path.join(projectRoot, 'node_modules', 'node-llama-cpp');
    const llamaInstalled = fs.existsSync(llamaDir);

    // 6. Check nodejs-whisper
    const whisperDir = path.join(projectRoot, 'node_modules', 'nodejs-whisper');
    const whisperInstalled = fs.existsSync(whisperDir);

    // 7. Check CUDA
    const nvccPath = checkCommand('nvcc');
    const cudaVersion = nvccPath ? getCommandVersion('nvcc', ['--version']) : null;
    let cudaAvailable = !!nvccPath;
    // Also check nvidia-smi
    if (!cudaAvailable) {
        const nvidiaSmi = checkCommand('nvidia-smi');
        cudaAvailable = !!nvidiaSmi;
    }

    // 8. Check torch installed in venv
    let torchInstalled = false;
    if (venvExists) {
        try {
            execSync(`${venvPython} -c "import torch; print(torch.__version__)"`, {
                encoding: 'utf-8',
                timeout: 10000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            torchInstalled = true;
        } catch {}
    }

    // 9. Check TTS server script
    const ttsServerScript = path.join(pythonDir, 'vieneu_tts_server.py');
    const ttsServerExists = fs.existsSync(ttsServerScript);

    // 10. Check better-sqlite3
    const sqliteDir = path.join(projectRoot, 'node_modules', 'better-sqlite3');
    const sqliteInstalled = fs.existsSync(sqliteDir);

    const results = {
        ffmpeg: { installed: !!ffmpegPath, path: ffmpegPath, version: ffmpegVersion },
        python: { installed: !!pythonPath, path: pythonPath, version: pythonVersion },
        pythonVenv: { installed: venvExists, path: venvPython },
        vieneuTTS: { installed: vieneuVenvExists && ttsServerExists, venvExists: vieneuVenvExists, serverScript: ttsServerExists },
        nodeLlamaCpp: { installed: llamaInstalled },
        nodejsWhisper: { installed: whisperInstalled },
        cuda: { available: cudaAvailable, nvcc: nvccPath, version: cudaVersion },
        torch: { installed: torchInstalled },
        sqlite: { installed: sqliteInstalled },
        platform: { system: process.platform, arch: process.arch, nodeVersion: process.version },
    };

    // Overall readiness
    results.allReady = results.ffmpeg.installed &&
        results.python.installed &&
        results.pythonVenv.installed &&
        results.vieneuTTS.installed &&
        results.nodeLlamaCpp.installed &&
        results.nodejsWhisper.installed &&
        results.sqlite.installed;

    return results;
});

ipcMain.handle('setup:install-ffmpeg', async () => {
    try {
        // Try brew on macOS
        if (process.platform === 'darwin') {
            const brew = checkCommand('brew');
            if (brew) {
                execSync('brew install ffmpeg', { encoding: 'utf-8', timeout: 300000, stdio: ['pipe', 'pipe', 'pipe'] });
                return { success: true, message: 'ffmpeg installed via Homebrew' };
            }
            return { success: false, error: 'Homebrew not found. Install Homebrew first: https://brew.sh' };
        }
        // Linux
        if (process.platform === 'linux') {
            execSync('sudo apt-get install -y ffmpeg || sudo yum install -y ffmpeg', { encoding: 'utf-8', timeout: 300000 });
            return { success: true };
        }
        return { success: false, error: 'Please install ffmpeg manually' };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('setup:install-python-env', async (event) => {
    const pythonDir = path.join(__dirname, '..', 'python');
    const setupScript = path.join(pythonDir, 'setup_env.py');

    return new Promise((resolve) => {
        let pythonCmd = 'python3';
        if (!checkCommand('python3')) pythonCmd = 'python';

        const proc = spawn(pythonCmd, [setupScript, 'setup'], {
            cwd: pythonDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let output = '';
        proc.stdout.on('data', (data) => {
            const line = data.toString().trim();
            output += line + '\n';
            try {
                const parsed = JSON.parse(line);
                // Forward progress to renderer
                const win = BrowserWindow.getAllWindows()[0];
                if (win) win.webContents.send('setup:progress', parsed);
            } catch {}
        });

        proc.stderr.on('data', (data) => {
            output += data.toString();
        });

        proc.on('close', (code) => {
            resolve({ success: code === 0, output });
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
});

ipcMain.handle('setup:install-npm-deps', async () => {
    try {
        const projectRoot = path.join(__dirname, '..');
        execSync('npm install', {
            cwd: projectRoot,
            encoding: 'utf-8',
            timeout: 300000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Database IPC
ipcMain.handle('db:stats', () => dbAPI.getDashboardStats());
ipcMain.handle('db:recent-calls', () => dbAPI.getRecentCalls());
ipcMain.handle('db:all-calls', () => dbAPI.getAllCalls());
ipcMain.handle('db:settings', () => dbAPI.getSettings());
ipcMain.handle('db:save-setting', (_, { key, value }) => dbAPI.saveSetting(key, value));
ipcMain.handle('db:add-call', (_, callData) => dbAPI.addCall(callData));

// History IPC
ipcMain.handle('history:calls', (_, filters) => {
    try {
        const calls = dbAPI.getAllCalls();
        return { success: true, calls };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('history:conversations', (_, filters) => {
    try {
        const calls = dbAPI.getAllCalls();
        return { success: true, conversations: calls };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Voice Processing IPC
ipcMain.handle('voice:start-recording', async () => {
    console.log('Starting voice recording...');
    return { success: true };
});

ipcMain.handle('voice:stop-recording', async () => {
    console.log('Stopping voice recording...');
    return { success: true };
});

// Call Management IPC
ipcMain.handle('call:initiate', async (event, phoneNumber) => {
    console.log('Initiating call to:', phoneNumber);
    return { success: true, callId: Date.now().toString() };
});

ipcMain.handle('call:hangup', async (event, callId) => {
    console.log('Hanging up call:', callId);
    return { success: true };
});

// Model Management IPC
ipcMain.handle('model:list', async () => {
    return {
        voice: [],
        llm: [],
    };
});

ipcMain.handle('model:train', async (event, config) => {
    console.log('Starting model training:', config);
    return { success: true, jobId: Date.now().toString() };
});

// TTS - F5-TTS Vietnamese via HTTP Server (model stays loaded in memory)
const TTS_OUTPUT_DIR = path.join(__dirname, '..', 'python', 'outputs');
const REF_AUDIO_DIR = path.join(__dirname, '..', 'python', 'ref_audio');

// Ensure directories exist
[TTS_OUTPUT_DIR, REF_AUDIO_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Keep legacy runPython for install command only
function runPython(args) {
    return new Promise((resolve, reject) => {
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const PYTHON_SCRIPT = path.join(pythonDir, 'f5_tts.py');
        const python = spawn(venvPython, [PYTHON_SCRIPT, ...args], {
            cwd: pythonDir
        });
        let stdout = '';
        let stderr = '';
        python.stdout.on('data', (data) => { stdout += data.toString(); });
        python.stderr.on('data', (data) => { stderr += data.toString(); });
        python.on('close', (code) => {
            if (code === 0) {
                try {
                    const lines = stdout.trim().split('\n');
                    resolve(JSON.parse(lines[lines.length - 1]));
                } catch (e) {
                    resolve({ raw: stdout });
                }
            } else {
                reject(new Error(stderr || `Python exited with code ${code}`));
            }
        });
        python.on('error', (err) => { reject(err); });
    });
}

ipcMain.handle('tts:status', async () => {
    try {
        // Try HTTP server first (fast path)
        const result = await ttsServerFetch('/status');
        return {
            ready: result.ready,
            loading: result.loading || false,
            engine: result.engine || 'F5-TTS Vietnamese',
            model_exists: result.model_exists,
            cli_available: result.cli_available,
            serverMode: true,
            whisperReady: result.whisper_ready || false,
        };
    } catch {
        // Server not up yet, check if model files exist
        const pythonDir = path.join(__dirname, '..', 'python');
        const ckptExists = fs.existsSync(path.join(pythonDir, 'F5-TTS-Vietnamese-ViVoice', 'model_last.pt'));
        return {
            ready: false,
            loading: ckptExists,
            engine: ckptExists ? 'F5-TTS Vietnamese (server starting...)' : 'F5-TTS Vietnamese (not installed)',
            model_exists: ckptExists,
            cli_available: false,
            serverMode: false,
        };
    }
});

ipcMain.handle('tts:install', async () => {
    try {
        const result = await runPython(['install']);
        // Restart TTS server after install
        stopTTSServer();
        startTTSServer();
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Save/load transcript metadata for ref audios
const TRANSCRIPT_FILE = path.join(REF_AUDIO_DIR, '_transcripts.json');

function loadTranscripts() {
    try {
        if (fs.existsSync(TRANSCRIPT_FILE)) {
            return JSON.parse(fs.readFileSync(TRANSCRIPT_FILE, 'utf-8'));
        }
    } catch {}
    return {};
}

function saveTranscripts(data) {
    fs.writeFileSync(TRANSCRIPT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('tts:save-transcript', async (event, { filename, transcript }) => {
    try {
        const transcripts = loadTranscripts();
        transcripts[filename] = transcript;
        saveTranscripts(transcripts);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('tts:get-transcripts', async () => {
    return { success: true, transcripts: loadTranscripts() };
});

ipcMain.handle('tts:upload-ref', async (event, { audioData, filename }) => {
    try {
        // Security: use basename to prevent path traversal
        const safeName = path.basename(filename || `ref_${Date.now()}.wav`);
        const refPath = path.join(REF_AUDIO_DIR, safeName);

        // audioData is ArrayBuffer from renderer
        const buffer = Buffer.from(audioData);
        fs.writeFileSync(refPath, buffer);

        return {
            success: true,
            path: refPath,
            filename: path.basename(refPath)
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('tts:generate', async (event, config) => {
    try {
        const { refAudio, refText, genText, speed = 1.0, nfeStep = 16 } = config;

        if (!refAudio || !genText) {
            return { success: false, error: 'Missing refAudio or genText' };
        }

        // Use HTTP server (model already loaded = fast!)
        const result = await ttsServerFetch('/generate', {
            method: 'POST',
            body: JSON.stringify({
                ref_audio: refAudio,
                ref_text: refText || '',
                gen_text: genText,
                speed: speed,
                nfe_step: nfeStep,
            }),
        });

        if (result.success) {
            return {
                success: true,
                audioPath: result.output,
                genText: result.gen_text,
                elapsed: result.elapsed,
            };
        } else {
            return { success: false, error: result.error };
        }
    } catch (error) {
        console.error('F5-TTS error:', error);
        const msg = error.name === 'AbortError'
            ? 'Generate timeout - text có thể quá dài'
            : (error.message || 'TTS server chưa sẵn sàng, đợi model load xong');
        return { success: false, error: msg };
    }
});

// Get list of reference audios
ipcMain.handle('tts:list-refs', () => {
    try {
        if (!fs.existsSync(REF_AUDIO_DIR)) return [];
        const files = fs.readdirSync(REF_AUDIO_DIR)
            .filter(f => f.endsWith('.wav') || f.endsWith('.webm'))
            .filter(f => !f.startsWith('call_')) // Exclude temp call files
            .map(f => ({
                filename: f,
                path: path.join(REF_AUDIO_DIR, f)
            }));
        return files;
    } catch (error) {
        console.error('List refs error:', error);
        return [];
    }
});

// Get list of generated audio outputs
ipcMain.handle('tts:list-outputs', () => {
    try {
        if (!fs.existsSync(TTS_OUTPUT_DIR)) return [];
        const files = fs.readdirSync(TTS_OUTPUT_DIR)
            .filter(f => f.endsWith('.wav') || f.endsWith('.mp3'))
            .map(f => ({
                filename: f,
                path: path.join(TTS_OUTPUT_DIR, f),
                stats: fs.statSync(path.join(TTS_OUTPUT_DIR, f))
            }))
            .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Newest first
        return files;
    } catch (error) {
        console.error('List outputs error:', error);
        return [];
    }
});

// Delete reference audio
ipcMain.handle('tts:delete-ref', async (event, filepath) => {
    try {
        // Security: only allow deleting files in REF_AUDIO_DIR
        const normalizedPath = path.normalize(filepath);
        const normalizedRefDir = path.normalize(REF_AUDIO_DIR);

        if (!normalizedPath.startsWith(normalizedRefDir)) {
            return { success: false, error: 'Invalid file path' };
        }

        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log('Deleted reference audio:', filepath);
            return { success: true };
        } else {
            return { success: false, error: 'File not found' };
        }
    } catch (error) {
        console.error('Error deleting reference audio:', error);
        return { success: false, error: error.message };
    }
});

// Convert WebM to WAV using ffmpeg for better TTS quality
ipcMain.handle('tts:convert-to-wav', async (event, webmPath) => {
    console.log('=== CONVERT TO WAV ===');
    console.log('Input WebM:', webmPath);

    try {
        const wavPath = webmPath.replace('.webm', '.wav');

        // Security check: only convert files in REF_AUDIO_DIR
        const normalizedWebm = path.normalize(webmPath);
        const normalizedRefDir = path.normalize(REF_AUDIO_DIR);

        if (!normalizedWebm.startsWith(normalizedRefDir)) {
            return { success: false, error: 'Invalid file path' };
        }

        // Check if input exists
        if (!fs.existsSync(webmPath)) {
            return { success: false, error: 'Input file not found' };
        }


        console.log('Converting to WAV with ffmpeg...');

        // Run ffmpeg conversion
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', webmPath,
                '-ar', '24000',        // 24kHz (optimal for TTS)
                '-ac', '1',            // Mono
                '-sample_fmt', 's16',  // 16-bit PCM
                '-y',                  // Overwrite
                wavPath
            ]);


            let stderr = '';
            let stdout = '';

            ffmpeg.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log('ffmpeg stdout:', output);
            });

            ffmpeg.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                console.log('ffmpeg stderr:', output);
            });

            ffmpeg.on('close', (code) => {
                console.log('ffmpeg process closed with code:', code);
                console.log('Full stderr:', stderr);
                console.log('Full stdout:', stdout);

                if (code === 0) {
                    console.log('Conversion successful:', wavPath);

                    // Verify output file exists
                    if (!fs.existsSync(wavPath)) {
                        console.error('WAV file was not created!');
                        resolve({ success: false, error: 'WAV file not created' });
                        return;
                    }

                    // Delete original WebM file
                    try {
                        fs.unlinkSync(webmPath);
                        console.log('Deleted original WebM file');
                    } catch (e) {
                        console.warn('Could not delete WebM:', e);
                    }
                    resolve({ success: true, wavPath: wavPath });
                } else {
                    console.error('ffmpeg failed with code:', code);
                    console.error('stderr:', stderr);
                    resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                }
            });

            ffmpeg.on('error', (err) => {
                console.error('ffmpeg spawn error:', err);
                resolve({ success: false, error: err.message });
            });
        });
    } catch (error) {
        console.error('Conversion error:', error);
        return { success: false, error: error.message };
    }
});

// Read audio file and return as base64 (much faster than Array.from)
ipcMain.handle('tts:read-audio', async (event, filepath) => {
    try {
        // Security: only allow reading files in allowed directories
        const normalizedPath = path.normalize(filepath);
        const normalizedRefDir = path.normalize(REF_AUDIO_DIR);
        const normalizedOutputDir = path.normalize(TTS_OUTPUT_DIR);
        const normalizedEdgeDir = path.normalize(EDGE_TTS_OUTPUT);

        const isAllowed = normalizedPath.startsWith(normalizedRefDir)
            || normalizedPath.startsWith(normalizedOutputDir)
            || normalizedPath.startsWith(normalizedEdgeDir);

        if (!isAllowed) {
            return { success: false, error: 'Invalid file path' };
        }

        if (!fs.existsSync(normalizedPath)) {
            return { success: false, error: 'File not found' };
        }

        const audioBuffer = await fs.promises.readFile(normalizedPath);

        // Determine MIME type from file extension
        const ext = path.extname(normalizedPath).toLowerCase();
        const mimeType = ext === '.wav' ? 'audio/wav' :
            ext === '.webm' ? 'audio/webm' :
                ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';

        return {
            success: true,
            data: audioBuffer.toString('base64'),
            mimeType: mimeType,
            encoding: 'base64',
        };
    } catch (error) {
        console.error('Error reading audio file:', error);
        return { success: false, error: error.message };
    }
});

// Transcribe audio to text using pre-loaded Whisper via HTTP server
ipcMain.handle('tts:transcribe-audio', async (event, audioPath) => {
    try {
        // Security: only allow files in allowed directories
        const normalizedPath = path.normalize(audioPath);
        const allowedDirs = [REF_AUDIO_DIR, TTS_OUTPUT_DIR, EDGE_TTS_OUTPUT].map(d => path.normalize(d));
        if (!allowedDirs.some(dir => normalizedPath.startsWith(dir))) {
            return { success: false, error: 'Invalid file path' };
        }

        if (!fs.existsSync(normalizedPath)) {
            return { success: false, error: 'Audio file not found' };
        }

        // Use HTTP server (Whisper model already loaded = fast!)
        const result = await ttsServerFetch('/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audio_path: normalizedPath }),
        });

        return result;
    } catch (error) {
        console.error('Transcription error:', error);
        const msg = error.name === 'AbortError'
            ? 'Transcription timeout - file audio co the qua dai, thu file ngan hon'
            : (error.message || 'Loi transcribe - thu lai');
        return { success: false, error: msg };
    }
});

// Qwen3 - Local AI text processing via Ollama
ipcMain.handle('qwen:process-text', async (event, text, task = 'correct') => {
    console.log('=== QWEN PROCESS TEXT CALLED ===');
    console.log('Text:', text);
    console.log('Task:', task);

    try {
        const prompts = {
            correct: `Bạn là trợ lý AI chuyên sửa lỗi chính tả và ngữ pháp tiếng Việt. Hãy sửa văn bản sau thành chính tả đúng, ngữ pháp chuẩn, giữ nguyên ý nghĩa. Chỉ trả về văn bản đã sửa, không giải thích:\n\n${text}`,
            extract: `Hãy phân tích văn bản sau và trích xuất thông tin quan trọng dưới dạng JSON (intent, entities, sentiment):\n\n${text}`,
            answer: `Dựa vào văn bản sau, hãy trả lời câu hỏi một cách ngắn gọn:\n\n${text}`,
            custom: text
        };

        const prompt = prompts[task] || prompts.custom;

        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen3:4b',
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Qwen response:', data.response);

        return {
            success: true,
            text: data.response.trim(),
            model: 'qwen3:4b',
            task: task
        };
    } catch (error) {
        console.error('Qwen processing error:', error);
        // Return original text if Qwen is not available (optional feature)
        return {
            success: true,
            text: text, // Original text without correction
            model: 'none',
            task: task,
            warning: 'Qwen not available - returned original text'
        };
    }
});


// ===========================================
// Training Data Management IPC
// ===========================================
const TRAINING_DATA_DIR = path.join(__dirname, '..', 'training-data');

// Ensure training-data directory exists
if (!fs.existsSync(TRAINING_DATA_DIR)) {
    fs.mkdirSync(TRAINING_DATA_DIR, { recursive: true });
}

// List training data files
ipcMain.handle('training:list-files', async () => {
    try {
        const entries = fs.readdirSync(TRAINING_DATA_DIR);
        const files = entries
            .filter(f => /\.(jsonl|json|csv|txt)$/i.test(f))
            .map(f => {
                const filePath = path.join(TRAINING_DATA_DIR, f);
                const stats = fs.statSync(filePath);
                const ext = path.extname(f).slice(1).toLowerCase();
                let lines = 0;
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    lines = content.split('\n').filter(l => l.trim()).length;
                } catch { /* ignore */ }
                const sizeBytes = stats.size;
                const sizeFormatted = sizeBytes < 1024 ? `${sizeBytes} B`
                    : sizeBytes < 1024 * 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB`
                    : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
                return {
                    name: f,
                    ext,
                    size: sizeBytes,
                    sizeFormatted,
                    lines,
                    modified: stats.mtimeMs,
                };
            })
            .sort((a, b) => b.modified - a.modified);
        return { success: true, files };
    } catch (error) {
        console.error('training:list-files error:', error);
        return { success: false, error: error.message, files: [] };
    }
});

// Read & preview training data file (return first N samples)
ipcMain.handle('training:read-file', async (event, filename) => {
    try {
        // Security: only allow reading from TRAINING_DATA_DIR
        const safeName = path.basename(filename);
        const filePath = path.join(TRAINING_DATA_DIR, safeName);

        if (!fs.existsSync(filePath)) {
            return { success: false, error: 'File not found' };
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(safeName).slice(1).toLowerCase();
        const lines = content.split('\n').filter(l => l.trim());
        const totalLines = lines.length;
        const MAX_PREVIEW = 20;

        if (ext === 'jsonl') {
            const samples = lines.slice(0, MAX_PREVIEW).map(line => {
                try { return JSON.parse(line); } catch { return line; }
            });
            return { success: true, samples, totalLines };
        } else if (ext === 'json') {
            try {
                const parsed = JSON.parse(content);
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                return { success: true, samples: arr.slice(0, MAX_PREVIEW), totalLines: arr.length };
            } catch {
                return { success: true, content: content.slice(0, 5000), totalLines };
            }
        } else if (ext === 'csv') {
            const samples = lines.slice(0, MAX_PREVIEW);
            return { success: true, samples, totalLines };
        } else {
            // txt or other
            return { success: true, content: content.slice(0, 5000), totalLines };
        }
    } catch (error) {
        console.error('training:read-file error:', error);
        return { success: false, error: error.message };
    }
});

// Upload a training file
ipcMain.handle('training:upload-file', async (event, data, filename) => {
    try {
        const safeName = path.basename(filename);
        const filePath = path.join(TRAINING_DATA_DIR, safeName);
        const buffer = Buffer.from(data);
        fs.writeFileSync(filePath, buffer);
        console.log('Training file uploaded:', safeName);
        return { success: true, filename: safeName };
    } catch (error) {
        console.error('training:upload-file error:', error);
        return { success: false, error: error.message };
    }
});

// Delete a training file
ipcMain.handle('training:delete-file', async (event, filename) => {
    try {
        const safeName = path.basename(filename);
        const filePath = path.join(TRAINING_DATA_DIR, safeName);

        if (!filePath.startsWith(path.normalize(TRAINING_DATA_DIR))) {
            return { success: false, error: 'Invalid file path' };
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Training file deleted:', safeName);
            return { success: true };
        }
        return { success: false, error: 'File not found' };
    } catch (error) {
        console.error('training:delete-file error:', error);
        return { success: false, error: error.message };
    }
});

// Add a Q&A sample to JSONL file
ipcMain.handle('training:add-sample', async (event, { question, answer, targetFile }) => {
    try {
        let safeName = targetFile === '_new_' ? 'training_custom.jsonl' : path.basename(targetFile);
        if (!safeName.endsWith('.jsonl')) safeName += '.jsonl';

        const filePath = path.join(TRAINING_DATA_DIR, safeName);

        const sample = {
            instruction: "Tra loi cau hoi ve dich vu ngan hang",
            input: question,
            output: answer,
        };

        const line = JSON.stringify(sample) + '\n';

        // Append to file (create if doesn't exist)
        fs.appendFileSync(filePath, line, 'utf-8');
        console.log('Added QA sample to:', safeName);
        return { success: true, filename: safeName };
    } catch (error) {
        console.error('training:add-sample error:', error);
        return { success: false, error: error.message };
    }
});

// Build/train model - runs python train_qwen.py build
ipcMain.handle('training:build-model', async () => {
    try {
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const trainScript = path.join(pythonDir, 'train_qwen.py');

        // Check if script exists
        if (!fs.existsSync(trainScript)) {
            return {
                success: false,
                error: 'train_qwen.py not found in python/ directory. Please create the training script first.',
                logs: ['train_qwen.py not found']
            };
        }

        return new Promise((resolve) => {
            const logs = [];
            const proc = spawn(venvPython, [trainScript, 'build'], {
                cwd: pythonDir,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            proc.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(l => logs.push(l));
                console.log('[train_qwen]', data.toString().trim());
            });

            proc.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(l => logs.push(l));
                console.log('[train_qwen stderr]', data.toString().trim());
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, logs });
                } else {
                    resolve({ success: false, error: `Training exited with code ${code}`, logs });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message, logs });
            });
        });
    } catch (error) {
        console.error('training:build-model error:', error);
        return { success: false, error: error.message, logs: [] };
    }
});

// ═══════════════════════════════════════════════════════════════════
// RAG Engine - TF-IDF + N-gram + Cache
// ═══════════════════════════════════════════════════════════════════

const _rag = {
    knowledge: [],       // [{q, a, tokens, bigrams, qTokens, id}]
    idf: {},             // {token: idf_score}
    invertedIndex: {},   // {token: Set<docId>} - O(1) lookup
    lastHash: '',
    ready: false,
};

// Vietnamese stopwords (bỏ qua khi tính TF-IDF)
const STOPWORDS = new Set([
    'là', 'và', 'của', 'có', 'được', 'cho', 'không', 'một', 'các', 'này',
    'với', 'trong', 'để', 'từ', 'đến', 'người', 'nhưng', 'hay', 'hoặc',
    'rất', 'cũng', 'đã', 'sẽ', 'đang', 'thì', 'mà', 'ở', 'khi', 'nếu',
    'về', 'theo', 'như', 'tôi', 'bạn', 'anh', 'chị', 'em', 'ông', 'bà',
    'the', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'a', 'in', 'it',
    'bao', 'nhiêu', 'nào', 'gì', 'sao', 'thế', 'nên', 'vì', 'do', 'bị',
    'ra', 'vào', 'lên', 'xuống', 'qua', 'lại', 'đi', 'tới',
]);

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[.,!?;:"""''()\-\/\\]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function getBigrams(tokens) {
    const bigrams = [];
    for (let i = 0; i < tokens.length - 1; i++) {
        bigrams.push(tokens[i] + '_' + tokens[i + 1]);
    }
    return bigrams;
}

function getFilesHash() {
    try {
        const entries = fs.readdirSync(TRAINING_DATA_DIR);
        const stats = entries.map(f => {
            try {
                const s = fs.statSync(path.join(TRAINING_DATA_DIR, f));
                return `${f}:${s.size}:${s.mtimeMs}`;
            } catch { return f; }
        });
        return stats.join('|');
    } catch { return ''; }
}

function ragBuildIndex() {
    const hash = getFilesHash();
    if (hash === _rag.lastHash && _rag.ready) return; // No changes

    console.log('[RAG] Building index...');
    const t0 = Date.now();
    _rag.knowledge = [];
    _rag.idf = {};

    // 1. Parse all training files
    try {
        const entries = fs.readdirSync(TRAINING_DATA_DIR);
        for (const f of entries) {
            const filePath = path.join(TRAINING_DATA_DIR, f);
            const content = fs.readFileSync(filePath, 'utf-8');
            const ext = path.extname(f).slice(1).toLowerCase();

            if (ext === 'jsonl') {
                for (const line of content.split('\n')) {
                    if (!line.trim()) continue;
                    try {
                        const obj = JSON.parse(line);
                        if (obj.messages) {
                            const user = obj.messages.find(m => m.role === 'user');
                            const asst = obj.messages.find(m => m.role === 'assistant');
                            if (user && asst) _rag.knowledge.push({ q: user.content, a: asst.content });
                        }
                        if (obj.input && obj.output) {
                            _rag.knowledge.push({ q: obj.input, a: obj.output });
                        }
                    } catch {}
                }
            } else if (ext === 'json') {
                try {
                    const arr = JSON.parse(content);
                    for (const obj of (Array.isArray(arr) ? arr : [arr])) {
                        if (obj.question && obj.answer) _rag.knowledge.push({ q: obj.question, a: obj.answer });
                        if (obj.input && obj.output) _rag.knowledge.push({ q: obj.input, a: obj.output });
                    }
                } catch {}
            } else if (ext === 'csv') {
                const lines = content.split('\n').filter(l => l.trim());
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split(',');
                    if (parts.length >= 2) {
                        _rag.knowledge.push({ q: parts[0].replace(/"/g, ''), a: parts.slice(1).join(',').replace(/"/g, '') });
                    }
                }
            } else if (ext === 'txt') {
                for (const line of content.split('\n')) {
                    if (line.trim()) _rag.knowledge.push({ q: '', a: line.trim() });
                }
            }
        }
    } catch (e) {
        console.warn('[RAG] Parse error:', e.message);
    }

    // 2. Tokenize + build inverted index + compute IDF
    const docFreq = {};
    const N = _rag.knowledge.length || 1;
    _rag.invertedIndex = {};

    for (let id = 0; id < _rag.knowledge.length; id++) {
        const item = _rag.knowledge[id];
        item.id = id;
        const text = item.q + ' ' + item.a;
        item.tokens = new Set(tokenize(text));
        item.bigrams = new Set(getBigrams([...item.tokens]));
        item.qTokens = new Set(tokenize(item.q));

        // Build inverted index: token → set of doc IDs
        const allTerms = new Set([...item.tokens, ...item.bigrams]);
        for (const t of allTerms) {
            if (!_rag.invertedIndex[t]) _rag.invertedIndex[t] = new Set();
            _rag.invertedIndex[t].add(id);
            docFreq[t] = (docFreq[t] || 0) + 1;
        }
    }

    // IDF = log(N / df)
    for (const [term, df] of Object.entries(docFreq)) {
        _rag.idf[term] = Math.log(N / df);
    }

    _rag.lastHash = hash;
    _rag.ready = true;
    console.log(`[RAG] Indexed ${_rag.knowledge.length} items, ${Object.keys(_rag.invertedIndex).length} terms in ${Date.now() - t0}ms`);
}

function findRelevantContext(question, topN = 5) {
    ragBuildIndex(); // Rebuild if files changed

    const qTokens = tokenize(question);
    const qBigrams = getBigrams(qTokens);
    const queryTerms = [...qTokens, ...qBigrams];

    if (queryTerms.length === 0) return [];

    // Inverted index lookup: chỉ score docs chứa ít nhất 1 query term
    const candidateIds = new Set();
    for (const qt of queryTerms) {
        const docs = _rag.invertedIndex[qt];
        if (docs) {
            for (const id of docs) candidateIds.add(id);
        }
    }

    if (candidateIds.size === 0) return [];

    // Score chỉ candidates (không scan toàn bộ)
    const scored = [];
    for (const id of candidateIds) {
        const item = _rag.knowledge[id];
        let score = 0;

        for (const qt of queryTerms) {
            if (item.tokens.has(qt)) score += (_rag.idf[qt] || 1);
            if (item.qTokens.has(qt)) score += (_rag.idf[qt] || 1) * 3;
        }
        for (const qb of qBigrams) {
            if (item.bigrams.has(qb)) score += (_rag.idf[qb] || 2) * 2;
        }

        if (score > 0.5) scored.push({ q: item.q, a: item.a, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
}

// Alias for backward compat
function loadTrainingKnowledge() {
    ragBuildIndex();
    return _rag.knowledge;
}

// Test model: Direct Lookup → Ollama (aibank-qwen hoặc qwen3)
ipcMain.handle('training:test-model', async (event, text) => {
    try {
        const t0 = Date.now();

        // 1. TF-IDF search (cached, ~0ms after first call)
        const relevant = findRelevantContext(text, 5);
        const searchMs = Date.now() - t0;
        console.log(`[RAG] Search: ${searchMs}ms, found ${relevant.length} items (scores: ${relevant.map(r => r.score.toFixed(1)).join(',')}), total: ${_rag.knowledge.length}`);

        // 2. Build context cho LLM (luôn để LLM trả lời tự nhiên)
        let contextBlock = '';
        if (relevant.length > 0) {
            const contextItems = relevant.map(r => {
                if (r.q) return `H: ${r.q}\nD: ${r.a}`;
                return `- ${r.a}`;
            }).join('\n\n');
            contextBlock = `\n\nKIEN THUC TU TRAINING DATA (${relevant.length} ket qua):\n\n${contextItems}\n\n---\nDua tren kien thuc tren, `;
        }

        // 4. Chọn model: ưu tiên aibank-qwen (đã bake dataset), fallback qwen3:4b
        let model = 'qwen3:4b';
        try {
            const listResp = await fetch('http://localhost:11434/api/tags');
            if (listResp.ok) {
                const listData = await listResp.json();
                const models = (listData.models || []).map(m => m.name);
                if (models.some(m => m.startsWith('aibank-qwen'))) {
                    model = 'aibank-qwen';
                    // Model đã có dataset baked in → không cần inject context
                    contextBlock = '';
                }
            }
        } catch {}

        const systemPrompt = model === 'aibank-qwen'
            ? '' // aibank-qwen đã có system prompt với toàn bộ knowledge
            : `Ban la tro ly ngan hang AI chuyen nghiep. Hay dua tren kien thuc duoc cung cap de tra loi khach hang mot cach tu nhien, than thien, de hieu. KHONG copy nguyen van - hay dien dat lai bang loi cua ban. Tra loi bang tieng Viet.`;

        const prompt = `${systemPrompt}${contextBlock}\nKhach hang hoi: ${text}`;

        // 5. Gửi cho Ollama
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: {
                    temperature: 0.15,
                    top_p: 0.8,
                    num_predict: 500,
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const data = await response.json();
        const answer = data.response.trim();

        const totalMs = Date.now() - t0;
        return {
            success: true,
            text: answer,
            model,
            ragContext: relevant.length,
            ragTotal: _rag.knowledge.length,
            ragSearchMs: searchMs,
            ragTopScore: relevant[0]?.score?.toFixed(1) || '0',
            totalMs,
            mode: model === 'aibank-qwen' ? 'trained' : 'rag',
        };
    } catch (error) {
        console.error('training:test-model error:', error);
        return { success: false, error: error.message || 'Ollama chua san sang' };
    }
});

// ===========================================
// F5-TTS Streaming Generate (for Call Center with F5 clone voice)
// ===========================================
ipcMain.handle('tts:generate-stream', async (event, config) => {
    try {
        const { refAudio, refText, genText, speed = 1.0, nfeStep = 8 } = config;
        if (!refAudio || !genText) return { success: false, error: 'Missing params' };

        const result = await ttsServerFetch('/generate-stream', {
            method: 'POST',
            body: JSON.stringify({
                ref_audio: refAudio, ref_text: refText || '',
                gen_text: genText, speed, nfe_step: nfeStep,
            }),
        });
        return result;
    } catch (error) {
        return { success: false, error: error.message || 'TTS server error' };
    }
});

// F5-TTS: Build dataset + Finetune voice
// Get training script text for user to read
ipcMain.handle('tts:get-training-script', async () => {
    try {
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const script = path.join(pythonDir, 'auto_voice_trainer.py');
        return new Promise((resolve) => {
            let stdout = '';
            const proc = spawn(venvPython, [script, 'script'], { cwd: pythonDir });
            proc.stdout.on('data', d => stdout += d.toString());
            proc.on('close', () => resolve({ success: true, text: stdout.trim() }));
            proc.on('error', e => resolve({ success: false, error: e.message }));
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Auto process: long audio → split → transcribe → dataset
ipcMain.handle('tts:auto-process', async (event, audioPath) => {
    try {
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const script = path.join(pythonDir, 'auto_voice_trainer.py');

        return new Promise((resolve) => {
            const logs = [];
            const proc = spawn(venvPython, [script, 'process', audioPath], {
                cwd: pythonDir,
                timeout: 600000, // 10 min max
            });
            proc.stdout.on('data', d => { const l = d.toString().trim(); logs.push(l); console.log('[AutoTrain]', l); });
            proc.stderr.on('data', d => { const l = d.toString().trim(); logs.push(l); });
            proc.on('close', (code) => resolve({ success: code === 0, logs }));
            proc.on('error', (e) => resolve({ success: false, error: e.message, logs }));
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('tts:build-dataset', async () => {
    try {
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const script = path.join(pythonDir, 'build_voice_dataset.py');

        return new Promise((resolve) => {
            const logs = [];
            const proc = spawn(venvPython, [script, 'prepare'], { cwd: pythonDir });
            proc.stdout.on('data', d => { const l = d.toString().trim(); logs.push(l); console.log('[Dataset]', l); });
            proc.stderr.on('data', d => { const l = d.toString().trim(); logs.push(l); });
            proc.on('close', (code) => resolve({ success: code === 0, logs }));
            proc.on('error', (e) => resolve({ success: false, error: e.message, logs }));
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('tts:finetune', async (event, { epochs = 50 } = {}) => {
    try {
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const script = path.join(pythonDir, 'build_voice_dataset.py');

        return new Promise((resolve) => {
            const logs = [];
            const proc = spawn(venvPython, [script, 'train', String(epochs)], { cwd: pythonDir });
            proc.stdout.on('data', d => { const l = d.toString().trim(); logs.push(l); console.log('[Finetune]', l); });
            proc.stderr.on('data', d => { const l = d.toString().trim(); logs.push(l); });
            proc.on('close', (code) => resolve({ success: code === 0, logs }));
            proc.on('error', (e) => resolve({ success: false, error: e.message, logs }));
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ===========================================
// Edge-TTS for Call Center (instant, <1s)
// ===========================================
const EDGE_TTS_OUTPUT = path.join(__dirname, '..', 'tts-output');
if (!fs.existsSync(EDGE_TTS_OUTPUT)) fs.mkdirSync(EDGE_TTS_OUTPUT, { recursive: true });

ipcMain.handle('edge-tts:generate', async (event, { text, voice, rate }) => {
    try {
        const outputFile = path.join(EDGE_TTS_OUTPUT, `edge_${Date.now()}.mp3`);
        const pythonDir = path.join(__dirname, '..', 'python');
        const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
        const voiceArg = voice || 'vi-VN-HoaiMyNeural';
        const rateArg = rate || '+0%';

        return new Promise((resolve) => {
            const proc = spawn(venvPython, [
                '-m', 'edge_tts',
                '--voice', voiceArg,
                '--rate', rateArg,
                '--text', text,
                '--write-media', outputFile,
            ]);
            let stderr = '';
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputFile)) {
                    resolve({ success: true, audioPath: outputFile });
                } else {
                    resolve({ success: false, error: stderr || `Exit code ${code}` });
                }
            });
            proc.on('error', (e) => resolve({ success: false, error: e.message }));
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('edge-tts:voices', async () => {
    return {
        voices: [
            { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Nữ)', gender: 'female' },
            { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam)', gender: 'male' },
        ]
    };
});

// Streaming Qwen - returns sentences one by one
ipcMain.handle('qwen:stream-chat', async (event, { prompt, context }) => {
    try {
        // RAG: TF-IDF search training data
        const relevant = findRelevantContext(prompt, 3);
        let ragContext = '';
        if (relevant.length > 0) {
            ragContext = '\n\nKIEN THUC TU DATASET:\n' + relevant.map(r => r.q ? `Q: ${r.q}\nA: ${r.a}` : `- ${r.a}`).join('\n\n') + '\n\nDua tren kien thuc tren, ';
        }
        const systemPrompt = `Bạn là trợ lý ngân hàng AI. Trả lời ngắn gọn 1-3 câu bằng tiếng Việt, tự nhiên thân thiện như đang nói chuyện với khách hàng. Dùng kiến thức được cung cấp để trả lời chính xác.${ragContext}`;
        const messages = [];
        if (context) {
            context.forEach(m => {
                messages.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text });
            });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen3:4b',
                messages: [{ role: 'system', content: systemPrompt }, ...messages],
                stream: false,
                options: { temperature: 0.3, top_p: 0.9, num_predict: 150 }
            })
        });

        if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
        const data = await response.json();
        const fullText = data.message?.content?.trim() || '';

        // Split into sentences for progressive TTS
        const sentences = fullText
            .split(/(?<=[.!?。])\s*/)
            .filter(s => s.trim().length > 1);

        return { success: true, text: fullText, sentences };
    } catch (error) {
        return { success: false, error: error.message || 'Ollama chưa sẵn sàng' };
    }
});

// ===========================================
// Voice Profile IPC
// ===========================================
ipcMain.handle('profile:list', async () => {
    // Sync profiles từ TTS server vào DB
    try {
        const resp = await fetch(`${TTS_SERVER_URL}/profiles`);
        if (resp.ok) {
            const data = await resp.json();
            const serverProfiles = data.profiles || [];
            const dbProfiles = dbAPI.getProfiles();
            const dbNames = new Set(dbProfiles.map(p => p.name));

            for (const sp of serverProfiles) {
                if (!dbNames.has(sp.name)) {
                    // Profile mới từ TTS server → thêm vào DB
                    dbAPI.createProfile({
                        name: sp.name,
                        ref_audio_path: sp.ref_file || null,
                        transcript: sp.ref_text || null,
                        quality_score: 0,
                        samples_count: 0,
                        total_duration: sp.duration_s || 0,
                        is_trained: 1,
                        model_path: null,
                    });
                    console.log(`[Profile Sync] Added '${sp.name}' from TTS server`);
                }
            }
        }
    } catch (e) {
        // TTS server chưa sẵn sàng - bỏ qua
    }

    const profiles = dbAPI.getProfiles().map(p => ({
        ...p,
        active: !!p.is_active,
        trained: !!p.is_trained,
        samplesCount: p.samples_count,
        qualityScore: p.quality_score,
    }));
    return { profiles };
});
ipcMain.handle('profile:get', (_, id) => dbAPI.getProfile(id));
ipcMain.handle('profile:create', async (_, data) => {
    const result = dbAPI.createProfile(data);

    // Nếu có ref audio, tự động build profile trên TTS server
    if (data.ref_audio_path) {
        try {
            await fetch(`${TTS_SERVER_URL}/build-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: data.name,
                    ref_audio: data.ref_audio_path,
                    ref_text: data.transcript || '',
                }),
            });
            console.log(`[Profile] Built TTS profile '${data.name}'`);
        } catch (e) {
            console.warn(`[Profile] TTS build failed: ${e.message}`);
        }
    }

    return result;
});
ipcMain.handle('profile:update', (_, id, data) => dbAPI.updateProfile(id, data));
ipcMain.handle('profile:delete', (_, id) => dbAPI.deleteProfile(id));
ipcMain.handle('profile:set-active', (_, id) => dbAPI.setActiveProfile(id));
ipcMain.handle('profile:get-active', () => dbAPI.getActiveProfile());

ipcMain.handle('profile:analyze-audio', async (_, audioPath) => {
    try {
        if (!fs.existsSync(audioPath)) {
            return { success: false, error: 'Audio file not found' };
        }

        return new Promise((resolve) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                audioPath
            ]);

            let stdout = '';
            let stderr = '';

            ffprobe.stdout.on('data', (data) => { stdout += data.toString(); });
            ffprobe.stderr.on('data', (data) => { stderr += data.toString(); });

            ffprobe.on('close', (code) => {
                if (code !== 0) {
                    resolve({ success: false, error: `ffprobe exited with code ${code}: ${stderr}` });
                    return;
                }

                try {
                    const info = JSON.parse(stdout);
                    const audioStream = info.streams?.find(s => s.codec_type === 'audio') || {};
                    const format = info.format || {};

                    const duration = parseFloat(format.duration || audioStream.duration || 0);
                    const sampleRate = parseInt(audioStream.sample_rate || 0);
                    const channels = parseInt(audioStream.channels || 0);
                    const bitRate = parseInt(format.bit_rate || audioStream.bit_rate || 0);

                    // Calculate quality score (0-100)
                    let score = 0;

                    // Duration: ideal 3-15s for ref audio (max 30 points)
                    if (duration >= 3 && duration <= 15) score += 30;
                    else if (duration >= 1 && duration <= 30) score += 20;
                    else if (duration > 0) score += 10;

                    // Sample rate: 24kHz+ is good (max 25 points)
                    if (sampleRate >= 44100) score += 25;
                    else if (sampleRate >= 24000) score += 20;
                    else if (sampleRate >= 16000) score += 15;
                    else if (sampleRate > 0) score += 5;

                    // Channels: mono is preferred for TTS (max 15 points)
                    if (channels === 1) score += 15;
                    else if (channels === 2) score += 10;

                    // Bit rate: higher is better (max 15 points)
                    if (bitRate >= 256000) score += 15;
                    else if (bitRate >= 128000) score += 10;
                    else if (bitRate > 0) score += 5;

                    // File exists and is readable (base 15 points)
                    score += 15;

                    score = Math.min(100, score);

                    resolve({
                        success: true,
                        quality_score: score,
                        details: {
                            duration: Math.round(duration * 100) / 100,
                            sample_rate: sampleRate,
                            channels,
                            bit_rate: bitRate,
                            codec: audioStream.codec_name || 'unknown',
                            format: format.format_name || 'unknown',
                        }
                    });
                } catch (parseErr) {
                    resolve({ success: false, error: `Failed to parse ffprobe output: ${parseErr.message}` });
                }
            });

            ffprobe.on('error', (err) => {
                resolve({ success: false, error: `ffprobe not found or failed: ${err.message}` });
            });
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Cleanup old TTS files periodically
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    try {
        const files = fs.readdirSync(TTS_OUTPUT_DIR);
        files.forEach(file => {
            const filePath = path.join(TTS_OUTPUT_DIR, file);
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs < oneHourAgo) {
                fs.unlinkSync(filePath);
            }
        });
    } catch (e) { /* ignore */ }
}, 30 * 60 * 1000);
