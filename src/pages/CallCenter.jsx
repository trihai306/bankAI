import { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneCall, PhoneOff, Mic, MicOff, Volume2, VolumeX, User, Bot, MessageSquare } from 'lucide-react'

export default function CallCenter() {
    const [isCallActive, setIsCallActive] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [isSpeakerOn, setIsSpeakerOn] = useState(true)
    const [callDuration, setCallDuration] = useState(0)
    const [phoneNumber, setPhoneNumber] = useState('')
    const [conversation, setConversation] = useState([])
    const [aiStatus, setAiStatus] = useState('idle')
    const [refVoices, setRefVoices] = useState([])
    const [selectedRefVoice, setSelectedRefVoice] = useState('')
    const [liveText, setLiveText] = useState('') // Live transcription while speaking
    const [audioLevel, setAudioLevel] = useState(0) // Mic level 0-100

    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const isPlayingRef = useRef(false)
    const callActiveRef = useRef(false)
    const conversationRef = useRef([])
    const chatEndRef = useRef(null)
    const silenceTimerRef = useRef(null)
    const speechRecRef = useRef(null) // Web Speech API for live captions
    const audioCtxRef = useRef(null) // Track AudioContext for cleanup
    const streamRef = useRef(null) // Track media stream for cleanup
    const startListeningRef = useRef(null)
    const processRecordingRef = useRef(null)

    useEffect(() => { callActiveRef.current = isCallActive }, [isCallActive])
    useEffect(() => { conversationRef.current = conversation }, [conversation])
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [conversation])

    // Timer
    useEffect(() => {
        let t
        if (isCallActive) t = setInterval(() => setCallDuration(p => p + 1), 1000)
        return () => clearInterval(t)
    }, [isCallActive])

    // Load voices
    useEffect(() => {
        if (window.electronAPI?.tts) {
            window.electronAPI.tts.listRefs().then(refs => {
                setRefVoices(refs)
                if (refs.length > 0) setSelectedRefVoice(refs[0].path)
            }).catch(() => {})
        }
    }, [])

    const formatDuration = (s) => {
        const m = Math.floor(s / 60), ss = s % 60
        return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
    }

    const addMessage = useCallback((role, text) => {
        setConversation(prev => [...prev, { role, text, time: Date.now() }])
    }, [])

    // Play audio file
    const playFile = useCallback(async (filePath) => {
        try {
            const result = await window.electronAPI.tts.readAudio(filePath)
            if (!result.success) return
            let blob
            if (result.encoding === 'base64') {
                const bin = atob(result.data)
                const bytes = new Uint8Array(bin.length)
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
                blob = new Blob([bytes], { type: result.mimeType })
            } else {
                blob = new Blob([new Uint8Array(result.data)], { type: result.mimeType })
            }
            const url = URL.createObjectURL(blob)
            await new Promise((resolve) => {
                const audio = new Audio(url)
                audio.onended = () => { URL.revokeObjectURL(url); resolve() }
                audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
                audio.play().catch(() => resolve())
            })
        } catch (e) {
            console.error('PlayFile error:', e)
        }
    }, [])

    // === SPEAK: Edge-TTS (instant) or F5-TTS (clone) ===
    const speakText = useCallback(async (text) => {
        if (!isSpeakerOn || !callActiveRef.current) return
        setAiStatus('speaking')
        isPlayingRef.current = true

        try {
            if (window.electronAPI?.tts && selectedRefVoice) {
                const result = await window.electronAPI.tts.generate({
                    refAudio: selectedRefVoice, refText: '', genText: text,
                    speed: 1.0, nfeStep: 8,
                })
                if (result.success) await playFile(result.audioPath)
            }
        } catch (e) {
            console.error('Speak error:', e)
        }

        isPlayingRef.current = false
        setAiStatus('idle')
    }, [selectedRefVoice, isSpeakerOn, playFile])

    // Speak sentences progressively
    const speakSentences = useCallback(async (sentences) => {
        for (const s of sentences) {
            if (!callActiveRef.current) break
            if (s.trim().length < 2) continue
            await speakText(s.trim())
        }
        // Resume listening after speaking
        if (callActiveRef.current) setTimeout(() => startListeningRef.current?.(), 200)
    }, [speakText])

    // Start live speech recognition (Web Speech API - for display only)
    const startLiveCaptions = useCallback(() => {
        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
            if (!SpeechRecognition) return

            const recognition = new SpeechRecognition()
            recognition.lang = 'vi-VN'
            recognition.continuous = true
            recognition.interimResults = true
            recognition.maxAlternatives = 1

            recognition.onresult = (event) => {
                let interim = ''
                let final = ''
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript
                    if (event.results[i].isFinal) {
                        final += transcript
                    } else {
                        interim += transcript
                    }
                }
                setLiveText(interim || final)
            }

            recognition.onerror = () => { /* ignore - display only */ }
            recognition.onend = () => {
                // Restart if still listening
                if (callActiveRef.current && !isPlayingRef.current) {
                    try { recognition.start() } catch { /* ignore */ }
                }
            }

            recognition.start()
            speechRecRef.current = recognition
        } catch { /* ignore - Web Speech API optional */ }
    }, [])

    const stopLiveCaptions = useCallback(() => {
        if (speechRecRef.current) {
            try { speechRecRef.current.stop() } catch { /* ignore */ }
            speechRecRef.current = null
        }
        setLiveText('')
    }, [])

    // === LISTEN: Record with noise filtering + smart VAD ===
    const startListening = useCallback(async () => {
        if (isMuted || !callActiveRef.current || isPlayingRef.current) return

        // Anti-echo: wait a bit after AI stops speaking
        await new Promise(r => setTimeout(r, 300))
        if (!callActiveRef.current || isPlayingRef.current) return

        setAiStatus('listening')
        setLiveText('')
        startLiveCaptions()

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                }
            })

            const audioCtx = new AudioContext()
            audioCtxRef.current = audioCtx
            streamRef.current = stream
            const source = audioCtx.createMediaStreamSource(stream)

            // === NOISE FILTER CHAIN ===
            const highPass = audioCtx.createBiquadFilter()
            highPass.type = 'highpass'
            highPass.frequency.value = 200
            highPass.Q.value = 0.7

            const lowPass = audioCtx.createBiquadFilter()
            lowPass.type = 'lowpass'
            lowPass.frequency.value = 8000
            lowPass.Q.value = 0.7

            const compressor = audioCtx.createDynamicsCompressor()
            compressor.threshold.value = -30
            compressor.knee.value = 20
            compressor.ratio.value = 6
            compressor.attack.value = 0.005
            compressor.release.value = 0.1

            const analyser = audioCtx.createAnalyser()
            analyser.fftSize = 1024
            analyser.smoothingTimeConstant = 0.3

            // Chain: source → highpass → lowpass → compressor → analyser
            source.connect(highPass)
            highPass.connect(lowPass)
            lowPass.connect(compressor)
            compressor.connect(analyser)

            // === ADAPTIVE NOISE FLOOR ===
            let noiseFloor = 0
            let noiseCalibrated = false
            const noiseSamples = []

            // VAD state
            let silenceStart = null
            let hasSpoken = false
            let speechStart = null
            let speechDuration = 0

            // Record
            const recorder = new MediaRecorder(stream)
            audioChunksRef.current = []
            recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data)

            recorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop())
                audioCtx.close()
                stopLiveCaptions()
                setAudioLevel(0)
                if (silenceTimerRef.current) { clearInterval(silenceTimerRef.current); silenceTimerRef.current = null }

                if (!callActiveRef.current) return
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

                // Bỏ qua nếu quá ngắn hoặc không có speech thực sự
                if (blob.size < 1000 || !hasSpoken || speechDuration < 300) {
                    if (callActiveRef.current) setTimeout(() => startListeningRef.current?.(), 200)
                    return
                }
                await processRecordingRef.current?.(blob)
            }

            mediaRecorderRef.current = recorder
            recorder.start()

            // === SIMPLE VAD: dùng time-domain ===
            const timeDomainData = new Uint8Array(analyser.fftSize)

            silenceTimerRef.current = setInterval(() => {
                analyser.getByteTimeDomainData(timeDomainData)

                let maxVal = 0
                for (let i = 0; i < timeDomainData.length; i++) {
                    const v = Math.abs(timeDomainData[i] - 128)
                    if (v > maxVal) maxVal = v
                }

                const level = Math.min(100, Math.round((maxVal / 128) * 100))
                setAudioLevel(level)

                // Calibrate noise floor
                if (!noiseCalibrated) {
                    noiseSamples.push(maxVal)
                    if (noiseSamples.length >= 6) {
                        noiseFloor = Math.max(...noiseSamples) + 3
                        noiseCalibrated = true
                    }
                    return
                }

                const isSpeech = maxVal > Math.max(noiseFloor, 8)

                if (isSpeech) {
                    if (!hasSpoken) speechStart = Date.now()
                    hasSpoken = true
                    silenceStart = null
                    speechDuration = Date.now() - (speechStart || Date.now())
                } else if (hasSpoken) {
                    if (!silenceStart) silenceStart = Date.now()
                    const silenceMs = Date.now() - silenceStart
                    const silenceThreshold = speechDuration > 3000 ? 2000 : 1500

                    if (silenceMs > silenceThreshold) {
                        if (recorder.state === 'recording') recorder.stop()
                        clearInterval(silenceTimerRef.current)
                        silenceTimerRef.current = null
                    }
                }
            }, 80)

            // Max 12s safety
            setTimeout(() => {
                if (recorder.state === 'recording') recorder.stop()
            }, 12000)

        } catch (e) {
            console.error('Mic error:', e)
            setAiStatus('idle')
        }
    }, [isMuted, startLiveCaptions, stopLiveCaptions])

    const resumeListening = useCallback(() => {
        if (callActiveRef.current) setTimeout(() => startListeningRef.current?.(), 500)
    }, [])

    // Process recorded blob → STT → LLM → TTS
    const processRecording = useCallback(async (blob) => {
        setAiStatus('thinking')

        try {
            // Upload temp
            const fname = `call_${Date.now()}.webm`
            const buf = await blob.arrayBuffer()
            const up = await window.electronAPI.tts.uploadRef(buf, fname)
            if (!up.success) { resumeListening(); return }

            let audioPath = up.path
            try {
                const conv = await window.electronAPI.tts.convertToWav(audioPath)
                if (conv.success) audioPath = conv.wavPath
            } catch { /* conversion optional */ }

            // STT
            addMessage('system', '🎤 Đang nhận diện giọng nói...')
            const stt = await window.electronAPI.tts.transcribeAudio(audioPath)
            try { await window.electronAPI.tts.deleteRef(audioPath) } catch { /* cleanup optional */ }

            // Remove system message
            setConversation(prev => prev.filter(m => m.role !== 'system'))

            if (!stt.success || !stt.text?.trim()) {
                addMessage('system', '⚠️ Không nghe rõ, thử nói lại')
                setTimeout(() => setConversation(prev => prev.filter(m => m.role !== 'system')), 2000)
                resumeListening()
                return
            }

            const userText = stt.text.trim()
            addMessage('user', userText)

            // LLM → sentences
            const llm = await window.electronAPI.qwen.streamChat(userText, conversationRef.current.slice(-8))
            setAiStatus('idle')

            if (!llm.success || !llm.text) {
                addMessage('ai', 'Xin lỗi, tôi chưa hiểu. Bạn nói lại được không?')
                resumeListening()
                return
            }

            addMessage('ai', llm.text)

            // TTS sentences progressively
            const sentences = llm.sentences?.length > 0 ? llm.sentences : [llm.text]
            await speakSentences(sentences)

        } catch (e) {
            console.error('Process error:', e)
            setAiStatus('idle')
            resumeListening()
        }
    }, [addMessage, speakSentences, resumeListening])

    // Keep refs in sync
    useEffect(() => { startListeningRef.current = startListening }, [startListening])
    useEffect(() => { processRecordingRef.current = processRecording }, [processRecording])

    // === CALL CONTROL ===
    const startCall = (quickTest = false) => {
        if (quickTest) setPhoneNumber('AI-Test')
        setIsCallActive(true)
        setCallDuration(0)
        setConversation([])

        const greeting = 'Xin chào! Tôi là trợ lý ngân hàng AI. Tôi có thể giúp gì cho bạn?'
        addMessage('ai', greeting)

        setTimeout(async () => {
            await speakText(greeting)
            if (callActiveRef.current) startListeningRef.current?.()
        }, 300)
    }

    const endCall = async () => {
        // Save call to DB before clearing state
        if (conversationRef.current.length > 0 && window.electronAPI?.db) {
            const transcript = conversationRef.current
                .filter(m => m.role !== 'system')
                .map(m => `${m.role === 'user' ? 'Khách' : 'AI'}: ${m.text}`)
                .join('\n')
            try {
                await window.electronAPI.db.addCall({
                    phone_number: phoneNumber || 'AI-Test',
                    customer_name: null,
                    start_time: new Date().toISOString(),
                    duration: formatDuration(callDuration),
                    status: 'completed',
                    transcript,
                    recording_path: null,
                })
            } catch (e) {
                console.error('Failed to save call:', e)
            }
        }

        setIsCallActive(false)
        setCallDuration(0)
        setAiStatus('idle')
        setLiveText('')
        setAudioLevel(0)
        stopLiveCaptions()
        if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
        if (silenceTimerRef.current) { clearInterval(silenceTimerRef.current); silenceTimerRef.current = null }
        // Cleanup AudioContext and media stream to prevent leaks
        if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => {})
            audioCtxRef.current = null
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop())
            streamRef.current = null
        }
    }

    const statusConfig = {
        idle: { text: 'Sẵn sàng', color: 'text-slate-400', bg: 'bg-white/10' },
        listening: { text: 'Đang nghe...', color: 'text-emerald-400', bg: 'bg-emerald-500/20 animate-pulse' },
        thinking: { text: 'Đang xử lý...', color: 'text-amber-400', bg: 'bg-amber-500/20' },
        speaking: { text: 'Đang nói...', color: 'text-violet-400', bg: 'bg-violet-500/20 animate-pulse' },
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Call Center</h1>
                    <p className="text-sm text-slate-400 mt-1">AI Voice Bot - Cuộc gọi realtime</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Giọng AI (F5-TTS):</span>
                    <select value={selectedRefVoice} onChange={e => setSelectedRefVoice(e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white">
                        {refVoices.length === 0 && <option value="">Thu âm voice trước</option>}
                        {refVoices.map((v, i) => <option key={i} value={v.path}>{v.filename}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Phone + Quick Test */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                        {!isCallActive ? (
                            <div className="space-y-3">
                                <div className="flex gap-3">
                                    <input type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                                        placeholder="Nhập số điện thoại..."
                                        className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 font-mono focus:outline-none focus:border-violet-500/50" />
                                    <button onClick={() => startCall(false)} disabled={phoneNumber.length < 3}
                                        className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-medium flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-all">
                                        <PhoneCall className="w-5 h-5" /> Gọi
                                    </button>
                                </div>
                                <button onClick={() => startCall(true)}
                                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-700 hover:to-purple-700 active:scale-[0.98] transition-all shadow-lg shadow-violet-500/20">
                                    <Mic className="w-5 h-5" />
                                    Test Voice AI ngay
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-3 items-center">
                                <div className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white font-mono text-sm">
                                    {phoneNumber || 'AI-Test'}
                                </div>
                                <button onClick={endCall}
                                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-medium flex items-center gap-2 active:scale-95 transition-all">
                                    <PhoneOff className="w-5 h-5" /> Cúp máy
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Active Call */}
                    {isCallActive && (
                        <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-5">
                            {/* Top bar: timer + controls */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${statusConfig[aiStatus].bg}`}>
                                        {aiStatus === 'listening' ? <Mic className="w-6 h-6 text-emerald-400" /> :
                                         aiStatus === 'speaking' ? <Volume2 className="w-6 h-6 text-violet-400" /> :
                                         <Bot className="w-6 h-6 text-white/60" />}
                                    </div>
                                    <div>
                                        <p className="text-xl font-bold text-white font-mono">{formatDuration(callDuration)}</p>
                                        <p className={`text-xs font-medium ${statusConfig[aiStatus].color}`}>{statusConfig[aiStatus].text}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setIsMuted(!isMuted)}
                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-rose-500/20 text-rose-400' : 'bg-white/10 text-white'}`}>
                                        {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                    </button>
                                    <button onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${!isSpeakerOn ? 'bg-rose-500/20 text-rose-400' : 'bg-white/10 text-white'}`}>
                                        {isSpeakerOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                                    </button>
                                    <button onClick={endCall}
                                        className="w-10 h-10 rounded-full bg-rose-500 text-white flex items-center justify-center active:scale-90">
                                        <PhoneOff className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Audio level meter */}
                            {aiStatus === 'listening' && (
                                <div className="mb-3">
                                    <div className="flex items-center gap-2">
                                        <Mic className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-75"
                                                style={{ width: `${audioLevel}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Live transcription + manual send */}
                            {(liveText || aiStatus === 'listening') && (
                                <div className="flex gap-2">
                                    <div className="flex-1 rounded-xl bg-black/30 border border-white/5 px-4 py-3 min-h-[48px]">
                                        {liveText ? (
                                            <p className="text-sm text-emerald-300 italic">
                                                <span className="text-emerald-500 text-xs mr-2">LIVE</span>
                                                {liveText}
                                                <span className="inline-block w-0.5 h-4 bg-emerald-400 ml-0.5 animate-pulse" />
                                            </p>
                                        ) : (
                                            <p className="text-xs text-slate-500 italic">Đang nghe... nói gì đó rồi bấm Gửi</p>
                                        )}
                                    </div>
                                    {aiStatus === 'listening' && (
                                        <button
                                            onClick={() => {
                                                if (mediaRecorderRef.current?.state === 'recording') {
                                                    mediaRecorderRef.current.stop()
                                                }
                                            }}
                                            className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 active:scale-95 transition-all flex-shrink-0"
                                        >
                                            Gửi
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Thinking/Speaking status */}
                            {aiStatus === 'thinking' && (
                                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-xs text-amber-400">
                                    Đang xử lý giọng nói → Qwen AI...
                                </div>
                            )}
                            {aiStatus === 'speaking' && (
                                <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 px-4 py-2 text-xs text-violet-400">
                                    AI đang trả lời...
                                </div>
                            )}
                        </div>
                    )}

                    {/* Conversation */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-violet-400" />
                            <span className="text-sm font-medium text-white">Cuộc hội thoại</span>
                            {<span className="text-2xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 ml-auto">F5-TTS Clone</span>}
                        </div>
                        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                            {conversation.length === 0 && !isCallActive && (
                                <div className="text-center py-12">
                                    <Phone className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                                    <p className="text-slate-500 text-sm">Nhập số → Gọi để bắt đầu</p>
                                    <div className="mt-3 flex items-center justify-center gap-3 text-2xs text-slate-600">
                                        <span>🎤 Whisper</span><span>→</span>
                                        <span>🧠 Qwen</span><span>→</span>
                                        <span>🔊 F5-TTS</span>
                                    </div>
                                </div>
                            )}
                            {conversation.map((msg, i) => (
                                msg.role === 'system' ? (
                                    <div key={i} className="text-center">
                                        <span className="text-2xs text-slate-500 bg-white/5 px-3 py-1 rounded-full">{msg.text}</span>
                                    </div>
                                ) : (
                                    <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                                        {msg.role === 'ai' && (
                                            <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <Bot className="w-3.5 h-3.5 text-violet-400" />
                                            </div>
                                        )}
                                        <div className={`max-w-xs rounded-xl px-3 py-2 text-sm ${
                                            msg.role === 'user'
                                                ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/15'
                                                : 'bg-white/[0.05] text-slate-200 border border-white/5'
                                        }`}>{msg.text}</div>
                                        {msg.role === 'user' && (
                                            <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <User className="w-3.5 h-3.5 text-emerald-400" />
                                            </div>
                                        )}
                                    </div>
                                )
                            ))}
                            {aiStatus === 'thinking' && (
                                <div className="flex gap-2">
                                    <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-violet-400" /></div>
                                    <div className="bg-white/[0.05] border border-white/5 rounded-xl px-3 py-2">
                                        <div className="flex gap-1">
                                            <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                            <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                            <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    </div>
                </div>

                {/* Right Panel */}
                <div className="space-y-4">
                    {/* Pipeline */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
                        <h3 className="text-xs font-bold text-white mb-3 uppercase tracking-wider">Pipeline</h3>
                        {[
                            { label: 'STT (Whisper)', step: 'listening', icon: '🎤' },
                            { label: 'LLM (Qwen 4B)', step: 'thinking', icon: '🧠' },
                            { label: 'TTS (F5-TTS Clone)', step: 'speaking', icon: '🔊' },
                        ].map((s, i) => (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-1 transition-all ${
                                aiStatus === s.step ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' : 'text-slate-600'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${aiStatus === s.step ? 'bg-violet-400 animate-pulse' : 'bg-slate-700'}`} />
                                {s.icon} {s.label}
                            </div>
                        ))}
                    </div>


                    {/* Info */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
                        <h3 className="text-xs font-bold text-white mb-2 uppercase tracking-wider">Hướng dẫn</h3>
                        <ul className="text-2xs text-slate-500 space-y-1">
                            <li>• Dùng <strong className="text-slate-400">F5-TTS</strong> clone giọng của bạn</li>
                            <li>• Thu âm voice trong <strong className="text-slate-400">Voice Training</strong> trước</li>
                            <li>• Nói xong bấm <strong className="text-slate-400">Gửi</strong> hoặc đợi 1.5s</li>
                            <li>• Pipeline: 🎤 Whisper → 🧠 Qwen → 🔊 F5-TTS</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )
}
