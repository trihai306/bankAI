import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { getModelsDir, getPythonDir, getLlamaWorkerPath, getProjectRoot } from "./paths.js";

const require = createRequire(import.meta.url);
const { nodewhisper } = require("nodejs-whisper");
import { whisperServer } from "./whisper-server.js";
import { ttsServer } from "./tts-server.js";

// Fix shelljs execPath for Electron: shelljs skips process.execPath in Electron,
// but nodejs-whisper needs it for ffmpeg conversion via shelljs.exec()
const shelljs = require("shelljs");
const nodeBin = shelljs.which("node");
if (nodeBin) {
  shelljs.config.execPath = nodeBin.toString();
}

import { spawn, fork, execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import { initDB, dbAPI } from "./db.js";
import { VoiceConversationEngine } from "./voice-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cross-platform Python path helpers
const isWindows = process.platform === "win32";
const PYTHON_DIR = getPythonDir();

function getPythonPaths() {
  const venvDir = path.join(PYTHON_DIR, "venv");
  if (isWindows) {
    return {
      python: path.join(venvDir, "python.exe"),
      pip: path.join(venvDir, "Scripts", "pip.exe"),
      cli: path.join(venvDir, "Scripts", "f5-tts_infer-cli.exe"),
    };
  }
  return {
    python: path.join(venvDir, "bin", "python"),
    pip: path.join(venvDir, "bin", "pip"),
    cli: path.join(venvDir, "bin", "f5-tts_infer-cli"),
  };
}

function getSystemPython() {
  const candidates = isWindows
    ? ["python", "python3", "py"]
    : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const result = execFileSync(cmd, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const ver = result.trim().split(" ").pop();
      const [major, minor] = ver.split(".").map(Number);
      if (major === 3 && minor >= 12) return cmd;
    } catch {
      continue;
    }
  }
  return null;
}

const isDev = process.env.NODE_ENV === "development";

// === Preload Status Tracking ===
let preloadStatus = {
  whisper: "idle", // idle | loading | ready | error
  llm: "idle", // idle | loading | ready | error
  whisperError: null,
  llmError: null,
  startedAt: null,
  completedAt: null,
};

function getAutoPreloadSetting() {
  try {
    const settings = dbAPI.getSettings();
    // Default to true if not set
    return settings.autoPreload !== false;
  } catch {
    return true;
  }
}

function broadcastPreloadStatus() {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send("preload:status-update", preloadStatus);
    }
  }
}

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

