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

    // Training
    training: {
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
        generate: (config) => ipcRenderer.invoke('tts:generate', config),
    },

    // Qwen3 - Local AI
    qwen: {
        processText: (text, task) => ipcRenderer.invoke('qwen:process-text', text, task)
    },
});
