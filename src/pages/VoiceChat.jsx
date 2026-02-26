import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, MicOff, Square, Volume2, Bot, User, AlertCircle, Check, Loader2, AudioLines, FileAudio, FolderOpen, ChevronDown, ChevronUp, Play, SendHorizontal, MessageSquareText } from 'lucide-react'

const SILENCE_THRESHOLD = 0.015
const SILENCE_DURATION_MS = 2000
const SAMPLE_RATE = 16000

export default function VoiceChat() {
    const [isListening, setIsListening] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [pipelineStep, setPipelineStep] = useState(null) // stt | llm | tts | done
    const [messages, setMessages] = useState([])
    const [voices, setVoices] = useState([])
    const [selectedVoiceId, setSelectedVoiceId] = useState('')
    const [volumeLevel, setVolumeLevel] = useState(0)
    const [isSilent, setIsSilent] = useState(false)
    const [error, setError] = useState(null)
    const [refAudios, setRefAudios] = useState([])
    const [showRefPanel, setShowRefPanel] = useState(false)
    const [previewingFile, setPreviewingFile] = useState(null)
    const [textInput, setTextInput] = useState('')
    const [showTextInput, setShowTextInput] = useState(false)
    const textInputRef = useRef(null)
    const previewAudioRef = useRef(null)

    const mediaRecorderRef = useRef(null)
    const audioContextRef = useRef(null)
    const analyserRef = useRef(null)
    const streamRef = useRef(null)
    const chunksRef = useRef([])
    const silenceStartRef = useRef(null)
    const animFrameRef = useRef(null)
    const isProcessingRef = useRef(false)
    const audioPlayerRef = useRef(null)
    const isProcessingRefAudio = useRef(false)

    // Load voices on mount
    useEffect(() => {
        loadVoices()
        loadRefAudios()
        return () => {
            stopListening()
            window.electronAPI.voiceChat.removeStreamListeners()
        }
    }, [])

    const loadRefAudios = async () => {
        try {
            const list = await window.electronAPI.voiceChat.listRefAudios()
            setRefAudios(list || [])
        } catch (err) {
            console.error('Failed to load ref audios:', err)
        }
    }

    // Shared streaming handler setup for all voice processing paths
    const createStreamHandler = () => {
        const audioQueue = []   // sparse array: audioQueue[chunkIndex] = { audioData, mimeType } | 'skipped'
        let nextPlayIndex = 0
        let streamDone = false
        let totalChunks = 0     // total expected chunks (set when done)
        let playbackResolve = null
        let isPlaying = false

        const tryPlayNext = () => {
            if (isPlaying) return  // already playing something

            // Skip over failed/skipped chunks
            while (nextPlayIndex < audioQueue.length && audioQueue[nextPlayIndex] === 'skipped') {
                nextPlayIndex++
            }

            if (nextPlayIndex < audioQueue.length && audioQueue[nextPlayIndex] && audioQueue[nextPlayIndex] !== 'skipped') {
                const { audioData, mimeType } = audioQueue[nextPlayIndex]
                nextPlayIndex++
                isPlaying = true

                const uint8 = new Uint8Array(audioData)
                const blob = new Blob([uint8], { type: mimeType })
                const url = URL.createObjectURL(blob)

                if (audioPlayerRef.current) {
                    audioPlayerRef.current.pause()
                }

                const audio = new Audio(url)
                audioPlayerRef.current = audio

                const onFinish = () => {
                    URL.revokeObjectURL(url)
                    isPlaying = false
                    tryPlayNext()
                }

                audio.onended = onFinish
                audio.onerror = onFinish
                audio.play().catch(onFinish)
            } else if (streamDone && nextPlayIndex >= totalChunks) {
                // All chunks played or skipped
                if (playbackResolve) {
                    playbackResolve()
                    playbackResolve = null
                }
            }
            // else: waiting for next chunk to arrive
        }

        const registerListeners = () => {
            window.electronAPI.voiceChat.onStreamEvent({
                onSttDone: (data) => {
                    setMessages(prev => [
                        ...prev,
                        { role: 'user', content: data.transcript, timestamp: Date.now() },
                    ])
                    setPipelineStep('llm')
                },
                onLlmChunk: (data) => {
                    setPipelineStep('tts')
                    setMessages(prev => {
                        const last = prev[prev.length - 1]
                        if (last?.role === 'assistant' && last?._streaming) {
                            return [
                                ...prev.slice(0, -1),
                                { ...last, content: data.fullText },
                            ]
                        }
                        return [
                            ...prev,
                            { role: 'assistant', content: data.text, timestamp: Date.now(), _streaming: true },
                        ]
                    })
                },
                onTtsAudio: (data) => {
                    setPipelineStep('playing')
                    audioQueue[data.chunkIndex] = {
                        audioData: data.audioData,
                        mimeType: data.mimeType || 'audio/wav',
                    }
                    tryPlayNext()
                },
                onTtsChunkFailed: (data) => {
                    // Mark as skipped so playback doesn't wait forever
                    audioQueue[data.chunkIndex] = 'skipped'
                    tryPlayNext()
                },
                onDone: (data) => {
                    streamDone = true
                    totalChunks = data.chunkCount || audioQueue.length
                    setMessages(prev => {
                        const last = prev[prev.length - 1]
                        if (last?.role === 'assistant' && last?._streaming) {
                            const { _streaming, ...clean } = last
                            return [
                                ...prev.slice(0, -1),
                                { ...clean, content: data.responseText },
                            ]
                        }
                        return prev
                    })
                    tryPlayNext()
                },
            })
        }

        const waitForPlayback = () => {
            return new Promise(resolve => {
                playbackResolve = resolve
                // Check if already done (no audio chunks at all, or all played)
                if (streamDone && (totalChunks === 0 || nextPlayIndex >= totalChunks)) {
                    resolve()
                }
            })
        }

        return { registerListeners, waitForPlayback }
    }

    const processRefAudio = async (filename) => {
        if (isProcessingRef.current) return
        setError(null)
        isProcessingRef.current = true
        setIsProcessing(true)

        const { registerListeners, waitForPlayback } = createStreamHandler()

        try {
            if (!isListening) {
                await window.electronAPI.voiceChat.start({
                    voiceId: selectedVoiceId || undefined,
                })
            }

            setPipelineStep('stt')
            registerListeners()

            const result = await window.electronAPI.voiceChat.processRefFile(filename)

            await waitForPlayback()

            if (!result.success && result.error !== 'No speech detected') {
                setError(result.error)
            }

            setPipelineStep('done')
        } catch (err) {
            console.error('Ref audio processing error:', err)
            setError(`Processing failed: ${err.message}`)
        } finally {
            window.electronAPI.voiceChat.removeStreamListeners()
            isProcessingRef.current = false
            setIsProcessing(false)
            setPipelineStep(null)

            if (!isListening) {
                try { await window.electronAPI.voiceChat.stop() } catch { }
            }
        }
    }

    const previewRefAudio = async (filepath, filename) => {
        // Stop any current preview
        if (previewAudioRef.current) {
            previewAudioRef.current.pause()
            previewAudioRef.current = null
        }

        if (previewingFile === filename) {
            setPreviewingFile(null)
            return
        }

        try {
            const audioData = await window.electronAPI.tts.readAudio(filepath)
            if (!audioData) return

            const uint8 = new Uint8Array(audioData)
            const blob = new Blob([uint8], { type: 'audio/wav' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            previewAudioRef.current = audio
            setPreviewingFile(filename)

            audio.onended = () => {
                URL.revokeObjectURL(url)
                setPreviewingFile(null)
                previewAudioRef.current = null
            }
            audio.play().catch(() => setPreviewingFile(null))
        } catch (err) {
            console.error('Preview error:', err)
            setPreviewingFile(null)
        }
    }

    const loadVoices = async () => {
        try {
            const list = await window.electronAPI.voices.list()
            setVoices(list || [])
            if (list?.length > 0 && !selectedVoiceId) {
                setSelectedVoiceId(list[0].id)
            }
        } catch (err) {
            console.error('Failed to load voices:', err)
        }
    }

    const startListening = async () => {
        setError(null)
        try {
            // Start voice engine session
            await window.electronAPI.voiceChat.start({
                voiceId: selectedVoiceId || undefined,
            })

            // Get mic stream
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            })
            streamRef.current = stream

            // Setup Web Audio API for volume analysis
            const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
            audioContextRef.current = audioContext
            const source = audioContext.createMediaStreamSource(stream)
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 2048
            analyser.smoothingTimeConstant = 0.3
            source.connect(analyser)
            analyserRef.current = analyser

            // Setup MediaRecorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
            })
            mediaRecorderRef.current = mediaRecorder
            chunksRef.current = []

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data)
                }
            }

            // Start recording with timeslice for chunked data
            mediaRecorder.start(250)
            setIsListening(true)
            silenceStartRef.current = null

            // Start volume monitoring
            monitorVolume()
        } catch (err) {
            setError(`Mic error: ${err.message}`)
            console.error('Start listening error:', err)
        }
    }

    const stopListening = async () => {
        // Cancel animation frame
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current)
            animFrameRef.current = null
        }

        // Stop MediaRecorder
        if (mediaRecorderRef.current?.state !== 'inactive') {
            try { mediaRecorderRef.current?.stop() } catch { }
        }
        mediaRecorderRef.current = null

        // Stop audio context
        if (audioContextRef.current?.state !== 'closed') {
            try { await audioContextRef.current?.close() } catch { }
        }
        audioContextRef.current = null
        analyserRef.current = null

        // Stop media stream tracks
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null

        // Reset state
        chunksRef.current = []
        silenceStartRef.current = null
        setIsListening(false)
        setVolumeLevel(0)
        setIsSilent(false)

        // Stop voice engine session
        try {
            await window.electronAPI.voiceChat.stop()
        } catch { }
    }

    const monitorVolume = useCallback(() => {
        const analyser = analyserRef.current
        if (!analyser) return

        const dataArray = new Float32Array(analyser.fftSize)

        const tick = () => {
            if (!analyserRef.current) return

            analyser.getFloatTimeDomainData(dataArray)

            // Calculate RMS volume
            let sum = 0
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i]
            }
            const rms = Math.sqrt(sum / dataArray.length)
            setVolumeLevel(Math.min(rms * 10, 1))

            const now = Date.now()
            const currentlySilent = rms < SILENCE_THRESHOLD

            if (currentlySilent) {
                if (!silenceStartRef.current) {
                    silenceStartRef.current = now
                }
                setIsSilent(true)

                const silenceDuration = now - silenceStartRef.current
                if (
                    silenceDuration >= SILENCE_DURATION_MS &&
                    chunksRef.current.length > 0 &&
                    !isProcessingRef.current
                ) {
                    // 2s silence detected → extract and process audio
                    extractAndProcess()
                }
            } else {
                silenceStartRef.current = null
                setIsSilent(false)
            }

            animFrameRef.current = requestAnimationFrame(tick)
        }

        tick()
    }, [])

    const extractAndProcess = async () => {
        if (isProcessingRef.current || chunksRef.current.length === 0) return
        isProcessingRef.current = true
        setIsProcessing(true)

        // Grab current chunks and reset buffer (recording continues)
        const audioChunks = [...chunksRef.current]
        chunksRef.current = []
        silenceStartRef.current = null

        const { registerListeners, waitForPlayback } = createStreamHandler()

        try {
            // Convert WebM chunks to a single blob
            const blob = new Blob(audioChunks, { type: 'audio/webm' })
            const arrayBuffer = await blob.arrayBuffer()

            // Decode to PCM WAV for Whisper
            const audioCtx = new OfflineAudioContext(1, SAMPLE_RATE * 30, SAMPLE_RATE)
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
            const wavData = encodeWav(audioBuffer)

            setPipelineStep('stt')
            registerListeners()

            // Start streaming pipeline (returns when entire pipeline finishes)
            const result = await window.electronAPI.voiceChat.processStream(
                Array.from(new Uint8Array(wavData)),
                `voice_${Date.now()}.wav`
            )

            await waitForPlayback()

            if (!result.success && result.error !== 'No speech detected') {
                setError(result.error)
            }

            setPipelineStep('done')
        } catch (err) {
            console.error('Processing error:', err)
            setError(`Processing failed: ${err.message}`)
        } finally {
            // Cleanup stream listeners
            window.electronAPI.voiceChat.removeStreamListeners()
            isProcessingRef.current = false
            setIsProcessing(false)
            setPipelineStep(null)
        }
    }

    const playAudioData = (audioDataArray, mimeType) => {
        return new Promise((resolve) => {
            try {
                const uint8 = new Uint8Array(audioDataArray)
                const blob = new Blob([uint8], { type: mimeType })
                const url = URL.createObjectURL(blob)

                if (audioPlayerRef.current) {
                    audioPlayerRef.current.pause()
                }

                const audio = new Audio(url)
                audioPlayerRef.current = audio
                audio.onended = () => {
                    URL.revokeObjectURL(url)
                    resolve()
                }
                audio.onerror = () => {
                    URL.revokeObjectURL(url)
                    resolve()
                }
                audio.play().catch(() => resolve())
            } catch {
                resolve()
            }
        })
    }

    // Encode AudioBuffer to WAV (PCM 16-bit mono)
    const encodeWav = (audioBuffer) => {
        const numChannels = 1
        const sampleRate = audioBuffer.sampleRate
        const samples = audioBuffer.getChannelData(0)
        const dataLength = samples.length * 2
        const buffer = new ArrayBuffer(44 + dataLength)
        const view = new DataView(buffer)

        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i))
            }
        }

        writeString(0, 'RIFF')
        view.setUint32(4, 36 + dataLength, true)
        writeString(8, 'WAVE')
        writeString(12, 'fmt ')
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, numChannels, true)
        view.setUint32(24, sampleRate, true)
        view.setUint32(28, sampleRate * numChannels * 2, true)
        view.setUint16(32, numChannels * 2, true)
        view.setUint16(34, 16, true)
        writeString(36, 'data')
        view.setUint32(40, dataLength, true)

        let offset = 44
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]))
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
            offset += 2
        }

        return buffer
    }

    const pickAudioFile = async () => {
        if (isProcessingRef.current) return
        setError(null)
        isProcessingRef.current = true
        setIsProcessing(true)

        const { registerListeners, waitForPlayback } = createStreamHandler()

        try {
            // Start voice engine if not active
            if (!isListening) {
                await window.electronAPI.voiceChat.start({
                    voiceId: selectedVoiceId || undefined,
                })
            }

            setPipelineStep('stt')
            registerListeners()

            const result = await window.electronAPI.voiceChat.pickAndProcess()

            if (result.error === 'cancelled') {
                return
            }

            await waitForPlayback()

            if (!result.success && result.error !== 'No speech detected') {
                setError(result.error)
            }

            setPipelineStep('done')
        } catch (err) {
            console.error('Pick audio error:', err)
            setError(`Processing failed: ${err.message}`)
        } finally {
            window.electronAPI.voiceChat.removeStreamListeners()
            isProcessingRef.current = false
            setIsProcessing(false)
            setPipelineStep(null)

            // Stop engine if we started it just for this file
            if (!isListening) {
                try { await window.electronAPI.voiceChat.stop() } catch { }
            }
        }
    }

    const sendTextMessage = async () => {
        const text = textInput.trim()
        if (!text || isProcessingRef.current) return

        setError(null)
        isProcessingRef.current = true
        setIsProcessing(true)
        setTextInput('')

        const { registerListeners, waitForPlayback } = createStreamHandler()

        try {
            // Ensure voice engine is started (with selected voice for TTS)
            if (!isListening) {
                await window.electronAPI.voiceChat.start({
                    voiceId: selectedVoiceId || undefined,
                })
            }

            setPipelineStep('llm')
            registerListeners()

            const result = await window.electronAPI.voiceChat.processText(text)

            await waitForPlayback()

            if (!result.success) {
                setError(result.error)
            }

            setPipelineStep('done')
        } catch (err) {
            console.error('Text processing error:', err)
            setError(`Processing failed: ${err.message}`)
        } finally {
            window.electronAPI.voiceChat.removeStreamListeners()
            isProcessingRef.current = false
            setIsProcessing(false)
            setPipelineStep(null)

            if (!isListening) {
                try { await window.electronAPI.voiceChat.stop() } catch { }
            }
        }
    }

    const handleTextKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendTextMessage()
        }
    }

    const getPipelineSteps = () => {
        const steps = [
            { key: 'stt', label: 'Whisper STT', icon: '🎤' },
            { key: 'llm', label: 'Llama AI', icon: '🤖' },
            { key: 'tts', label: 'F5-TTS', icon: '🔊' },
            { key: 'playing', label: 'Phát âm', icon: '▶️' },
        ]
        return steps
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Voice Chat</h1>
                    <p className="text-slate-400 mt-1">Trò chuyện bằng giọng nói với AI</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Voice Selector */}
                    <select
                        value={selectedVoiceId}
                        onChange={(e) => setSelectedVoiceId(e.target.value)}
                        disabled={isListening}
                        className="px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-500/50 disabled:opacity-50"
                    >
                        <option value="">Không dùng TTS</option>
                        {voices.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Pipeline Status Bar */}
            {isProcessing && pipelineStep && (
                <div className="px-6 py-3 bg-white/[0.02] border-b border-white/5">
                    <div className="flex items-center gap-4">
                        {getPipelineSteps().map((step, idx) => {
                            const isActive = step.key === pipelineStep
                            const stepIdx = getPipelineSteps().findIndex(s => s.key === pipelineStep)
                            const isDone = idx < stepIdx

                            return (
                                <div key={step.key} className="flex items-center gap-2">
                                    {idx > 0 && (
                                        <div className={`w-8 h-px ${isDone ? 'bg-cyan-500' : 'bg-white/10'}`} />
                                    )}
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${isActive
                                        ? 'bg-cyan-500/20 text-cyan-400 animate-pulse'
                                        : isDone
                                            ? 'bg-emerald-500/10 text-emerald-400'
                                            : 'bg-white/5 text-slate-500'
                                        }`}>
                                        <span>{step.icon}</span>
                                        <span>{step.label}</span>
                                        {isDone && <Check className="w-3 h-3" />}
                                        {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 && !isListening && (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-teal-500/10 flex items-center justify-center mx-auto mb-4">
                                <AudioLines className="w-10 h-10 text-cyan-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-2">Voice Chat</h3>
                            <p className="text-sm text-slate-500 max-w-md">
                                Bấm nút micro bên dưới để bắt đầu. Nói chuyện bình thường,
                                khi bạn ngừng nói 2 giây, AI sẽ tự động xử lý và trả lời.
                            </p>
                        </div>
                    </div>
                )}

                {messages.length === 0 && isListening && !isProcessing && (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <div className="relative w-24 h-24 mx-auto mb-4">
                                <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping" style={{ animationDuration: '2s' }} />
                                <div className="absolute inset-2 rounded-full bg-cyan-500/10 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.3s' }} />
                                <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500/20 to-teal-500/20 flex items-center justify-center border border-cyan-500/30">
                                    <Mic className="w-10 h-10 text-cyan-400" />
                                </div>
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-1">Đang lắng nghe...</h3>
                            <p className="text-sm text-slate-500">Hãy nói điều gì đó</p>
                        </div>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        {msg.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                        )}
                        <div
                            className={`max-w-2xl rounded-2xl p-4 ${msg.role === 'user'
                                ? 'bg-cyan-500 text-white'
                                : 'bg-white/[0.03] border border-white/10 text-slate-200'
                                }`}
                        >
                            <div className="whitespace-pre-wrap m-0 leading-relaxed">{msg.content?.trimStart()}</div>
                        </div>
                        {msg.role === 'user' && (
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5 text-white" />
                            </div>
                        )}
                    </div>
                ))}

                {isProcessing && (
                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                        </div>
                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
                            <div className="flex gap-1">
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="mx-6 mb-2 px-4 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-rose-400/50 hover:text-rose-400">✕</button>
                </div>
            )}

            {/* Ref Audio Panel */}
            {showRefPanel && (
                <div className="border-t border-white/10 bg-white/[0.02]">
                    <div className="p-4 max-h-48 overflow-y-auto">
                        {refAudios.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-2">Không có file audio nào trong ref_audio</p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {refAudios.map((audio) => (
                                    <div
                                        key={audio.filename}
                                        className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 hover:border-cyan-500/30 hover:bg-white/[0.06] transition-all cursor-pointer"
                                        onClick={() => processRefAudio(audio.filename)}
                                    >
                                        <div className="w-8 h-8 rounded-md bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                                            <FileAudio className="w-4 h-4 text-cyan-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-white truncate font-medium">{audio.filename}</p>
                                            <p className="text-[10px] text-slate-500">Click để xử lý</p>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                previewRefAudio(audio.path, audio.filename)
                                            }}
                                            className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full flex items-center justify-center bg-white/10 hover:bg-cyan-500/20 transition-all"
                                            title="Nghe thử"
                                        >
                                            <Play className={`w-3 h-3 ${previewingFile === audio.filename ? 'text-cyan-400' : 'text-slate-400'}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Text Input Bar */}
            {showTextInput && (
                <div className="px-6 py-3 border-t border-white/10 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="flex-1 relative">
                            <input
                                ref={textInputRef}
                                type="text"
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                onKeyDown={handleTextKeyDown}
                                disabled={isProcessing}
                                placeholder="Nhập tin nhắn khi không có micro..."
                                className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:bg-white/[0.08] transition-all disabled:opacity-50"
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={sendTextMessage}
                            disabled={isProcessing || !textInput.trim()}
                            title="Gửi tin nhắn"
                            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30 bg-gradient-to-br from-cyan-500 to-teal-600 hover:from-cyan-400 hover:to-teal-500 shadow-lg shadow-cyan-500/20 text-white disabled:shadow-none"
                        >
                            {isProcessing ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <SendHorizontal className="w-5 h-5" />
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Bottom Control Bar */}
            <div className="p-6 border-t border-white/10">
                <div className="flex items-center justify-center gap-6">
                    {/* Volume Meter */}
                    {isListening && (
                        <div className="flex items-center gap-2 min-w-[120px]">
                            <Volume2 className={`w-4 h-4 ${isSilent ? 'text-slate-500' : 'text-cyan-400'}`} />
                            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-75 ${isSilent ? 'bg-slate-500' : 'bg-gradient-to-r from-cyan-500 to-teal-400'}`}
                                    style={{ width: `${volumeLevel * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Text Input Toggle Button */}
                    <button
                        onClick={() => {
                            setShowTextInput(v => !v)
                            if (!showTextInput) {
                                setTimeout(() => textInputRef.current?.focus(), 100)
                            }
                        }}
                        disabled={isProcessing}
                        title="Nhập text thay vì nói"
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 border ${showTextInput
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                            : 'bg-white/[0.06] border-white/10 hover:bg-white/[0.1] hover:border-cyan-500/30 text-slate-400 hover:text-cyan-400'
                            }`}
                    >
                        <MessageSquareText className="w-5 h-5" />
                    </button>

                    {/* Main Mic Button */}
                    <button
                        onClick={isListening ? stopListening : startListening}
                        disabled={isProcessing}
                        className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-50 ${isListening
                            ? 'bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/30'
                            : 'bg-gradient-to-br from-cyan-500 to-teal-600 hover:from-cyan-400 hover:to-teal-500 shadow-lg shadow-cyan-500/30'
                            }`}
                    >
                        {isListening && (
                            <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
                        )}
                        {isListening ? (
                            <Square className="w-6 h-6 text-white relative z-10" />
                        ) : (
                            <Mic className="w-7 h-7 text-white relative z-10" />
                        )}
                    </button>

                    {/* Ref Audio Panel Toggle */}
                    <button
                        onClick={() => setShowRefPanel(v => !v)}
                        disabled={isProcessing}
                        title="Chọn audio từ thư mục ref_audio"
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 border ${showRefPanel
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                            : 'bg-white/[0.06] border-white/10 hover:bg-white/[0.1] hover:border-cyan-500/30 text-slate-400 hover:text-cyan-400'
                            }`}
                    >
                        <FolderOpen className="w-5 h-5" />
                    </button>

                    {/* Upload Audio File Button */}
                    <button
                        onClick={pickAudioFile}
                        disabled={isProcessing}
                        title="Chọn file âm thanh từ máy tính"
                        className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] hover:border-cyan-500/30 text-slate-400 hover:text-cyan-400"
                    >
                        <FileAudio className="w-5 h-5" />
                    </button>

                    {/* Status Text */}
                    {isListening && (
                        <div className="min-w-[120px] text-right">
                            {isProcessing ? (
                                <span className="text-sm text-amber-400 flex items-center gap-1.5 justify-end">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Đang xử lý...
                                </span>
                            ) : isSilent ? (
                                <span className="text-sm text-slate-500">Im lặng...</span>
                            ) : (
                                <span className="text-sm text-cyan-400">Đang nghe...</span>
                            )}
                        </div>
                    )}
                </div>

                {!isListening && (
                    <p className="text-center text-xs text-slate-600 mt-3">
                        Bấm micro để nói, nhấn 💬 để gõ text, hoặc chọn file âm thanh
                    </p>
                )}
            </div>
        </div>
    )
}