app.whenReady().then(async () => {
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

  // Auto-preload models after window is ready
  if (getAutoPreloadSetting()) {
    // Small delay to let the window render first
    setTimeout(() => preloadAllModels(), 2000);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Cleanup all servers/workers on quit
app.on("before-quit", () => {
  console.log("[App] Shutting down all services...");

  // 1. Whisper server (spawned process)
  whisperServer.stop();
  console.log("[App] ✓ Whisper server stopped");

  // 2. TTS server (spawned process)
  ttsServer.stop();
  console.log("[App] ✓ TTS server stopped");

  // 3. Llama worker (forked process)
  if (llamaWorker) {
    try {
      llamaWorker.send({ type: "exit" });
    } catch { /* channel might be closed */ }
    // Force kill after brief grace period
    setTimeout(() => {
      if (llamaWorker) {
        try { llamaWorker.kill(); } catch { /* already dead */ }
        llamaWorker = null;
      }
    }, 1000);
    console.log("[App] ✓ Llama worker stop signal sent");
  }

  console.log("[App] All services cleanup initiated.");
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

// Voice Management IPC (CRUD)
ipcMain.handle("voice:list", () => dbAPI.getVoices());
ipcMain.handle("voice:get", (_, id) => dbAPI.getVoice(id));

ipcMain.handle(
  "voice:create",
  async (_, { name, audioData, filename, transcript, filePath }) => {
    try {
      let finalPath;

      if (filePath) {
        // Use existing file from ref_audio directory
        if (!fs.existsSync(filePath)) {
          return { success: false, error: "File not found: " + filePath };
        }
        finalPath = filePath;
      } else if (audioData) {
        // Upload new recording
        const refPath = path.join(
          REF_AUDIO_DIR,
          filename || `voice_${Date.now()}.webm`,
        );
        const buffer = Buffer.from(audioData);
        fs.writeFileSync(refPath, buffer);

        finalPath = refPath;

        // Convert WebM to WAV if needed
        if (refPath.endsWith(".webm")) {
          const wavPath = refPath.replace(".webm", ".wav");
          try {
            await new Promise((resolve, reject) => {
              const ffmpeg = spawn("ffmpeg", [
                "-i",
                refPath,
                "-ar",
                "24000",
                "-ac",
                "1",
                "-sample_fmt",
                "s16",
                "-y",
                wavPath,
              ]);
              ffmpeg.on("close", (code) => {
                if (code === 0) {
                  try {
                    fs.unlinkSync(refPath);
                  } catch { }
                  resolve();
                } else {
                  reject(new Error(`ffmpeg exited with code ${code}`));
                }
              });
              ffmpeg.on("error", reject);
            });
            finalPath = wavPath;
          } catch (convErr) {
            console.warn(
              "WAV conversion failed, keeping original:",
              convErr.message,
            );
          }
        }
      } else {
        return { success: false, error: "No audio data or file path provided" };
      }

      const voice = dbAPI.createVoice({
        name,
        audio_path: finalPath,
        transcript: transcript || "",
      });
      return { success: true, voice };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("voice:update", async (_, id, data) => {
  try {
    const { name, transcript, audioData, filename, filePath } = data;
    const existingVoice = dbAPI.getVoice(id);
    if (!existingVoice) return { success: false, error: "Voice not found" };

    let newAudioPath;

    if (filePath) {
      // Use existing file from ref_audio
      if (!fs.existsSync(filePath)) {
        return { success: false, error: "File not found: " + filePath };
      }
      newAudioPath = filePath;
    } else if (audioData) {
      // Upload new recording
      const refPath = path.join(
        REF_AUDIO_DIR,
        filename || `voice_${Date.now()}.webm`,
      );
      const buffer = Buffer.from(audioData);
      fs.writeFileSync(refPath, buffer);
      newAudioPath = refPath;

      // Convert WebM to WAV
      if (refPath.endsWith(".webm")) {
        const wavPath = refPath.replace(".webm", ".wav");
        try {
          await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", [
              "-i",
              refPath,
              "-ar",
              "24000",
              "-ac",
              "1",
              "-sample_fmt",
              "s16",
              "-y",
              wavPath,
            ]);
            ffmpeg.on("close", (code) => {
              if (code === 0) {
                try {
                  fs.unlinkSync(refPath);
                } catch { }
                resolve();
              } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
              }
            });
            ffmpeg.on("error", reject);
          });
          newAudioPath = wavPath;
        } catch (convErr) {
          console.warn("WAV conversion failed:", convErr.message);
        }
      }

      // Cleanup old audio file if different
      if (
        existingVoice.audio_path &&
        existingVoice.audio_path !== newAudioPath &&
        fs.existsSync(existingVoice.audio_path)
      ) {
        try {
          fs.unlinkSync(existingVoice.audio_path);
        } catch { }
      }
    }

    // Build update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (transcript !== undefined) updateData.transcript = transcript;
    if (newAudioPath) updateData.audio_path = newAudioPath;

    dbAPI.updateVoice(id, updateData);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice:delete", (_, id) => {
  try {
    const voice = dbAPI.getVoice(id);
    if (voice && voice.audio_path && fs.existsSync(voice.audio_path)) {
      fs.unlinkSync(voice.audio_path);
    }
    dbAPI.deleteVoice(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice:test-generate", async (_, id, genText) => {
  try {
    const voice = dbAPI.getVoice(id);
    if (!voice) return { success: false, error: "Voice not found" };

    const result = await runPython([
      "generate",
      "--ref-audio",
      voice.audio_path,
      "--ref-text",
      voice.transcript || "",
      "--gen-text",
      genText,
      "--speed",
      "1.0",
    ]);

    if (result.success) {
      return {
        success: true,
        audioPath: result.output,
        genText: result.gen_text,
      };
    }
    return { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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

const PYTHON_SCRIPT = path.join(PYTHON_DIR, "f5_tts.py");
const TTS_OUTPUT_DIR = path.join(PYTHON_DIR, "outputs");
const REF_AUDIO_DIR = path.join(PYTHON_DIR, "ref_audio");

// Ensure directories exist
[TTS_OUTPUT_DIR, REF_AUDIO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper to run Python script using venv (cross-platform)
function runPython(args) {
  return new Promise((resolve, reject) => {
    const { python: venvPython } = getPythonPaths();
    const env = { ...process.env };
    env.PYTHONUTF8 = "1";
    env.PYTHONIOENCODING = "utf-8";
    const python = spawn(venvPython, [PYTHON_SCRIPT, ...args], {
      cwd: PYTHON_DIR,
      env,
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
      vocab_exists: result.vocab_exists,
      cli_available: result.cli_available,
      model_dir: result.model_dir,
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

// Pick voice file from system (wav/mp3), copy to ref_audio, auto-convert to wav
ipcMain.handle("tts:pick-voice-file", async (_, voiceName) => {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn file giọng nói",
      filters: [
        { name: "Audio Files", extensions: ["wav", "mp3"] },
      ],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true };
    }

    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath).toLowerCase();

    // Validate audio duration (5-30 seconds) using ffprobe
    const duration = await new Promise((resolve) => {
      const ffprobe = spawn("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        sourcePath,
      ]);
      let output = "";
      ffprobe.stdout.on("data", (d) => { output += d.toString(); });
      ffprobe.stderr.on("data", () => { });
      ffprobe.on("close", (code) => {
        console.log(`[VoiceFile] ffprobe exit code: ${code}, output: "${output.trim()}"`);
        const parsed = parseFloat(output.trim());
        resolve(isNaN(parsed) ? -1 : parsed);
      });
      ffprobe.on("error", (err) => {
        console.error("[VoiceFile] ffprobe error:", err.message);
        resolve(-1);
      });
    });

    console.log(`[VoiceFile] Audio duration: ${duration}s (valid range: 5-30s)`);

    if (duration > 0 && (duration < 5 || duration > 30)) {
      console.log(`[VoiceFile] Duration out of range, rejecting file`);
      return {
        success: false,
        error: "duration_invalid",
        duration: Math.round(duration * 10) / 10,
        min: 5,
        max: 30,
      };
    }

    // Build filename: slug_YYYYMMDD_HHmmss.ext
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const slug = voiceName
      ? voiceName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase()
      : "";
    const destFilename = slug ? `${slug}_${dateStr}${ext}` : `${dateStr}${ext}`;
    const destPath = path.join(REF_AUDIO_DIR, destFilename);

    // Copy file to ref_audio directory
    fs.copyFileSync(sourcePath, destPath);
    console.log(`[VoiceFile] Copied ${sourcePath} -> ${destPath}`);

    let finalPath = destPath;

    // Auto-convert non-wav to wav using ffmpeg
    if (ext !== ".wav") {
      const wavFilename = slug ? `${slug}_${dateStr}.wav` : `${dateStr}.wav`;
      const wavPath = path.join(REF_AUDIO_DIR, wavFilename);

      console.log(`[VoiceFile] Converting ${ext} to WAV...`);

      try {
        await new Promise((resolve, reject) => {
          const ffmpeg = spawn("ffmpeg", [
            "-i", destPath,
            "-ar", "24000",
            "-ac", "1",
            "-sample_fmt", "s16",
            "-y",
            wavPath,
          ]);

          let stderr = "";
          ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });

          ffmpeg.on("close", (code) => {
            if (code === 0) {
              // Delete the original non-wav file
              try { fs.unlinkSync(destPath); } catch { }
              console.log(`[VoiceFile] Converted successfully: ${wavPath}`);
              resolve();
            } else {
              reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
            }
          });

          ffmpeg.on("error", reject);
        });

        finalPath = wavPath;
      } catch (convErr) {
        console.warn("[VoiceFile] Conversion failed, keeping original:", convErr.message);
        // Keep original file if conversion fails
      }
    }

    return {
      success: true,
      path: finalPath,
      filename: path.basename(finalPath),
      originalName: path.basename(sourcePath),
    };
  } catch (error) {
    console.error("[VoiceFile] Error:", error);
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
      .filter((f) => f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".webm"))
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
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
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
      console.error("SECURITY CHECK FAILED: Path not in allowed directories");
      return { success: false, error: "Invalid file path" };
    }

    console.log("Security check passed");

    if (!fs.existsSync(normalizedPath)) {
      console.error("File not found at path:", normalizedPath);
      return { success: false, error: "File not found" };
    }

    console.log("Reading file...");
    const audioBuffer = await fs.promises.readFile(normalizedPath);
    console.log("File read successfully, size:", audioBuffer.length, "bytes");

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

// Transcribe audio to text using persistent whisper-server
ipcMain.handle("tts:transcribe-audio", async (event, audioPath) => {
  console.log("=== TRANSCRIBE AUDIO (whisper-server) ===");
  console.log("Audio path:", audioPath);

  try {
    if (!fs.existsSync(audioPath)) {
      return { success: false, error: "Audio file not found" };
    }

    // Ensure whisper server is running
    if (!whisperServer.isReady()) {
      console.log("[Transcribe] Whisper server not ready, starting...");
      const startResult = await whisperServer.start();
      if (!startResult.success) {
        return { success: false, error: `Whisper server failed to start: ${startResult.error}` };
      }
    }

    const text = await whisperServer.transcribe(audioPath, {
      language: "vi",
    });

    console.log("Transcription result:", text);

    return {
      success: true,
      text,
      language: "vi",
    };
  } catch (error) {
    console.error("Transcription error:", error);
    return { success: false, error: error.message };
  }
});

// Qwen3 - Local AI text processing via node-llama-cpp
// Uses a separate Node.js child process to avoid SIGILL in Electron v40.
// Electron v40 ships Node v24 which is incompatible with llama.cpp native
// binaries compiled or distributed for the system Node.js (v22).

let llamaWorker = null;
let modelStatus = "not_loaded"; // not_loaded | loading | ready | error
let modelLoadingPromise = null;
let pendingPrompts = new Map(); // id -> { resolve, reject }
let promptIdCounter = 0;

const MODELS_DIR = getModelsDir();
const MODEL_URI = "hf:Qwen/Qwen3-4B-GGUF:Q4_K_M";
const LLAMA_WORKER_PATH = getLlamaWorkerPath();

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// All models run on GPU (CUDA) — no CPU fallback
const GPU_MODE = "cuda";

// Find system Node.js binary (not Electron's)
function getSystemNode() {
  const candidates = isWindows ? ["node.exe", "node"] : ["node"];
  const whichCmd = isWindows ? "where.exe" : "which";
  for (const cmd of candidates) {
    try {
      const result = execFileSync(whichCmd, [cmd], { timeout: 3000 })
        .toString()
        .trim()
        .split(/\r?\n/)[0]; // 'where' can return multiple lines on Windows
      if (result) return result;
    } catch {
      // try next
    }
  }
  return "node"; // fallback
}

// Cross-platform spawn helper: .cmd/.bat files on Windows need cmd.exe /c
function crossSpawn(command, args, options = {}) {
  if (isWindows && /\.(cmd|bat)$/i.test(command)) {
    const comSpec = process.env.ComSpec || "cmd.exe";
    return spawn(comSpec, ["/c", command, ...args], options);
  }
  return spawn(command, args, options);
}

// Dispose current worker
async function disposeQwenModel() {
  try {
    if (llamaWorker) {
      llamaWorker.send({ type: "exit" });
      // Give worker time to clean up, then force kill
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (llamaWorker) {
            llamaWorker.kill();
          }
          resolve();
        }, 5000);
        llamaWorker.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      llamaWorker = null;
    }
    // Reject all pending prompts
    for (const [id, { reject }] of pendingPrompts) {
      reject(new Error("Model disposed"));
    }
    pendingPrompts.clear();
    modelLoadingPromise = null;
    modelStatus = "not_loaded";
    console.log("Qwen model disposed");
  } catch (e) {
    console.error("Error disposing model:", e);
  }
}

// Spawn and initialize the llama worker process
async function initQwenModel() {
  if (modelStatus === "ready" && llamaWorker) return;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = new Promise((resolve, reject) => {
    try {
      modelStatus = "loading";
      console.log(
        `=== INITIALIZING QWEN3 4B via worker process (${GPU_MODE}) ===`,
      );

      const nodeBin = getSystemNode();
      console.log("Using system Node.js:", nodeBin);

      // Fork the worker using the system Node.js (not Electron)
      llamaWorker = fork(LLAMA_WORKER_PATH, [], {
        execPath: nodeBin,
        cwd: getProjectRoot(),
        env: {
          ...process.env,
          PROJECT_ROOT: getProjectRoot(),
        },
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      });

      // Pipe worker stdout/stderr to main console
      llamaWorker.stdout.on("data", (data) => {
        process.stdout.write(data);
      });
      llamaWorker.stderr.on("data", (data) => {
        process.stderr.write(data);
      });

      llamaWorker.on("message", (msg) => {
        switch (msg.type) {
          case "status":
            modelStatus = msg.status;
            console.log(`[llama-worker] Status: ${msg.status}`);
            if (msg.status === "ready") {
              resolve();
            } else if (msg.status === "error") {
              modelLoadingPromise = null;
              reject(new Error(msg.error || "Worker init failed"));
            }
            break;
          case "response": {
            const pending = pendingPrompts.get(msg.id);
            if (pending) {
              pendingPrompts.delete(msg.id);
              pending.resolve(msg.text);
            }
            break;
          }
          case "token": {
            const pendingToken = pendingPrompts.get(msg.id);
            if (pendingToken?.onToken) {
              pendingToken.onToken(msg.text);
            }
            break;
          }
          case "stream-end": {
            const pendingStream = pendingPrompts.get(msg.id);
            if (pendingStream) {
              pendingPrompts.delete(msg.id);
              pendingStream.resolve(msg.text);
            }
            break;
          }
          case "error": {
            const pendingErr = pendingPrompts.get(msg.id);
            if (pendingErr) {
              pendingPrompts.delete(msg.id);
              pendingErr.reject(new Error(msg.error));
            }
            break;
          }
          case "disposed":
            modelStatus = "not_loaded";
            break;
        }
      });

      llamaWorker.on("exit", (code) => {
        console.log(`[llama-worker] Process exited with code ${code}`);
        llamaWorker = null;
        const wasLoading = modelStatus === "loading";
        modelStatus = "not_loaded";
        // Always clear the loading promise so the next call
        // spawns a fresh worker instead of re-using a stale one
        modelLoadingPromise = null;
        if (wasLoading) {
          reject(new Error(`Worker exited with code ${code}`));
        }
        // Reject all pending prompts
        for (const [id, { reject: rej }] of pendingPrompts) {
          rej(new Error("Worker exited"));
        }
        pendingPrompts.clear();
      });

      llamaWorker.on("error", (err) => {
        console.error("[llama-worker] Process error:", err);
        modelLoadingPromise = null;
        if (modelStatus === "loading") {
          modelStatus = "error";
          reject(err);
        }
      });

      // Send init command to worker
      llamaWorker.send({
        type: "init",
        gpuMode: GPU_MODE,
        modelsDir: MODELS_DIR,
        modelUri: MODEL_URI,
      });
    } catch (error) {
      modelStatus = "error";
      modelLoadingPromise = null;
      reject(error);
    }
  });

  return modelLoadingPromise;
}

// Send prompt to worker and wait for response
function workerPrompt(text, temperature = 0.3, topP = 0.9) {
  return new Promise((resolve, reject) => {
    if (!llamaWorker || modelStatus !== "ready") {
      reject(new Error("Model not ready"));
      return;
    }
    const id = ++promptIdCounter;
    pendingPrompts.set(id, { resolve, reject });

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      if (pendingPrompts.has(id)) {
        pendingPrompts.delete(id);
        reject(new Error("Prompt timed out"));
      }
    }, 120000);

    // Wrap the resolve/reject to clear timeout
    const originalResolve = resolve;
    const originalReject = reject;
    pendingPrompts.set(id, {
      resolve: (val) => {
        clearTimeout(timeout);
        originalResolve(val);
      },
      reject: (err) => {
        clearTimeout(timeout);
        originalReject(err);
      },
    });

    llamaWorker.send({ type: "prompt", id, text, temperature, topP });
  });
}

// Send prompt to worker with streaming tokens via callback
function workerPromptStream(text, onToken, temperature = 0.3, topP = 0.9) {
  return new Promise((resolve, reject) => {
    if (!llamaWorker || modelStatus !== "ready") {
      reject(new Error("Model not ready"));
      return;
    }
    const id = ++promptIdCounter;

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      if (pendingPrompts.has(id)) {
        pendingPrompts.delete(id);
        reject(new Error("Prompt timed out"));
      }
    }, 120000);

    pendingPrompts.set(id, {
      resolve: (val) => {
        clearTimeout(timeout);
        resolve(val);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
      onToken,
    });

    llamaWorker.send({ type: "prompt-stream", id, text, temperature, topP });
  });
}

// Model status IPC
ipcMain.handle("qwen:status", async () => {
  return {
    status: modelStatus,
    model: "Qwen3 4B",
    engine: "node-llama-cpp (worker)",
    gpuMode: GPU_MODE,
  };
});

// === Hardware Acceleration IPC ===

ipcMain.handle("hardware:get-info", async () => {
  // Detect GPU and CUDA availability
  let gpuName = null;
  let cudaAvailable = false;
  try {
    const result = execFileSync(
      "nvidia-smi",
      ["--query-gpu=name,compute_cap", "--format=csv,noheader,nounits"],
      { timeout: 5000 },
    )
      .toString()
      .trim();
    if (result) {
      const [name, computeCap] = result.split(", ");
      gpuName = name;
      cudaAvailable = true;
    }
  } catch {
    /* no nvidia-smi = no CUDA GPU */
  }

  // Check if local llama build exists
  const localBuildDir = path.join(
    __dirname,
    "..",
    "node_modules",
    "node-llama-cpp",
    "llama",
    "localBuilds",
  );
  const hasLocalBuild = fs.existsSync(localBuildDir);

  // Check whisper.cpp binary
  const whisperBin = path.join(
    __dirname,
    "..",
    "node_modules",
    "nodejs-whisper",
    "cpp",
    "whisper.cpp",
    "build",
    "bin",
    "whisper-cli",
  );
  const whisperReady = fs.existsSync(whisperBin);

  // Detect whisper models
  const whisperModelsDir = path.join(
    __dirname,
    "..",
    "node_modules",
    "nodejs-whisper",
    "cpp",
    "whisper.cpp",
    "models",
  );
  let whisperModels = [];
  try {
    if (fs.existsSync(whisperModelsDir)) {
      whisperModels = fs
        .readdirSync(whisperModelsDir)
        .filter((f) => f.startsWith("ggml-") && f.endsWith(".bin"))
        .map((f) => f.replace("ggml-", "").replace(".bin", ""));
    }
  } catch {
    /* ignore */
  }

  // Check if whisper was built with CUDA
  let whisperBuiltWithCuda = false;
  try {
    const cmakeCache = path.join(
      __dirname,
      "..",
      "node_modules",
      "nodejs-whisper",
      "cpp",
      "whisper.cpp",
      "build",
      "CMakeCache.txt",
    );
    if (fs.existsSync(cmakeCache)) {
      const content = fs.readFileSync(cmakeCache, "utf8");
      whisperBuiltWithCuda = content.includes("GGML_CUDA:BOOL=ON") || content.includes("GGML_CUDA:BOOL=1");
    }
  } catch {
    /* ignore */
  }

  return {
    gpu: gpuName,
    cudaAvailable,
    gpuMode: GPU_MODE,
    whisper: {
      ready: whisperReady,
      engine: "whisper.cpp (whisper-server)",
      builtWithCuda: whisperBuiltWithCuda,
      models: whisperModels,
      serverStatus: whisperServer.getStatus(),
    },
    llm: {
      engine: "node-llama-cpp (worker)",
      hasLocalBuild,
      modelStatus,
    },
    tts: {
      engine: "F5-TTS (persistent server)",
      serverStatus: ttsServer.getStatus(),
    },
  };
});

ipcMain.handle("hardware:get-gpu-mode", async () => {
  return { gpuMode: GPU_MODE };
});

// GPU mode is fixed to CUDA — these handlers kept for frontend compatibility
ipcMain.handle("hardware:set-gpu-mode", async () => {
  return { success: true, gpuMode: GPU_MODE };
});

ipcMain.handle("hardware:rebuild-llama", async () => {
  const npmCmd = isWindows ? "npx.cmd" : "npx";
  const args = [
    "--no",
    "node-llama-cpp",
    "source",
    "build",
    "--gpu",
    "cuda",
  ];

  console.log(`Rebuilding llama.cpp with GPU=cuda...`);

  // Stop llama worker first — it locks native binaries
  if (llamaWorker) {
    console.log("Stopping llama worker before rebuild...");
    await disposeQwenModel();
    // Give OS time to release file handles
    await new Promise((r) => setTimeout(r, 1500));
  }

  return new Promise((resolve) => {
    const child = crossSpawn(npmCmd, args, {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
      env: {
        ...process.env,
        CMAKE_CUDA_ARCHITECTURES: "120",    // RTX 5070 = sm_120
        CUDAFLAGS: "--allow-unsupported-compiler", // VS 2026 support
      },
    });

    let output = "";
    child.stdout.on("data", (d) => {
      output += d.toString();
    });
    child.stderr.on("data", (d) => {
      output += d.toString();
    });

    child.on("close", (code) => {
      console.log(`Rebuild finished with code ${code}`);
      resolve({
        success: code === 0,
        output: output.slice(-500),
        gpuMode: GPU_MODE,
      });
    });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message, gpuMode: GPU_MODE });
    });
  });
});

ipcMain.handle("hardware:reset-llm", async () => {
  await disposeQwenModel();
  return { success: true, status: "not_loaded" };
});

// GPU mode handlers (kept for frontend compat, always returns cuda)
ipcMain.handle("hardware:set-whisper-gpu-mode", async () => {
  return { success: true, gpuMode: GPU_MODE };
});

ipcMain.handle("hardware:set-tts-gpu-mode", async () => {
  return { success: true, gpuMode: GPU_MODE };
});

ipcMain.handle("hardware:rebuild-whisper", async () => {
  const whisperCppPath = path.join(
    __dirname,
    "..",
    "node_modules",
    "nodejs-whisper",
    "cpp",
    "whisper.cpp",
  );
  const buildDir = path.join(whisperCppPath, "build");

  console.log(`Rebuilding whisper.cpp with GPU=cuda...`);

  // Stop whisper server first — it locks DLLs in build dir
  if (whisperServer.isReady()) {
    console.log("Stopping whisper server before rebuild...");
    whisperServer.stop();
    // Give OS time to release file handles
    await new Promise((r) => setTimeout(r, 1500));
  }

  return new Promise((resolve) => {
    // Step 1: Remove existing build directory to force fresh CMake config
    try {
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log("Removed existing build directory");
      }
    } catch (e) {
      console.error("Failed to remove build dir:", e);
    }

    // Step 2: Configure CMake (sm_120 = RTX 5070, allow-unsupported-compiler for VS 2026)
    const cmakeArgs = [
      "-B", "build",
      "-DGGML_CUDA=1",
      "-DCMAKE_CUDA_ARCHITECTURES=120",
      "-DCMAKE_CUDA_FLAGS=--allow-unsupported-compiler",
    ];

    console.log("Running: cmake", cmakeArgs.join(" "));
    const cmakeCmd = isWindows ? "cmake.exe" : "cmake";
    const configProc = spawn(cmakeCmd, cmakeArgs, {
      cwd: whisperCppPath,
      stdio: "pipe",
      env: {
        ...process.env,
        CUDAFLAGS: "--allow-unsupported-compiler", // VS 2026 support
      },
    });

    let output = "";
    configProc.stdout.on("data", (d) => {
      output += d.toString();
    });
    configProc.stderr.on("data", (d) => {
      output += d.toString();
    });

    configProc.on("close", (configCode) => {
      if (configCode !== 0) {
        resolve({
          success: false,
          error: `CMake configure failed (code ${configCode})`,
          output: output.slice(-1000),
          gpuMode,
        });
        return;
      }

      // Step 3: Build
      console.log("Building whisper.cpp...");
      const buildProc = spawn(
        cmakeCmd,
        [
          "--build",
          "build",
          "--config",
          "Release",
          "-j",
          String(Math.max(1, require("os").cpus().length - 1)),
        ],
        { cwd: whisperCppPath, stdio: "pipe" },
      );

      let buildOutput = "";
      buildProc.stdout.on("data", (d) => {
        buildOutput += d.toString();
      });
      buildProc.stderr.on("data", (d) => {
        buildOutput += d.toString();
      });

      buildProc.on("close", (buildCode) => {
        console.log(`Whisper rebuild finished with code ${buildCode}`);
        resolve({
          success: buildCode === 0,
          output: (output + "\n" + buildOutput).slice(-1500),
          gpuMode,
        });
      });

      buildProc.on("error", (err) => {
        resolve({ success: false, error: err.message, gpuMode });
      });
    });

    configProc.on("error", (err) => {
      resolve({ success: false, error: err.message, gpuMode });
    });
  });
});

