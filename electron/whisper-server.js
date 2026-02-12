/**
 * Whisper Server Manager
 *
 * Manages a persistent whisper-server.exe process from whisper.cpp.
 * Keeps the model loaded in memory so subsequent transcriptions are fast
 * (no re-loading the ~1.5GB model on every call).
 *
 * API: OpenAI-compatible /inference endpoint via HTTP POST multipart.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import http from "http";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");

const WHISPER_SERVER_PORT = 8178; // Uncommon port to avoid conflicts
const WHISPER_SERVER_HOST = "127.0.0.1";

class WhisperServerManager {
    constructor() {
        this.process = null;
        this.status = "stopped"; // stopped | starting | ready | error
        this.error = null;
        this.modelName = "medium";
        this.startPromise = null;
        this._restartCount = 0;
        this._maxRestarts = 3;
    }

    /**
     * Get the paths for whisper-server executable and model
     */
    _getPaths() {
        const nodejsWhisperDir = path.join(
            PROJECT_ROOT,
            "node_modules",
            "nodejs-whisper",
            "cpp",
            "whisper.cpp",
        );

        const isWindows = process.platform === "win32";
        const execName = isWindows ? "whisper-server.exe" : "whisper-server";

        // Check common build locations
        const possibleExecPaths = [
            path.join(nodejsWhisperDir, "build", "bin", "Release", execName),
            path.join(nodejsWhisperDir, "build", "bin", execName),
            path.join(nodejsWhisperDir, "build", execName),
            path.join(nodejsWhisperDir, execName),
        ];

        let execPath = "";
        for (const p of possibleExecPaths) {
            if (fs.existsSync(p)) {
                execPath = p;
                break;
            }
        }

        const modelPath = path.join(
            nodejsWhisperDir,
            "models",
            `ggml-${this.modelName}.bin`,
        );

        return { execPath, modelPath, whisperDir: nodejsWhisperDir };
    }

    /**
     * Start the whisper-server process
     */
    async start(options = {}) {
        // If already starting, return the existing promise
        if (this.startPromise) {
            return this.startPromise;
        }

        // If already ready, return immediately
        if (this.status === "ready" && this.process && !this.process.killed) {
            return { success: true, status: "already_running" };
        }

        this.startPromise = this._doStart(options);
        try {
            const result = await this.startPromise;
            return result;
        } finally {
            this.startPromise = null;
        }
    }

    async _doStart(options = {}) {
        const { useGpu = false } = options;
        const { execPath, modelPath, whisperDir } = this._getPaths();

        if (!execPath) {
            this.status = "error";
            this.error = "whisper-server executable not found";
            return { success: false, error: this.error };
        }

        if (!fs.existsSync(modelPath)) {
            this.status = "error";
            this.error = `Model file not found: ggml-${this.modelName}.bin`;
            return { success: false, error: this.error };
        }

        // Kill existing process if any
        this.stop();

        this.status = "starting";
        this.error = null;

        return new Promise((resolve) => {
            const args = [
                "--model",
                modelPath,
                "--host",
                WHISPER_SERVER_HOST,
                "--port",
                String(WHISPER_SERVER_PORT),
                "--language",
                "vi",
                "--threads",
                String(Math.max(2, Math.min(8, (os.cpus()?.length || 4) - 2))),
                "--split-on-word",
            ];

            if (!useGpu) {
                args.push("--no-gpu");
            }

            console.log(
                `[WhisperServer] Starting: ${execPath} ${args.join(" ")}`,
            );

            this.process = spawn(execPath, args, {
                cwd: whisperDir,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });

            let startupOutput = "";
            let resolved = false;

            const onReady = () => {
                if (!resolved) {
                    resolved = true;
                    this.status = "ready";
                    this._restartCount = 0;
                    console.log("[WhisperServer] Server is ready and model is loaded");
                    resolve({ success: true, status: "ready" });
                }
            };

            // Watch stderr for the "model loaded" or server ready message
            this.process.stderr.on("data", (data) => {
                const text = data.toString();
                startupOutput += text;
                console.log("[WhisperServer:stderr]", text.trim());

                // whisper-server prints "whisper_init_from_file_with_params_no_state" 
                // and "system_info" when model is loaded, then starts listening
                if (
                    text.includes("listening on") ||
                    text.includes("http://") ||
                    text.includes("model loaded")
                ) {
                    onReady();
                }
            });

            this.process.stdout.on("data", (data) => {
                const text = data.toString();
                console.log("[WhisperServer:stdout]", text.trim());

                if (
                    text.includes("listening on") ||
                    text.includes("http://") ||
                    text.includes("model loaded")
                ) {
                    onReady();
                }
            });

            this.process.on("error", (err) => {
                console.error("[WhisperServer] Process error:", err.message);
                this.status = "error";
                this.error = err.message;
                if (!resolved) {
                    resolved = true;
                    resolve({ success: false, error: err.message });
                }
            });

            this.process.on("close", (code) => {
                console.log(`[WhisperServer] Process exited with code ${code}`);
                const wasReady = this.status === "ready";
                this.status = "stopped";
                this.process = null;

                if (!resolved) {
                    resolved = true;
                    resolve({
                        success: false,
                        error: `Server exited with code ${code}: ${startupOutput.slice(-500)}`,
                    });
                }

                // Auto-restart if it was running fine and crashed
                if (wasReady && this._restartCount < this._maxRestarts) {
                    this._restartCount++;
                    console.log(
                        `[WhisperServer] Unexpected exit, restarting (attempt ${this._restartCount}/${this._maxRestarts})...`,
                    );
                    setTimeout(() => this.start(options), 2000);
                }
            });

            // Timeout — if server doesn't start within 60 seconds, give up
            // but also try polling the health endpoint
            const startTime = Date.now();
            const pollReady = setInterval(async () => {
                if (resolved) {
                    clearInterval(pollReady);
                    return;
                }

                // Timeout after 60 seconds
                if (Date.now() - startTime > 60000) {
                    clearInterval(pollReady);
                    if (!resolved) {
                        resolved = true;
                        this.status = "error";
                        this.error = "Server startup timeout (60s)";
                        resolve({ success: false, error: this.error });
                    }
                    return;
                }

                // Try health check
                try {
                    const ok = await this._healthCheck();
                    if (ok) {
                        clearInterval(pollReady);
                        onReady();
                    }
                } catch {
                    // Not ready yet
                }
            }, 1000);
        });
    }

    /**
     * Check if the server is accepting connections
     */
    _healthCheck() {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: WHISPER_SERVER_HOST,
                    port: WHISPER_SERVER_PORT,
                    path: "/",
                    method: "GET",
                    timeout: 2000,
                },
                (res) => {
                    let body = "";
                    res.on("data", (chunk) => {
                        body += chunk;
                    });
                    res.on("end", () => {
                        resolve(true);
                    });
                },
            );

            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Timeout"));
            });
            req.end();
        });
    }

    /**
     * Stop the whisper-server process
     */
    stop() {
        if (this.process) {
            console.log("[WhisperServer] Stopping server...");
            try {
                this.process.kill("SIGTERM");
            } catch {
                try {
                    this.process.kill("SIGKILL");
                } catch {
                    // Already dead
                }
            }
            this.process = null;
        }
        this.status = "stopped";
        this.error = null;
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            status: this.status,
            error: this.error,
            model: this.modelName,
            port: WHISPER_SERVER_PORT,
            pid: this.process?.pid || null,
        };
    }

    /**
     * Check if server is ready for transcription
     */
    isReady() {
        return this.status === "ready" && this.process && !this.process.killed;
    }

    /**
     * Transcribe an audio file via the whisper-server HTTP API
     * @param {string} audioPath - Path to the WAV file
     * @param {object} options - Transcription options
     * @returns {Promise<string>} - Transcription text
     */
    async transcribe(audioPath, options = {}) {
        if (!this.isReady()) {
            throw new Error(
                `Whisper server not ready (status: ${this.status}). Call start() first.`,
            );
        }

        if (!fs.existsSync(audioPath)) {
            throw new Error(`Audio file not found: ${audioPath}`);
        }

        const { language = "vi" } = options;

        // Read the audio file
        const audioBuffer = fs.readFileSync(audioPath);
        const filename = path.basename(audioPath);

        // Build multipart form data manually
        const boundary =
            "----WhisperBoundary" + Date.now() + Math.random().toString(36).slice(2);

        const parts = [];

        // File part
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: audio/wav\r\n\r\n`,
        );
        parts.push(audioBuffer);
        parts.push("\r\n");

        // Temperature part
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="temperature"\r\n\r\n` +
            `0.0\r\n`,
        );

        // Temperature increment (for retry)
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="temperature_inc"\r\n\r\n` +
            `0.2\r\n`,
        );

        // Response format
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
            `json\r\n`,
        );

        // End boundary
        parts.push(`--${boundary}--\r\n`);

        // Combine all parts into a single buffer
        const bodyParts = parts.map((p) =>
            typeof p === "string" ? Buffer.from(p, "utf-8") : p,
        );
        const bodyBuffer = Buffer.concat(bodyParts);

        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: WHISPER_SERVER_HOST,
                    port: WHISPER_SERVER_PORT,
                    path: "/inference",
                    method: "POST",
                    headers: {
                        "Content-Type": `multipart/form-data; boundary=${boundary}`,
                        "Content-Length": bodyBuffer.length,
                    },
                    timeout: 120000, // 2 minute timeout for long audio
                },
                (res) => {
                    let body = "";
                    res.on("data", (chunk) => {
                        body += chunk;
                    });
                    res.on("end", () => {
                        if (res.statusCode === 200) {
                            try {
                                const result = JSON.parse(body);
                                // whisper-server returns { text: "..." } in json format
                                const text = result.text || result.transcription || "";
                                resolve(text.trim());
                            } catch {
                                // If not JSON, return raw text
                                resolve(body.trim());
                            }
                        } else {
                            reject(
                                new Error(
                                    `Whisper server returned ${res.statusCode}: ${body}`,
                                ),
                            );
                        }
                    });
                },
            );

            req.on("error", (err) => {
                reject(new Error(`Whisper server request failed: ${err.message}`));
            });

            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Whisper transcription timeout (120s)"));
            });

            req.write(bodyBuffer);
            req.end();
        });
    }
}

// Singleton instance
const whisperServer = new WhisperServerManager();

export { whisperServer, WhisperServerManager };
