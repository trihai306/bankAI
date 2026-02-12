/**
 * llama-worker.mjs — Runs node-llama-cpp in a separate Node.js process.
 *
 * Electron v40 (Node v24) triggers SIGILL when llama.cpp native binaries
 * are loaded inside the Electron main process. Running in a plain Node.js
 * child process avoids this incompatibility entirely.
 *
 * IPC Protocol:
 *   Parent → Worker:
 *     { type: "init", gpuMode: "cpu"|"cuda"|"auto", modelsDir, modelUri }
 *     { type: "prompt", id, text, temperature?, topP? }
 *     { type: "dispose" }
 *     { type: "exit" }
 *
 *   Worker → Parent:
 *     { type: "status", status: "not_loaded"|"loading"|"ready"|"error", error? }
 *     { type: "response", id, text }
 *     { type: "error", id?, error }
 *     { type: "disposed" }
 */

import path from "path";

// Dynamically locate node-llama-cpp relative to the project root
const projectRoot =
  process.env.PROJECT_ROOT ||
  path.join(path.dirname(new URL(import.meta.url).pathname), "..");

let getLlama, resolveModelFile, LlamaChatSession;

try {
  const nlc = await import("node-llama-cpp");
  getLlama = nlc.getLlama;
  resolveModelFile = nlc.resolveModelFile;
  LlamaChatSession = nlc.LlamaChatSession;
} catch {
  // Fallback: import from project path
  const nlc = await import(
    path.join(projectRoot, "node_modules/node-llama-cpp/dist/index.js")
  );
  getLlama = nlc.getLlama;
  resolveModelFile = nlc.resolveModelFile;
  LlamaChatSession = nlc.LlamaChatSession;
}

let llamaInstance = null;
let llamaModel = null;
let llamaContext = null;
let llamaSession = null;

function send(msg) {
  if (process.send) {
    process.send(msg);
  }
}

async function init({ gpuMode = "auto", modelsDir, modelUri }) {
  try {
    send({ type: "status", status: "loading" });
    console.log(`[llama-worker] Initializing (gpuMode=${gpuMode})...`);

    // Load llama.cpp backend based on GPU preference
    if (gpuMode === "cuda") {
      llamaInstance = await getLlama({ gpu: "cuda" });
      console.log("[llama-worker] Backend: CUDA");
    } else if (gpuMode === "auto") {
      try {
        llamaInstance = await getLlama("lastBuild");
        console.log("[llama-worker] Backend: lastBuild");
      } catch {
        llamaInstance = await getLlama();
        console.log("[llama-worker] Backend: auto");
      }
    } else {
      // CPU mode
      try {
        llamaInstance = await getLlama("lastBuild");
        console.log("[llama-worker] Backend: lastBuild (CPU)");
      } catch {
        llamaInstance = await getLlama({ gpu: false });
        console.log("[llama-worker] Backend: CPU fallback");
      }
    }

    // Resolve model file (download if needed)
    console.log("[llama-worker] Resolving model:", modelUri);
    const modelPath = await resolveModelFile(modelUri, modelsDir);
    console.log("[llama-worker] Model path:", modelPath);

    // Load model
    llamaModel = await llamaInstance.loadModel({ modelPath });
    console.log("[llama-worker] Model loaded");

    // Create context and session
    llamaContext = await llamaModel.createContext();
    llamaSession = new LlamaChatSession({
      contextSequence: llamaContext.getSequence(),
    });
    console.log("[llama-worker] Session ready");

    send({ type: "status", status: "ready" });
  } catch (error) {
    console.error("[llama-worker] Init failed:", error.message);
    send({ type: "status", status: "error", error: error.message });
  }
}

async function handlePrompt({ id, text, temperature = 0.3, topP = 0.9 }) {
  try {
    if (!llamaSession) {
      send({ type: "error", id, error: "Model not loaded" });
      return;
    }
    const response = await llamaSession.prompt(text, { temperature, topP });
    send({ type: "response", id, text: response.trim() });
  } catch (error) {
    console.error("[llama-worker] Prompt error:", error.message);
    send({ type: "error", id, error: error.message });
  }
}

async function dispose() {
  try {
    llamaSession = null;
    if (llamaContext) {
      await llamaContext.dispose();
      llamaContext = null;
    }
    if (llamaModel) {
      llamaModel.dispose();
      llamaModel = null;
    }
    llamaInstance = null;
    console.log("[llama-worker] Disposed");
    send({ type: "disposed" });
  } catch (e) {
    console.error("[llama-worker] Dispose error:", e.message);
    send({ type: "disposed" });
  }
}

// IPC message handler
process.on("message", async (msg) => {
  switch (msg.type) {
    case "init":
      await init(msg);
      break;
    case "prompt":
      await handlePrompt(msg);
      break;
    case "dispose":
      await dispose();
      break;
    case "exit":
      await dispose();
      process.exit(0);
      break;
    default:
      console.warn("[llama-worker] Unknown message type:", msg.type);
  }
});

// Signal parent that worker is alive
send({ type: "status", status: "not_loaded" });
