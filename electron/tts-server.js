/**
 * F5-TTS Server Manager
 *
 * Manages a persistent Python F5-TTS server process.
 * Keeps the model loaded in GPU memory so subsequent TTS calls are fast
 * (no re-loading the ~1.5GB model on every call).
 *
 * API: HTTP POST /generate with JSON body.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import http from "http";
import { getPythonDir } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TTS_SERVER_PORT = 8179;
const TTS_SERVER_HOST = "127.0.0.1";

class TTSServerManager {
    constructor() {
        this.process = null;
        this.status = "stopped"; // stopped | starting | ready | error
        this.error = null;
        this.startPromise = null;
        this._restartCount = 0;
        this._maxRestarts = 3;
    }

    /**
     * Get Python paths for TTS server
     */
    _getPaths() {
        const pythonDir = getPythonDir();
        const isWindows = process.platform === "win32";
        const venvDir = path.join(pythonDir, "venv");

        return {
            python: isWindows
                ? path.join(venvDir, "python.exe")
                : path.join(venvDir, "bin", "python"),
            serverScript: path.join(pythonDir, "f5_tts_server.py"),
            pythonDir,
        };
    }

    /**
     * Start the TTS server process
     */
    async start() {
        if (this.startPromise) {
            return this.startPromise;
        }

        if (this.status === "ready" && this.process && !this.process.killed) {
            return { success: true, status: "already_running" };
        }

        this.startPromise = this._doStart();
        try {
            const result = await this.startPromise;
            return result;
        } finally {
            this.startPromise = null;
        }
    }

    async _doStart() {
        const { python, serverScript, pythonDir } = this._getPaths();

        if (!fs.existsSync(python)) {
            this.status = "error";
            this.error = "Python venv not found: " + python;
            return { success: false, error: this.error };
        }

        if (!fs.existsSync(serverScript)) {
            this.status = "error";
            this.error = "TTS server script not found: " + serverScript;
            return { success: false, error: this.error };
        }

        // Kill existing process
        this.stop();

        this.status = "starting";
        this.error = null;

        return new Promise((resolve) => {
            const env = { ...process.env };
            env.PYTHONUTF8 = "1";
            env.PYTHONIOENCODING = "utf-8";

            console.log(`[TTSServer] Starting: ${python} ${serverScript}`);

            this.process = spawn(python, [serverScript], {
                cwd: pythonDir,
                env,
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
                    console.log("[TTSServer] Server is ready — model loaded in GPU memory");
                    resolve({ success: true, status: "ready" });
                }
            };

            this.process.stdout.on("data", (data) => {
                const text = data.toString();
                startupOutput += text;
                console.log("[TTSServer:stdout]", text.trim());

                if (text.includes("Ready! Listening on")) {
                    onReady();
                }
            });

            this.process.stderr.on("data", (data) => {
                const text = data.toString();
                // Only log important stderr (skip progress bars, warnings)
                if (!text.includes("━") && !text.includes("UserWarning")) {
                    console.log("[TTSServer:stderr]", text.trim());
                }
            });

            this.process.on("error", (err) => {
                console.error("[TTSServer] Process error:", err.message);
                this.status = "error";
                this.error = err.message;
                if (!resolved) {
                    resolved = true;
                    resolve({ success: false, error: err.message });
                }
            });

            this.process.on("close", (code) => {
                console.log(`[TTSServer] Process exited with code ${code}`);
                const wasReady = this.status === "ready";
                this.status = "stopped";
                this.process = null;

                if (!resolved) {
                    resolved = true;
                    resolve({
                        success: false,
                        error: `TTS server exited with code ${code}: ${startupOutput.slice(-500)}`,
                    });
                }

                if (wasReady && this._restartCount < this._maxRestarts) {
                    this._restartCount++;
                    console.log(
                        `[TTSServer] Unexpected exit, restarting (attempt ${this._restartCount}/${this._maxRestarts})...`,
                    );
                    setTimeout(() => this.start(), 2000);
                }
            });

            // Poll for readiness
            const startTime = Date.now();
            const pollReady = setInterval(async () => {
                if (resolved) {
                    clearInterval(pollReady);
                    return;
                }

                // Timeout after 120 seconds (model loading can be slow first time)
                if (Date.now() - startTime > 120000) {
                    clearInterval(pollReady);
                    if (!resolved) {
                        resolved = true;
                        this.status = "error";
                        this.error = "TTS server startup timeout (120s)";
                        resolve({ success: false, error: this.error });
                    }
                    return;
                }

                try {
                    const ok = await this._healthCheck();
                    if (ok) {
                        clearInterval(pollReady);
                        onReady();
                    }
                } catch {
                    // Not ready yet
                }
            }, 2000);
        });
    }

    /**
     * Health check
     */
    _healthCheck() {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: TTS_SERVER_HOST,
                    port: TTS_SERVER_PORT,
                    path: "/health",
                    method: "GET",
                    timeout: 3000,
                },
                (res) => {
                    let body = "";
                    res.on("data", (chunk) => {
                        body += chunk;
                    });
                    res.on("end", () => {
                        try {
                            const data = JSON.parse(body);
                            resolve(data.status === "ready");
                        } catch {
                            resolve(false);
                        }
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
     * Stop the TTS server
     */
    stop() {
        if (this.process) {
            console.log("[TTSServer] Stopping server...");
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
            port: TTS_SERVER_PORT,
            pid: this.process?.pid || null,
        };
    }

    /**
     * Check if server is ready
     */
    isReady() {
        return this.status === "ready" && this.process && !this.process.killed;
    }

    /**
     * Ensure server is ready before making requests
     */
    async _ensureReady() {
        if (!this.isReady()) {
            console.log("[TTSServer] Not ready, starting server...");
            const startResult = await this.start();
            if (!startResult.success) {
                throw new Error(`TTS server failed to start: ${startResult.error}`);
            }
        }
    }

    /**
     * Generate audio via the TTS server HTTP API (legacy JSON response with file path)
     */
    async generate({ refAudio, refText, genText, speed = 1.0 }) {
        await this._ensureReady();

        const body = JSON.stringify({
            ref_audio: refAudio,
            ref_text: refText,
            gen_text: genText,
            speed,
        });

        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: TTS_SERVER_HOST,
                    port: TTS_SERVER_PORT,
                    path: "/generate",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Content-Length": Buffer.byteLength(body, "utf-8"),
                    },
                    timeout: 120000,
                },
                (res) => {
                    let responseBody = "";
                    res.on("data", (chunk) => {
                        responseBody += chunk;
                    });
                    res.on("end", () => {
                        try {
                            const result = JSON.parse(responseBody);
                            resolve(result);
                        } catch {
                            reject(new Error(`Invalid TTS response: ${responseBody}`));
                        }
                    });
                },
            );

            req.on("error", (err) => {
                reject(new Error(`TTS server request failed: ${err.message}`));
            });

            req.on("timeout", () => {
                req.destroy();
                reject(new Error("TTS generation timeout (120s)"));
            });

            req.write(body);
            req.end();
        });
    }

    /**
     * Generate audio and receive raw WAV binary buffer (no file I/O)
     * Returns: { success, audioBuffer: Buffer, timings: { preprocess, generate, total } }
     */
    async generateWav({ refAudio, refText, genText, speed = 1.0 }) {
        await this._ensureReady();

        const body = JSON.stringify({
            ref_audio: refAudio,
            ref_text: refText,
            gen_text: genText,
            speed,
            response_format: "wav",
        });

        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: TTS_SERVER_HOST,
                    port: TTS_SERVER_PORT,
                    path: "/generate",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Content-Length": Buffer.byteLength(body, "utf-8"),
                    },
                    timeout: 120000,
                },
                (res) => {
                    const contentType = res.headers["content-type"] || "";

                    if (contentType.includes("audio/wav")) {
                        // Binary WAV response
                        const chunks = [];
                        res.on("data", (chunk) => chunks.push(chunk));
                        res.on("end", () => {
                            const audioBuffer = Buffer.concat(chunks);
                            let timings = {};
                            try {
                                timings = JSON.parse(res.headers["x-tts-timings"] || "{}");
                            } catch { /* ignore */ }
                            resolve({
                                success: true,
                                audioBuffer,
                                timings,
                            });
                        });
                    } else {
                        // JSON error response
                        let responseBody = "";
                        res.on("data", (chunk) => { responseBody += chunk; });
                        res.on("end", () => {
                            try {
                                const result = JSON.parse(responseBody);
                                resolve({ success: false, error: result.error || "Unknown error" });
                            } catch {
                                reject(new Error(`Invalid TTS response: ${responseBody}`));
                            }
                        });
                    }
                },
            );

            req.on("error", (err) => {
                reject(new Error(`TTS server request failed: ${err.message}`));
            });

            req.on("timeout", () => {
                req.destroy();
                reject(new Error("TTS generation timeout (120s)"));
            });

            req.write(body);
            req.end();
        });
    }
}

// Singleton instance
const ttsServer = new TTSServerManager();

export { ttsServer, TTSServerManager };