// Process text IPC
ipcMain.handle("qwen:process-text", async (event, text, task = "correct") => {
  console.log("=== QWEN PROCESS TEXT CALLED ===");
  console.log("Text:", text);
  console.log("Task:", task);

  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await initQwenModel();

      const prompts = {
        correct: `Bạn là trợ lý AI chuyên sửa lỗi chính tả và ngữ pháp tiếng Việt. Hãy sửa văn bản sau thành chính tả đúng, ngữ pháp chuẩn, giữ nguyên ý nghĩa. Chỉ trả về văn bản đã sửa, không giải thích:\n\n${text}`,
        extract: `Hãy phân tích văn bản sau và trích xuất thông tin quan trọng dưới dạng JSON (intent, entities, sentiment):\n\n${text}`,
        answer: `Dựa vào văn bản sau, hãy trả lời câu hỏi một cách ngắn gọn:\n\n${text}`,
        custom: text,
      };

      const prompt = prompts[task] || prompts.custom;
      const response = await workerPrompt(prompt);

      console.log("Qwen3 response:", response);

      return {
        success: true,
        text: response,
        model: "qwen3:4b",
        task: task,
      };
    } catch (error) {
      console.error(
        `Qwen processing error (attempt ${attempt}/${MAX_RETRIES}):`,
        error,
      );
      if (attempt < MAX_RETRIES) {
        // Reset state and retry with a fresh worker
        console.log("Resetting model for retry...");
        await disposeQwenModel();
      }
    }
  }

  // All retries exhausted — graceful fallback
  return {
    success: true,
    text: text,
    model: "none",
    task: task,
    warning: "Qwen3 not available - returned original text",
  };
});

