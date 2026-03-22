const { contextBridge, ipcRenderer } = require('electron');

// Expose protected APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // App
    getVersion: () => ipcRenderer.invoke('app:version'),

    // Database
    db: {
        getStats: () => ipcRenderer.invoke('db:stats'),
        getRecentCalls: () => ipcRenderer.invoke('db:recent-calls'),
        getAllCalls: () => ipcRenderer.invoke('db:all-calls'),
        getSettings: () => ipcRenderer.invoke('db:settings'),
        saveSetting: (key, value) => ipcRenderer.invoke('db:save-setting', { key, value }),
        addCall: (callData) => ipcRenderer.invoke('db:add-call', callData),
    },

    // Voice
    voice: {
        startRecording: () => ipcRenderer.invoke('voice:start-recording'),
        stopRecording: () => ipcRenderer.invoke('voice:stop-recording'),
        onTranscription: (callback) => ipcRenderer.on('voice:transcription', callback),
        onResponse: (callback) => ipcRenderer.on('voice:response', callback),
    },

    // Call
    call: {
        initiate: (phoneNumber) => ipcRenderer.invoke('call:initiate', phoneNumber),
        hangup: (callId) => ipcRenderer.invoke('call:hangup', callId),
        onIncoming: (callback) => ipcRenderer.on('call:incoming', callback),
        onStatus: (callback) => ipcRenderer.on('call:status', callback),
        onEnded: (callback) => ipcRenderer.on('call:ended', callback),
    },

    // Model
    model: {
        list: () => ipcRenderer.invoke('model:list'),
        train: (config) => ipcRenderer.invoke('model:train', config),
        onProgress: (callback) => ipcRenderer.on('model:progress', callback),
        onComplete: (callback) => ipcRenderer.on('model:complete', callback),
    },

    // Training Data Management
    training: {
        listFiles: () => ipcRenderer.invoke('training:list-files'),
        readFile: (filename) => ipcRenderer.invoke('training:read-file', filename),
        uploadFile: (data, filename) => ipcRenderer.invoke('training:upload-file', data, filename),
        deleteFile: (filename) => ipcRenderer.invoke('training:delete-file', filename),
        addSample: (sample) => ipcRenderer.invoke('training:add-sample', sample),
        buildModel: () => ipcRenderer.invoke('training:build-model'),
        testModel: (text) => ipcRenderer.invoke('training:test-model', text),
        // Legacy
        uploadSamples: (files) => ipcRenderer.invoke('training:upload', files),
        startVoiceTraining: (config) => ipcRenderer.invoke('training:voice', config),
        startLLMTraining: (config) => ipcRenderer.invoke('training:llm', config),
    },

    // History
    history: {
        getConversations: (filters) => ipcRenderer.invoke('history:conversations', filters),
        getCallHistory: (filters) => ipcRenderer.invoke('history:calls', filters),
    },

    // TTS - F5-TTS Vietnamese (Voice Cloning)
    tts: {
        getStatus: () => ipcRenderer.invoke('tts:status'),
        install: () => ipcRenderer.invoke('tts:install'),
        uploadRef: (audioData, filename) => ipcRenderer.invoke('tts:upload-ref', { audioData, filename }),
        listRefs: () => ipcRenderer.invoke('tts:list-refs'),
        listOutputs: () => ipcRenderer.invoke('tts:list-outputs'),
        deleteRef: (filepath) => ipcRenderer.invoke('tts:delete-ref', filepath),
        readAudio: (filepath) => ipcRenderer.invoke('tts:read-audio', filepath),
        transcribeAudio: (audioPath) => ipcRenderer.invoke('tts:transcribe-audio', audioPath),
        convertToWav: (webmPath) => ipcRenderer.invoke('tts:convert-to-wav', webmPath),
        saveTranscript: (filename, transcript) => ipcRenderer.invoke('tts:save-transcript', { filename, transcript }),
        getTranscripts: () => ipcRenderer.invoke('tts:get-transcripts'),
        generate: (config) => ipcRenderer.invoke('tts:generate', config),
        generateStream: (config) => ipcRenderer.invoke('tts:generate-stream', config),
        getTrainingScript: () => ipcRenderer.invoke('tts:get-training-script'),
        autoProcess: (audioPath) => ipcRenderer.invoke('tts:auto-process', audioPath),
        buildDataset: () => ipcRenderer.invoke('tts:build-dataset'),
        finetune: (config) => ipcRenderer.invoke('tts:finetune', config),
    },

    // Qwen3 - Local AI
    qwen: {
        processText: (text, task) => ipcRenderer.invoke('qwen:process-text', text, task),
        streamChat: (prompt, context) => ipcRenderer.invoke('qwen:stream-chat', { prompt, context }),
    },

    // Voice Profiles
    profile: {
        list: () => ipcRenderer.invoke('profile:list'),
        get: (id) => ipcRenderer.invoke('profile:get', id),
        create: (data) => ipcRenderer.invoke('profile:create', data),
        update: (id, data) => ipcRenderer.invoke('profile:update', id, data),
        delete: (id) => ipcRenderer.invoke('profile:delete', id),
        setActive: (id) => ipcRenderer.invoke('profile:set-active', id),
        getActive: () => ipcRenderer.invoke('profile:get-active'),
        analyzeAudio: (path) => ipcRenderer.invoke('profile:analyze-audio', path),
    },

    // Edge-TTS - Fast TTS for calls (<1s)
    edgeTTS: {
        generate: (text, voice, rate) => ipcRenderer.invoke('edge-tts:generate', { text, voice, rate }),
        getVoices: () => ipcRenderer.invoke('edge-tts:voices'),
    },

    // System Setup / Dependency Check
    setup: {
        checkAll: () => ipcRenderer.invoke('setup:check-all'),
        installFfmpeg: () => ipcRenderer.invoke('setup:install-ffmpeg'),
        installPythonEnv: () => ipcRenderer.invoke('setup:install-python-env'),
        installNpmDeps: () => ipcRenderer.invoke('setup:install-npm-deps'),
        onProgress: (callback) => ipcRenderer.on('setup:progress', (_, data) => callback(data)),
        removeProgressListener: () => ipcRenderer.removeAllListeners('setup:progress'),
    },
});
