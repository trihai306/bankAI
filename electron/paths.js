/**
 * Centralized path resolver for dev vs packaged Electron app.
 *
 * Dev mode:      paths relative to project root (../  from electron/)
 * Packaged mode: paths relative to process.resourcesPath (resources/)
 */

import path from "path";
import { fileURLToPath } from "url";
import { app } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPackaged() {
    return app.isPackaged;
}

/** Project root — only meaningful in dev mode */
function getProjectRoot() {
    if (isPackaged()) {
        return path.join(process.resourcesPath);
    }
    return path.join(__dirname, "..");
}

/** models/ directory containing GGUF files */
function getModelsDir() {
    if (isPackaged()) {
        return path.join(process.resourcesPath, "models");
    }
    return path.join(__dirname, "..", "models");
}

/** python/ directory containing venv + scripts + F5-TTS model */
function getPythonDir() {
    if (isPackaged()) {
        return path.join(process.resourcesPath, "python");
    }
    return path.join(__dirname, "..", "python");
}

/** whisper/ directory containing whisper-server binary + ggml model */
function getWhisperDir() {
    if (isPackaged()) {
        return path.join(process.resourcesPath, "whisper");
    }
    // Dev mode: inside node_modules
    return path.join(
        __dirname,
        "..",
        "node_modules",
        "nodejs-whisper",
        "cpp",
        "whisper.cpp",
    );
}

/** Path to llama-worker.mjs */
function getLlamaWorkerPath() {
    return path.join(__dirname, "llama-worker.mjs");
}

export {
    isPackaged,
    getProjectRoot,
    getModelsDir,
    getPythonDir,
    getWhisperDir,
    getLlamaWorkerPath,
};
