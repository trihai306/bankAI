const { contextBridge, ipcRenderer } = require("electron");

// Expose protected APIs to renderer
contextBridge.exposeInMainWorld("electronAPI", {
  // App
  getVersion: () => ipcRenderer.invoke("app:version"),

  // Database
  db: {
    getStats: () => ipcRenderer.invoke("db:stats"),
    getRecentCalls: () => ipcRenderer.invoke("db:recent-calls"),
    getAllCalls: () => ipcRenderer.invoke("db:all-calls"),
    getSettings: () => ipcRenderer.invoke("db:settings"),
    saveSetting: (key, value) =>
      ipcRenderer.invoke("db:save-setting", { key, value }),
  },

  // Voice
  voice: {
    startRecording: () => ipcRenderer.invoke("voice:start-recording"),
    stopRecording: () => ipcRenderer.invoke("voice:stop-recording"),
    onTranscription: (callback) =>
      ipcRenderer.on("voice:transcription", callback),
    onResponse: (callback) => ipcRenderer.on("voice:response", callback),
  },

  // Call
  call: {
    initiate: (phoneNumber) => ipcRenderer.invoke("call:initiate", phoneNumber),
    hangup: (callId) => ipcRenderer.invoke("call:hangup", callId),
    onIncoming: (callback) => ipcRenderer.on("call:incoming", callback),
    onStatus: (callback) => ipcRenderer.on("call:status", callback),
    onEnded: (callback) => ipcRenderer.on("call:ended", callback),
  },

  // Model
  model: {
    list: () => ipcRenderer.invoke("model:list"),
    train: (config) => ipcRenderer.invoke("model:train", config),
    onProgress: (callback) => ipcRenderer.on("model:progress", callback),
    onComplete: (callback) => ipcRenderer.on("model:complete", callback),
  },

  // Training
  training: {
    uploadSamples: (files) => ipcRenderer.invoke("training:upload", files),
    startVoiceTraining: (config) =>
      ipcRenderer.invoke("training:voice", config),
    startLLMTraining: (config) => ipcRenderer.invoke("training:llm", config),
  },

  // History
  history: {
    getConversations: (filters) =>
      ipcRenderer.invoke("history:conversations", filters),
    getCallHistory: (filters) => ipcRenderer.invoke("history:calls", filters),
  },

  // Voice Management (CRUD)
  voices: {
    list: () => ipcRenderer.invoke("voice:list"),
    get: (id) => ipcRenderer.invoke("voice:get", id),
    create: (data) => ipcRenderer.invoke("voice:create", data),
    update: (id, data) => ipcRenderer.invoke("voice:update", id, data),
    delete: (id) => ipcRenderer.invoke("voice:delete", id),
    testGenerate: (id, text) =>
      ipcRenderer.invoke("voice:test-generate", id, text),
  },

  // TTS - F5-TTS Vietnamese (Voice Cloning)
  tts: {
    getStatus: () => ipcRenderer.invoke("tts:status"),
    install: () => ipcRenderer.invoke("tts:install"),
    uploadRef: (audioData, filename) =>
      ipcRenderer.invoke("tts:upload-ref", { audioData, filename }),
    listRefs: () => ipcRenderer.invoke("tts:list-refs"),
    listOutputs: () => ipcRenderer.invoke("tts:list-outputs"),
    deleteRef: (filepath) => ipcRenderer.invoke("tts:delete-ref", filepath),
    readAudio: (filepath) => ipcRenderer.invoke("tts:read-audio", filepath),
    transcribeAudio: (audioPath) =>
      ipcRenderer.invoke("tts:transcribe-audio", audioPath),
    convertToWav: (webmPath) =>
      ipcRenderer.invoke("tts:convert-to-wav", webmPath),
    generate: (config) => ipcRenderer.invoke("tts:generate", config),
    pickVoiceFile: () => ipcRenderer.invoke("tts:pick-voice-file"),
  },

  // Voice Chat (Realtime Voice Conversation)
  voiceChat: {
    start: (config) => ipcRenderer.invoke("voice-chat:start", config),
    stop: () => ipcRenderer.invoke("voice-chat:stop"),
    process: (audioData, filename) =>
      ipcRenderer.invoke("voice-chat:process", audioData, filename),
    processStream: (audioData, filename) =>
      ipcRenderer.invoke("voice-chat:process-stream", audioData, filename),
    pickAndProcess: () => ipcRenderer.invoke("voice-chat:pick-audio"),
    status: () => ipcRenderer.invoke("voice-chat:status"),
    listRefAudios: () => ipcRenderer.invoke("tts:list-refs"),
    processRefFile: (filename) =>
      ipcRenderer.invoke("voice-chat:process-ref-file", filename),
    // Stream event listeners
    onStreamEvent: (callbacks) => {
      if (callbacks.onSttDone) {
        ipcRenderer.on("voice-stream:stt-done", (_, data) => callbacks.onSttDone(data));
      }
      if (callbacks.onLlmChunk) {
        ipcRenderer.on("voice-stream:llm-chunk", (_, data) => callbacks.onLlmChunk(data));
      }
      if (callbacks.onTtsAudio) {
        ipcRenderer.on("voice-stream:tts-audio", (_, data) => callbacks.onTtsAudio(data));
      }
      if (callbacks.onTtsChunkFailed) {
        ipcRenderer.on("voice-stream:tts-chunk-failed", (_, data) => callbacks.onTtsChunkFailed(data));
      }
      if (callbacks.onDone) {
        ipcRenderer.on("voice-stream:done", (_, data) => callbacks.onDone(data));
      }
    },
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners("voice-stream:stt-done");
      ipcRenderer.removeAllListeners("voice-stream:llm-chunk");
      ipcRenderer.removeAllListeners("voice-stream:tts-audio");
      ipcRenderer.removeAllListeners("voice-stream:tts-chunk-failed");
      ipcRenderer.removeAllListeners("voice-stream:done");
    },
  },

  // Qwen3 - Local AI (node-llama-cpp)
  qwen: {
    processText: (text, task) =>
      ipcRenderer.invoke("qwen:process-text", text, task),
    getStatus: () => ipcRenderer.invoke("qwen:status"),
  },

  // Python Environment Management
  python: {
    checkEnv: () => ipcRenderer.invoke("python:check-env"),
    getPlatform: () => ipcRenderer.invoke("python:get-platform"),
  },

  // Hardware Acceleration (GPU-only mode)
  hardware: {
    getInfo: () => ipcRenderer.invoke("hardware:get-info"),
    getGpuMode: () => ipcRenderer.invoke("hardware:get-gpu-mode"),
    setGpuMode: () => ipcRenderer.invoke("hardware:set-gpu-mode"),
    rebuildLlama: () => ipcRenderer.invoke("hardware:rebuild-llama"),
    resetLlm: () => ipcRenderer.invoke("hardware:reset-llm"),
    setWhisperGpuMode: () =>
      ipcRenderer.invoke("hardware:set-whisper-gpu-mode"),
    setTtsGpuMode: () =>
      ipcRenderer.invoke("hardware:set-tts-gpu-mode"),
    rebuildWhisper: () =>
      ipcRenderer.invoke("hardware:rebuild-whisper"),
  },

  // Preload
  preload: {
    getStatus: () => ipcRenderer.invoke("preload:get-status"),
    getAutoPreload: () => ipcRenderer.invoke("preload:get-auto-preload"),
    setAutoPreload: (enabled) =>
      ipcRenderer.invoke("preload:set-auto-preload", enabled),
    trigger: () => ipcRenderer.invoke("preload:trigger"),
    onStatusUpdate: (callback) =>
      ipcRenderer.on("preload:status-update", (_, data) => callback(data)),
    removeStatusUpdate: () =>
      ipcRenderer.removeAllListeners("preload:status-update"),
  },
});