// === Voice Chat (Realtime Voice Conversation) ===
let voiceEngine = null;

function getVoiceEngine() {
  if (!voiceEngine) {
    // Create a transcribe function that uses the persistent whisper server
    const whisperTranscribe = async (wavPath, options) => {
      if (!whisperServer.isReady()) {
        await whisperServer.start();
      }
      return whisperServer.transcribe(wavPath, {
        language: options?.whisperOptions?.language || "vi",
      });
    };

    voiceEngine = new VoiceConversationEngine({
      nodewhisper: whisperTranscribe,
      workerPrompt,
      workerPromptStream,
      initQwenModel,
      runPython,
      ttsServer,
      dbAPI,
    });
  }
  return voiceEngine;
}

ipcMain.handle("voice-chat:start", async (_, config = {}) => {
  try {
    const engine = getVoiceEngine();
    const result = engine.start(config);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice-chat:stop", async () => {
  try {
    const engine = getVoiceEngine();
    return engine.stop();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice-chat:status", async () => {
  const engine = getVoiceEngine();
  return engine.getStatus();
});

ipcMain.handle("voice-chat:process", async (event, audioData, filename) => {
  console.log("\n[IPC] voice-chat:process (NON-STREAM) called");
  try {
    const engine = getVoiceEngine();
    const result = await engine.processAudioChunk(audioData, filename);

    // If TTS generated audio, read it and send back as buffer
    if (result.success && result.audioPath && fs.existsSync(result.audioPath)) {
      const audioBuffer = fs.readFileSync(result.audioPath);
      result.audioData = Array.from(audioBuffer);
      result.audioMimeType = "audio/wav";
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice-chat:process-stream", async (event, audioData, filename) => {
  console.log("\n[IPC] 🚀 voice-chat:process-stream (STREAMING) called");
  try {
    const engine = getVoiceEngine();
    const sender = event.sender;

    const onEvent = (evt) => {
      if (sender.isDestroyed()) return;

      switch (evt.type) {
        case "stt-done":
          sender.send("voice-stream:stt-done", { transcript: evt.transcript });
          break;
        case "llm-chunk":
          sender.send("voice-stream:llm-chunk", { text: evt.text, fullText: evt.fullText });
          break;
        case "tts-audio": {
          // Read audio file and send as buffer
          if (evt.audioPath && fs.existsSync(evt.audioPath)) {
            const audioBuf = fs.readFileSync(evt.audioPath);
            sender.send("voice-stream:tts-audio", {
              audioData: Array.from(audioBuf),
              chunkIndex: evt.chunkIndex,
              mimeType: "audio/wav",
            });
          }
          break;
        }
        case "done":
          sender.send("voice-stream:done", {
            timings: evt.timings,
            responseText: evt.responseText,
            chunkCount: evt.chunkCount,
          });
          break;
        case "tts-chunk-failed":
          sender.send("voice-stream:tts-chunk-failed", {
            chunkIndex: evt.chunkIndex,
          });
          break;
      }
    };

    const result = await engine.processAudioChunkStream(audioData, filename, onEvent);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice-chat:pick-audio", async (event) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Chọn file âm thanh",
      filters: [
        {
          name: "Audio Files",
          extensions: ["wav", "mp3", "webm", "ogg", "flac", "m4a"],
        },
      ],
      properties: ["openFile"],
    });

    if (canceled || !filePaths.length) {
      return { success: false, error: "cancelled" };
    }

    const filePath = filePaths[0];
    const ext = path.extname(filePath).toLowerCase();

    // Ensure voice engine is started
    const engine = getVoiceEngine();
    if (!engine.isActive) {
      engine.start({});
    }

    let wavPath = filePath;

    // Convert non-WAV files to WAV using ffmpeg
    if (ext !== ".wav") {
      const tmpDir = path.join(os.tmpdir(), "bankai-voice");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      wavPath = path.join(tmpDir, `converted_${Date.now()}.wav`);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
          "-i",
          filePath,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-sample_fmt",
          "s16",
          "-y",
          wavPath,
        ]);

        ffmpeg.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}`));
        });
        ffmpeg.on("error", reject);
      });
    }

    // Read WAV and process through voice engine (streaming)
    const audioBuffer = fs.readFileSync(wavPath);
    const audioData = Array.from(new Uint8Array(audioBuffer));
    const sender = event.sender;

    const onEvent = (evt) => {
      if (sender.isDestroyed()) return;
      switch (evt.type) {
        case "stt-done":
          sender.send("voice-stream:stt-done", { transcript: evt.transcript });
          break;
        case "llm-chunk":
          sender.send("voice-stream:llm-chunk", { text: evt.text, fullText: evt.fullText });
          break;
        case "tts-audio": {
          if (evt.audioPath && fs.existsSync(evt.audioPath)) {
            const audioBuf = fs.readFileSync(evt.audioPath);
            sender.send("voice-stream:tts-audio", {
              audioData: Array.from(audioBuf),
              chunkIndex: evt.chunkIndex,
              mimeType: "audio/wav",
            });
          }
          break;
        }
        case "done":
          sender.send("voice-stream:done", {
            timings: evt.timings,
            responseText: evt.responseText,
            chunkCount: evt.chunkCount,
          });
          break;
        case "tts-chunk-failed":
          sender.send("voice-stream:tts-chunk-failed", {
            chunkIndex: evt.chunkIndex,
          });
          break;
      }
    };

    const result = await engine.processAudioChunkStream(
      audioData,
      path.basename(wavPath),
      onEvent,
    );

    // Cleanup converted temp file
    if (wavPath !== filePath) {
      try {
        fs.unlinkSync(wavPath);
      } catch { }
    }

    return result;
  } catch (error) {
    if (error.message === "cancelled") {
      return { success: false, error: "cancelled" };
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle("voice-chat:process-ref-file", async (event, filename) => {
  try {
    if (!filename) {
      return { success: false, error: "No filename provided" };
    }

    // Security: only allow files within REF_AUDIO_DIR
    const filePath = path.join(REF_AUDIO_DIR, path.basename(filename));
    const normalizedPath = path.normalize(filePath);
    const normalizedRefDir = path.normalize(REF_AUDIO_DIR);
    if (!normalizedPath.startsWith(normalizedRefDir)) {
      return { success: false, error: "Invalid file path" };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File not found" };
    }

    // Ensure voice engine is started
    const engine = getVoiceEngine();
    if (!engine.isActive) {
      engine.start({});
    }

    const ext = path.extname(filePath).toLowerCase();
    let wavPath = filePath;

    // Convert non-WAV files to WAV
    if (ext !== ".wav") {
      const tmpDir = path.join(os.tmpdir(), "bankai-voice");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      wavPath = path.join(tmpDir, `converted_${Date.now()}.wav`);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
          "-i",
          filePath,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-sample_fmt",
          "s16",
          "-y",
          wavPath,
        ]);
        ffmpeg.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}`));
        });
        ffmpeg.on("error", reject);
      });
    }

    // Read WAV and process through voice engine (streaming)
    const audioBuffer = fs.readFileSync(wavPath);
    const audioData = Array.from(new Uint8Array(audioBuffer));
    const sender = event.sender;

    const onEvent = (evt) => {
      if (sender.isDestroyed()) return;
      switch (evt.type) {
        case "stt-done":
          sender.send("voice-stream:stt-done", { transcript: evt.transcript });
          break;
        case "llm-chunk":
          sender.send("voice-stream:llm-chunk", { text: evt.text, fullText: evt.fullText });
          break;
        case "tts-audio": {
          if (evt.audioPath && fs.existsSync(evt.audioPath)) {
            const audioBuf = fs.readFileSync(evt.audioPath);
            sender.send("voice-stream:tts-audio", {
              audioData: Array.from(audioBuf),
              chunkIndex: evt.chunkIndex,
              mimeType: "audio/wav",
            });
          }
          break;
        }
        case "done":
          sender.send("voice-stream:done", {
            timings: evt.timings,
            responseText: evt.responseText,
            chunkCount: evt.chunkCount,
          });
          break;
        case "tts-chunk-failed":
          sender.send("voice-stream:tts-chunk-failed", {
            chunkIndex: evt.chunkIndex,
          });
          break;
      }
    };

    const result = await engine.processAudioChunkStream(
      audioData,
      path.basename(wavPath),
      onEvent,
    );

    // Cleanup converted temp file
    if (wavPath !== filePath) {
      try {
        fs.unlinkSync(wavPath);
      } catch { }
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Python Environment Management IPC
const SETUP_SCRIPT = path.join(PYTHON_DIR, "setup_env.py");

ipcMain.handle("python:get-platform", () => {
  return {
    platform: process.platform,
    arch: process.arch,
    isWindows,
    nodeVersion: process.version,
    homeDir: os.homedir(),
  };
});

ipcMain.handle("python:check-env", async () => {
  try {
    const sysPython = getSystemPython();
    if (!sysPython) {
      return {
        ready: false,
        error: "Python 3.12+ not found on system",
        systemPython: null,
      };
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(sysPython, [SETUP_SCRIPT, "check"], {
        cwd: PYTHON_DIR,
      });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const lines = stdout.trim().split("\n");
            const lastLine = lines[lines.length - 1];
            const result = JSON.parse(lastLine);
            resolve(result);
          } catch {
            resolve({
              ready: false,
              error: "Failed to parse check result",
              raw: stdout,
            });
          }
        } else {
          resolve({
            ready: false,
            error: stderr || `Check failed with code ${code}`,
          });
        }
      });

      proc.on("error", (err) => {
        resolve({ ready: false, error: err.message });
      });
    });
  } catch (error) {
    return { ready: false, error: error.message };
  }
});

