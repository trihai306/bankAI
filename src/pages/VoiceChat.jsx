import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, MicOff, Square, Volume2, Bot, User, AlertCircle, Check, Loader2, AudioLines } from 'lucide-react'

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

    const mediaRecorderRef = useRef(null)
    const audioContextRef = useRef(null)
    const analyserRef = useRef(null)
    const streamRef = useRef(null)
    const chunksRef = useRef([])
    const silenceStartRef = useRef(null)
    const animFrameRef = useRef(null)
    const isProcessingRef = useRef(false)
    const audioPlayerRef = useRef(null)

    // Load voices on mount
    useEffect(() => {
        loadVoices()
        return () => stopListening()
    }, [])

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
            try { mediaRecorderRef.current?.stop() } catch {}
        }
        mediaRecorderRef.current = null

        // Stop audio context
        if (audioContextRef.current?.state !== 'closed') {
            try { await audioContextRef.current?.close() } catch {}
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
        } catch {}
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

        try {
            // Convert WebM chunks to a single blob
            const blob = new Blob(audioChunks, { type: 'audio/webm' })
            const arrayBuffer = await blob.arrayBuffer()

            // Decode to PCM WAV for Whisper
            const audioCtx = new OfflineAudioContext(1, SAMPLE_RATE * 30, SAMPLE_RATE)
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
            const wavData = encodeWav(audioBuffer)

            // Send to backend pipeline
            setPipelineStep('stt')
            const result = await window.electronAPI.voiceChat.process(
                Array.from(new Uint8Array(wavData)),
                `voice_${Date.now()}.wav`
            )

            if (result.success) {
                setPipelineStep('llm')
                // Transcript arrived (STT done), LLM response is in result
                setMessages(prev => [
                    ...prev,
                    { role: 'user', content: result.transcript, timestamp: Date.now() },
                ])

                setPipelineStep('tts')
                setMessages(prev => [
                    ...prev,
                    { role: 'assistant', content: result.responseText, timestamp: Date.now() },
                ])

                // Play TTS audio if available
                if (result.audioData) {
                    setPipelineStep('playing')
                    await playAudioData(result.audioData, result.audioMimeType || 'audio/wav')
                }

                setPipelineStep('done')
            } else if (result.error !== 'No speech detected') {
                setError(result.error)
            }
        } catch (err) {
            console.error('Processing error:', err)
            setError(`Processing failed: ${err.message}`)
        } finally {
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
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                        isActive
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
                            <p className="whitespace-pre-wrap">{msg.content}</p>
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

                    {/* Main Mic Button */}
                    <button
                        onClick={isListening ? stopListening : startListening}
                        disabled={isProcessing}
                        className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-50 ${
                            isListening
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
                        Bấm nút micro để bắt đầu trò chuyện bằng giọng nói
                    </p>
                )}
            </div>
        </div>
    )
}
