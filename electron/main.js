import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import fs from "fs";
import { getLlama, LlamaChatSession, resolveModelFile } from "node-llama-cpp";
import { initDB, dbAPI } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: "hiddenInset",
        backgroundColor: "#0a0a12", // Updated to match new theme
        show: false,
    });

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    if (isDev) {
        mainWindow.loadURL("http://localhost:5174");
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }

    return mainWindow;
}

app.whenReady().then(() => {
    // Initialize Database
    try {
        initDB();
    } catch (err) {
        console.error("Database initialization failed:", err);
    }

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

// IPC Handlers
ipcMain.handle("app:version", () => app.getVersion());

// Database IPC
ipcMain.handle("db:stats", () => dbAPI.getDashboardStats());
ipcMain.handle("db:recent-calls", () => dbAPI.getRecentCalls());
ipcMain.handle("db:all-calls", () => dbAPI.getAllCalls());
ipcMain.handle("db:settings", () => dbAPI.getSettings());
ipcMain.handle("db:save-setting", (_, { key, value }) =>
    dbAPI.saveSetting(key, value),
);

// Voice Processing IPC
ipcMain.handle("voice:start-recording", async () => {
    console.log("Starting voice recording...");
    return { success: true };
});

ipcMain.handle("voice:stop-recording", async () => {
    console.log("Stopping voice recording...");
    return { success: true };
});

// Call Management IPC
ipcMain.handle("call:initiate", async (event, phoneNumber) => {
    console.log("Initiating call to:", phoneNumber);
    return { success: true, callId: Date.now().toString() };
});

ipcMain.handle("call:hangup", async (event, callId) => {
    console.log("Hanging up call:", callId);
    return { success: true };
});

// Model Management IPC
ipcMain.handle("model:list", async () => {
    return {
        voice: [],
        llm: [],
    };
});

ipcMain.handle("model:train", async (event, config) => {
    console.log("Starting model training:", config);
    return { success: true, jobId: Date.now().toString() };
});

// TTS - F5-TTS Vietnamese via Python CLI

const PYTHON_SCRIPT = path.join(__dirname, "..", "python", "f5_tts.py");
const TTS_OUTPUT_DIR = path.join(__dirname, "..", "python", "outputs");
const REF_AUDIO_DIR = path.join(__dirname, "..", "python", "ref_audio");

// Ensure directories exist
[TTS_OUTPUT_DIR, REF_AUDIO_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Helper to run Python script using venv
function runPython(args) {
    return new Promise((resolve, reject) => {
        const pythonDir = path.join(__dirname, "..", "python");
        const venvPython = path.join(pythonDir, "venv", "bin", "python");
        const python = spawn(venvPython, [PYTHON_SCRIPT, ...args], {
            cwd: pythonDir,
        });
        let stdout = "";
        let stderr = "";

        python.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        python.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        python.on("close", (code) => {
            if (code === 0) {
                try {
                    // Get last JSON line
                    const lines = stdout.trim().split("\n");
                    const lastLine = lines[lines.length - 1];
                    resolve(JSON.parse(lastLine));
                } catch (e) {
                    resolve({ raw: stdout });
                }
            } else {
                reject(new Error(stderr || `Python exited with code ${code}`));
            }
        });

        python.on("error", (err) => {
            reject(err);
        });
    });
}

ipcMain.handle("tts:status", async () => {
    try {
        const result = await runPython(["check"]);
        return {
            ready: result.ready,
            engine: "F5-TTS Vietnamese",
            model_exists: result.model_exists,
            cli_available: result.cli_available,
        };
    } catch (error) {
        return {
            ready: false,
            error: error.message,
            engine: "F5-TTS Vietnamese (not installed)",
        };
    }
});

ipcMain.handle("tts:install", async () => {
    try {
        const result = await runPython(["install"]);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("tts:upload-ref", async (event, { audioData, filename }) => {
    try {
        const refPath = path.join(
            REF_AUDIO_DIR,
            filename || `ref_${Date.now()}.wav`,
        );

        // audioData is ArrayBuffer from renderer
        const buffer = Buffer.from(audioData);
        fs.writeFileSync(refPath, buffer);

        return {
            success: true,
            path: refPath,
            filename: path.basename(refPath),
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle("tts:generate", async (event, config) => {
    try {
        const { refAudio, refText, genText, speed = 1.0 } = config;

        if (!refAudio || !genText) {
            return { success: false, error: "Missing refAudio or genText" };
        }

        const result = await runPython([
            "generate",
            "--ref-audio",
            refAudio,
            "--ref-text",
            refText || "",
            "--gen-text",
            genText,
            "--speed",
            String(speed),
        ]);

        if (result.success) {
            return {
                success: true,
                audioPath: result.output,
                genText: result.gen_text,
            };
        } else {
            return { success: false, error: result.error };
        }
    } catch (error) {
        console.error("F5-TTS error:", error);
        return { success: false, error: error.message };
    }
});

// Get list of reference audios
ipcMain.handle("tts:list-refs", () => {
    try {
        if (!fs.existsSync(REF_AUDIO_DIR)) return [];
        const files = fs
            .readdirSync(REF_AUDIO_DIR)
            .filter((f) => f.endsWith(".wav") || f.endsWith(".webm"))
            .map((f) => ({
                filename: f,
                path: path.join(REF_AUDIO_DIR, f),
            }));
        return files;
    } catch (error) {
        console.error("List refs error:", error);
        return [];
    }
});

// Get list of generated audio outputs
ipcMain.handle("tts:list-outputs", () => {
    try {
        if (!fs.existsSync(TTS_OUTPUT_DIR)) return [];
        const files = fs
            .readdirSync(TTS_OUTPUT_DIR)
            .filter((f) => f.endsWith(".wav") || f.endsWith(".mp3"))
            .map((f) => ({
                filename: f,
                path: path.join(TTS_OUTPUT_DIR, f),
                stats: fs.statSync(path.join(TTS_OUTPUT_DIR, f)),
            }))
            .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Newest first
        return files;
    } catch (error) {
        console.error("List outputs error:", error);
        return [];
    }
});

// Delete reference audio
ipcMain.handle("tts:delete-ref", async (event, filepath) => {
    try {
        // Security: only allow deleting files in REF_AUDIO_DIR
        const normalizedPath = path.normalize(filepath);
        const normalizedRefDir = path.normalize(REF_AUDIO_DIR);

        if (!normalizedPath.startsWith(normalizedRefDir)) {
            return { success: false, error: "Invalid file path" };
        }

        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log("Deleted reference audio:", filepath);
            return { success: true };
        } else {
            return { success: false, error: "File not found" };
        }
    } catch (error) {
        console.error("Error deleting reference audio:", error);
        return { success: false, error: error.message };
    }
});

// Convert WebM to WAV using ffmpeg for better TTS quality
ipcMain.handle("tts:convert-to-wav", async (event, webmPath) => {
    console.log("=== CONVERT TO WAV ===");
    console.log("Input WebM:", webmPath);

    try {
        const wavPath = webmPath.replace(".webm", ".wav");

        // Security check: only convert files in REF_AUDIO_DIR
        const normalizedWebm = path.normalize(webmPath);
        const normalizedRefDir = path.normalize(REF_AUDIO_DIR);

        if (!normalizedWebm.startsWith(normalizedRefDir)) {
            return { success: false, error: "Invalid file path" };
        }

        // Check if input exists
        if (!fs.existsSync(webmPath)) {
            return { success: false, error: "Input file not found" };
        }

        console.log("Converting to WAV with ffmpeg...");

        // Run ffmpeg conversion
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", [
                "-i",
                webmPath,
                "-ar",
                "24000", // 24kHz (optimal for TTS)
                "-ac",
                "1", // Mono
                "-sample_fmt",
                "s16", // 16-bit PCM
                "-y", // Overwrite
                wavPath,
            ]);

            let stderr = "";
            let stdout = "";

            ffmpeg.stdout.on("data", (data) => {
                const output = data.toString();
                stdout += output;
                console.log("ffmpeg stdout:", output);
            });

            ffmpeg.stderr.on("data", (data) => {
                const output = data.toString();
                stderr += output;
                console.log("ffmpeg stderr:", output);
            });

            ffmpeg.on("close", (code) => {
                console.log("ffmpeg process closed with code:", code);
                console.log("Full stderr:", stderr);
                console.log("Full stdout:", stdout);

                if (code === 0) {
                    console.log("Conversion successful:", wavPath);

                    // Verify output file exists
                    if (!fs.existsSync(wavPath)) {
                        console.error("WAV file was not created!");
                        reject(new Error("WAV file not created"));
                        return;
                    }

                    // Delete original WebM file
                    try {
                        fs.unlinkSync(webmPath);
                        console.log("Deleted original WebM file");
                    } catch (e) {
                        console.warn("Could not delete WebM:", e);
                    }
                    resolve({ success: true, wavPath: wavPath });
                } else {
                    console.error("ffmpeg failed with code:", code);
                    console.error("stderr:", stderr);
                    reject(
                        new Error(`ffmpeg exited with code ${code}: ${stderr}`),
                    );
                }
            });

            ffmpeg.on("error", (err) => {
                console.error("ffmpeg spawn error:", err);
                reject(err);
            });
        });
    } catch (error) {
        console.error("Conversion error:", error);
        return { success: false, error: error.message };
    }
});

// Read audio file and return as buffer
ipcMain.handle("tts:read-audio", async (event, filepath) => {
    console.log("=== READ AUDIO FILE CALLED ===");
    console.log("Requested filepath:", filepath);
    console.log("REF_AUDIO_DIR:", REF_AUDIO_DIR);
    console.log("TTS_OUTPUT_DIR:", TTS_OUTPUT_DIR);

    try {
        // Security: only allow reading files in REF_AUDIO_DIR or TTS_OUTPUT_DIR
        const normalizedPath = path.normalize(filepath);
        const normalizedRefDir = path.normalize(REF_AUDIO_DIR);
        const normalizedOutputDir = path.normalize(TTS_OUTPUT_DIR);

        console.log("Normalized filepath:", normalizedPath);
        console.log("Normalized ref dir:", normalizedRefDir);
        console.log("Normalized output dir:", normalizedOutputDir);

        const isInRefDir = normalizedPath.startsWith(normalizedRefDir);
        const isInOutputDir = normalizedPath.startsWith(normalizedOutputDir);

        console.log("Path in ref dir?", isInRefDir);
        console.log("Path in output dir?", isInOutputDir);

        if (!isInRefDir && !isInOutputDir) {
            console.error(
                "SECURITY CHECK FAILED: Path not in allowed directories",
            );
            return { success: false, error: "Invalid file path" };
        }

        console.log("Security check passed");

        if (!fs.existsSync(normalizedPath)) {
            console.error("File not found at path:", normalizedPath);
            return { success: false, error: "File not found" };
        }

        console.log("Reading file...");
        const audioBuffer = await fs.promises.readFile(normalizedPath);
        console.log(
            "File read successfully, size:",
            audioBuffer.length,
            "bytes",
        );

        // Determine MIME type from file extension
        const ext = path.extname(normalizedPath).toLowerCase();
        const mimeType =
            ext === ".wav"
                ? "audio/wav"
                : ext === ".webm"
                  ? "audio/webm"
                  : ext === ".mp3"
                    ? "audio/mpeg"
                    : "audio/wav";

        return {
            success: true,
            data: Array.from(audioBuffer), // Convert Buffer to array for IPC transfer
            mimeType: mimeType,
        };
    } catch (error) {
        console.error("Error reading audio file:", error);
        return { success: false, error: error.message };
    }
});

// Transcribe audio to text using Whisper
ipcMain.handle("tts:transcribe-audio", async (event, audioPath) => {
    console.log("=== TRANSCRIBE AUDIO CALLED ===");
    console.log("Audio path:", audioPath);

    try {
        // Validate file exists
        if (!fs.existsSync(audioPath)) {
            return { success: false, error: "Audio file not found" };
        }

        const pythonPath = path.join(__dirname, "../python/venv/bin/python3");
        const scriptPath = path.join(__dirname, "../python/transcribe.py");

        console.log("Python path:", pythonPath);
        console.log("Script path:", scriptPath);
        console.log("Spawning transcription process...");

        return new Promise((resolve, reject) => {
            const transcribe = spawn(pythonPath, [
                scriptPath,
                audioPath,
                "medium",
            ]);
            let stdout = "";
            let stderr = "";

            transcribe.stdout.on("data", (data) => {
                stdout += data.toString();
            });

            transcribe.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            transcribe.on("close", (code) => {
                console.log("Transcription process closed with code:", code);
                console.log("Stdout:", stdout);

                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout);
                        resolve(result);
                    } catch (e) {
                        resolve({
                            success: false,
                            error: "Failed to parse transcription result",
                        });
                    }
                } else {
                    resolve({
                        success: false,
                        error: `Transcription failed with code ${code}`,
                    });
                }
            });

            transcribe.on("error", (err) => {
                console.error("Transcription spawn error:", err);
                resolve({ success: false, error: err.message });
            });
        });
    } catch (error) {
        console.error("Transcription error:", error);
        return { success: false, error: error.message };
    }
});

// Qwen3 - Local AI text processing via node-llama-cpp

// Singleton state for model loading
let llamaInstance = null;
let llamaModel = null;
let llamaContext = null;
let llamaSession = null;
let modelLoadingPromise = null;
let modelStatus = "not_loaded"; // not_loaded | loading | ready | error

const MODELS_DIR = path.join(__dirname, "..", "models");
const MODEL_URI = "hf:Qwen/Qwen3-4B-GGUF:Q4_K_M";

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
}

async function initQwenModel() {
    if (modelStatus === "ready" && llamaSession) return llamaSession;
    if (modelLoadingPromise) return modelLoadingPromise;

    modelLoadingPromise = (async () => {
        try {
            modelStatus = "loading";
            console.log("=== INITIALIZING QWEN3 4B via node-llama-cpp ===");

            // Initialize llama.cpp backend
            llamaInstance = await getLlama();
            console.log("llama.cpp backend initialized");

            // Resolve (download if needed) the model file
            console.log("Resolving model file:", MODEL_URI);
            const modelPath = await resolveModelFile(MODEL_URI, MODELS_DIR);
            console.log("Model path resolved:", modelPath);

            // Load the model
            llamaModel = await llamaInstance.loadModel({ modelPath });
            console.log("Model loaded successfully");

            // Create context
            llamaContext = await llamaModel.createContext();
            console.log("Context created");

            // Create chat session (auto-detects QwenChatWrapper)
            llamaSession = new LlamaChatSession({
                contextSequence: llamaContext.getSequence(),
            });
            console.log("Chat session created");

            modelStatus = "ready";
            return llamaSession;
        } catch (error) {
            console.error("Failed to initialize Qwen3 model:", error);
            modelStatus = "error";
            modelLoadingPromise = null;
            throw error;
        }
    })();

    return modelLoadingPromise;
}

// Model status IPC
ipcMain.handle("qwen:status", async () => {
    return {
        status: modelStatus,
        model: "Qwen3 4B",
        engine: "node-llama-cpp",
    };
});

// Process text IPC
ipcMain.handle("qwen:process-text", async (event, text, task = "correct") => {
    console.log("=== QWEN PROCESS TEXT CALLED ===");
    console.log("Text:", text);
    console.log("Task:", task);

    try {
        const session = await initQwenModel();

        const prompts = {
            correct: `Bạn là trợ lý AI chuyên sửa lỗi chính tả và ngữ pháp tiếng Việt. Hãy sửa văn bản sau thành chính tả đúng, ngữ pháp chuẩn, giữ nguyên ý nghĩa. Chỉ trả về văn bản đã sửa, không giải thích:\n\n${text}`,
            extract: `Hãy phân tích văn bản sau và trích xuất thông tin quan trọng dưới dạng JSON (intent, entities, sentiment):\n\n${text}`,
            answer: `Dựa vào văn bản sau, hãy trả lời câu hỏi một cách ngắn gọn:\n\n${text}`,
            custom: text,
        };

        const prompt = prompts[task] || prompts.custom;

        const response = await session.prompt(prompt, {
            temperature: 0.3,
            topP: 0.9,
        });

        console.log("Qwen3 response:", response);

        return {
            success: true,
            text: response.trim(),
            model: "qwen3:4b",
            task: task,
        };
    } catch (error) {
        console.error("Qwen processing error:", error);
        return {
            success: true,
            text: text,
            model: "none",
            task: task,
            warning: "Qwen3 not available - returned original text",
        };
    }
});

// Cleanup old TTS files periodically
setInterval(
    () => {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        try {
            const files = fs.readdirSync(TTS_OUTPUT_DIR);
            files.forEach((file) => {
                const filePath = path.join(TTS_OUTPUT_DIR, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs < oneHourAgo) {
                    fs.unlinkSync(filePath);
                }
            });
        } catch (e) {
            /* ignore */
        }
    },
    30 * 60 * 1000,
);