// === Auto-Preload Models ===

const WHISPER_MODELS_DIR = path.join(
  __dirname,
  "..",
  "node_modules",
  "nodejs-whisper",
  "cpp",
  "whisper.cpp",
  "models",
);
const WHISPER_MODEL_NAME = "medium";

async function preloadWhisperModel() {
  const modelFile = path.join(
    WHISPER_MODELS_DIR,
    `ggml-${WHISPER_MODEL_NAME}.bin`,
  );

  preloadStatus.whisper = "loading";
  broadcastPreloadStatus();
  console.log("[preload] Checking Whisper model...");

  try {
    // Check if model binary exists — if not, download via nodewhisper warmup
    if (!fs.existsSync(modelFile)) {
      console.log(
        `[preload] Whisper model '${WHISPER_MODEL_NAME}' not found, downloading...`,
      );

      // Create a tiny silent WAV file for warmup/download
      const warmupDir = path.join(os.tmpdir(), "bankai-warmup");
      if (!fs.existsSync(warmupDir)) {
        fs.mkdirSync(warmupDir, { recursive: true });
      }
      const warmupWav = path.join(warmupDir, "silence.wav");

      const sampleRate = 16000;
      const numSamples = sampleRate;
      const dataSize = numSamples * 2;
      const headerSize = 44;
      const buffer = Buffer.alloc(headerSize + dataSize);

      buffer.write("RIFF", 0);
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write("WAVE", 8);
      buffer.write("fmt ", 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(sampleRate * 2, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write("data", 36);
      buffer.writeUInt32LE(dataSize, 40);

      fs.writeFileSync(warmupWav, buffer);

      // Run nodewhisper once to trigger model download
      await nodewhisper(warmupWav, {
        modelName: WHISPER_MODEL_NAME,
        autoDownloadModelName: WHISPER_MODEL_NAME,
        removeWavFileAfterTranscription: true,
        whisperOptions: {
          language: "vi",
          outputInText: false,
          outputInJson: false,
        },
      });

      try {
        fs.rmSync(warmupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }

      console.log("[preload] Whisper model downloaded");
    } else {
      const stats = fs.statSync(modelFile);
      console.log(
        `[preload] Whisper model '${WHISPER_MODEL_NAME}' found (${(stats.size / 1024 / 1024).toFixed(0)}MB)`,
      );
    }

    // Now start the persistent whisper-server (model loads once, stays in memory)
    console.log("[preload] Starting persistent whisper-server...");
    const serverResult = await whisperServer.start();

    if (serverResult.success) {
      preloadStatus.whisper = "ready";
      console.log("[preload] Whisper server ready — model loaded in memory");
    } else {
      throw new Error(serverResult.error || "Failed to start whisper server");
    }

    broadcastPreloadStatus();
  } catch (error) {
    console.error("[preload] Whisper preload failed:", error.message);
    preloadStatus.whisper = "error";
    preloadStatus.whisperError = error.message;
    broadcastPreloadStatus();
  }
}

async function preloadLlmModel() {
  preloadStatus.llm = "loading";
  broadcastPreloadStatus();
  console.log("[preload] Loading LLM model...");

  try {
    await initQwenModel();
    preloadStatus.llm = "ready";
    broadcastPreloadStatus();
    console.log("[preload] LLM model ready");
  } catch (error) {
    console.error("[preload] LLM preload failed:", error.message);
    preloadStatus.llm = "error";
    preloadStatus.llmError = error.message;
    broadcastPreloadStatus();
  }
}

async function preloadAllModels() {
  console.log("=== AUTO-PRELOAD MODELS ===");
  preloadStatus.startedAt = Date.now();
  broadcastPreloadStatus();

  // Run whisper + LLM + TTS server in parallel for faster startup
  await Promise.allSettled([
    preloadWhisperModel(),
    preloadLlmModel(),
    ttsServer.start().then((r) => {
      console.log("[preload] TTS server:", r.success ? "ready" : r.error);
    }),
  ]);

  preloadStatus.completedAt = Date.now();
  const elapsed = (
    (preloadStatus.completedAt - preloadStatus.startedAt) /
    1000
  ).toFixed(1);
  console.log(`=== PRELOAD COMPLETE (${elapsed}s) ===`);
  broadcastPreloadStatus();
}

// Preload IPC handlers
ipcMain.handle("preload:get-status", () => preloadStatus);

ipcMain.handle("preload:get-auto-preload", () => {
  return { enabled: getAutoPreloadSetting() };
});

ipcMain.handle("preload:set-auto-preload", (_, enabled) => {
  dbAPI.saveSetting("autoPreload", enabled);
  console.log(`Auto-preload set to: ${enabled}`);
  return { success: true, enabled };
});

ipcMain.handle("preload:trigger", async () => {
  // Manual trigger from frontend
  await preloadAllModels();
  return preloadStatus;
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
