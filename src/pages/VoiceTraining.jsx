import { useState, useRef, useEffect } from 'react'
import { Mic, Upload, Play, Pause, Trash2, AudioLines, AlertCircle, Check, RefreshCw, Download, ExternalLink, Volume2, Zap, Server, FileAudio } from 'lucide-react'

export default function VoiceTraining() {
    const [voices, setVoices] = useState([])
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const [isPlaying, setIsPlaying] = useState(null)
    const [generatedVoices, setGeneratedVoices] = useState([])
    const [selectedVoice, setSelectedVoice] = useState(null)
    const [ttsText, setTtsText] = useState('xin chào mọi người hôm nay là thứ bảy')
    const [isGenerating, setIsGenerating] = useState(false)
    const [generatedAudio, setGeneratedAudio] = useState(null)
    const [ttsStatus, setTtsStatus] = useState(null) // null, 'checking', 'ready', 'not_installed', 'installing'
    const [installLog, setInstallLog] = useState([])
    const [setupStatus, setSetupStatus] = useState({ checking: true, installed: false, error: null })
    const [isInstalling, setIsInstalling] = useState(false)
    const [useQwenCorrection, setUseQwenCorrection] = useState(true) // Enable Qwen by default
    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const timerRef = useRef(null)
    const audioPlayerRef = useRef(null) // Store current audio instance

    useEffect(() => {
        checkStatus()
        loadRefAudios()
        loadGeneratedAudios()

        // Cleanup on unmount
        return () => {
            // Stop recording if active
            if (mediaRecorderRef.current && isRecording) {
                mediaRecorderRef.current.stop()
                mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
            }

            // Clear timer
            if (timerRef.current) {
                clearInterval(timerRef.current)
            }

            // Stop audio playback
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }

            // Revoke blob URLs
            voices.forEach(v => {
                if (v?.audioUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(v.audioUrl)
                }
            })
        }
    }, [])

    const checkStatus = async () => {
        setTtsStatus('checking')
        try {
            if (window.electronAPI?.tts) {
                const status = await window.electronAPI.tts.getStatus()
                setTtsStatus(status)
            } else {
                setTtsStatus('demo')
            }
        } catch (e) {
            setTtsStatus('not_installed')
        }
    }

    const loadRefAudios = async () => {
        try {
            if (window.electronAPI?.tts) {
                const refs = await window.electronAPI.tts.listRefs()
                if (refs.length > 0) {
                    setVoices(refs.map((r, i) => ({
                        id: i + 1,
                        name: r.filename,
                        path: r.path,
                        // Don't set audioUrl - will be created as blob URL on-demand when playing
                        transcript: '',
                        status: 'ready'
                    })))
                }
            }
        } catch (e) {
            console.error('Error loading refs:', e)
        }
    }

    const loadGeneratedAudios = async () => {
        try {
            if (window.electronAPI?.tts) {
                const outputs = await window.electronAPI.tts.listOutputs()
                if (outputs.length > 0) {
                    setGeneratedVoices(outputs.map((o, i) => ({
                        id: `gen_${i}`,
                        name: o.filename,
                        path: o.path,
                        timestamp: new Date(o.stats.mtimeMs), // Convert to Date object
                        status: 'ready'
                    })))
                }
            }
        } catch (e) {
            console.error('Error loading generated audios:', e)
        }
    }

    const installF5TTS = async () => {
        setTtsStatus('installing')
        setInstallLog(['🎙️ Đang cài đặt F5-TTS Vietnamese...'])

        try {
            if (window.electronAPI?.tts) {
                const result = await window.electronAPI.tts.install()
                if (result.success || result.ready) {
                    setInstallLog(prev => [...prev, '✅ Cài đặt hoàn tất!'])
                    setTtsStatus('ready')
                } else {
                    setInstallLog(prev => [...prev, `❌ Lỗi: ${result.error}`])
                    setTtsStatus('not_installed')
                }
            }
        } catch (e) {
            setInstallLog(prev => [...prev, `❌ Lỗi: ${e.message}`])
            setTtsStatus('not_installed')
        }
    }

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    const startRecording = async () => {
        console.log('=== START RECORDING CALLED ===')
        try {
            // Better audio constraints for TTS quality
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,      // Remove echo
                    noiseSuppression: true,       // Remove background noise
                    autoGainControl: true,        // Normalize volume
                    channelCount: 1,              // Mono
                    sampleRate: 48000             // High quality sample rate
                }
            })
            console.log('Microphone stream obtained with enhanced constraints')

            mediaRecorderRef.current = new MediaRecorder(stream)
            audioChunksRef.current = []

            mediaRecorderRef.current.ondataavailable = (event) => {
                console.log('Data available, size:', event.data.size)
                audioChunksRef.current.push(event.data)
            }

            mediaRecorderRef.current.onstop = async () => {
                console.log('=== RECORDING STOPPED, processing... ===')
                console.log('Audio chunks collected:', audioChunksRef.current.length)

                // MediaRecorder produces WebM/Opus, not WAV
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                console.log('Audio blob created, size:', audioBlob.size)
                const filename = `ref_${Date.now()}.webm`

                // Upload to backend
                let serverPath = null
                try {
                    if (window.electronAPI?.tts) {
                        console.log('Uploading to backend...')
                        const arrayBuffer = await audioBlob.arrayBuffer()
                        const result = await window.electronAPI.tts.uploadRef(arrayBuffer, filename)
                        if (result.success) {
                            serverPath = result.path
                            console.log('Upload successful, path:', serverPath)

                            // Convert WebM to WAV for better TTS quality
                            try {
                                console.log('Converting to WAV...')
                                const convResult = await window.electronAPI.tts.convertToWav(serverPath)
                                if (convResult.success) {
                                    serverPath = convResult.wavPath
                                    console.log('Conversion successful, WAV path:', serverPath)
                                } else {
                                    console.error('Conversion failed:', convResult.error)
                                    alert('Cảnh báo: Không thể convert sang WAV. Lưu format WebM.')
                                    // Continue with WebM path
                                }
                            } catch (convError) {
                                console.error('Conversion error:', convError)
                                alert('Lỗi conversion: ' + convError.message)
                                // Continue with WebM path if conversion fails
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Could not upload:', e)
                }

                const audioUrl = URL.createObjectURL(audioBlob)
                const newVoice = {
                    id: Date.now(),
                    name: serverPath ? serverPath.split('/').pop() : filename, // Use actual filename from server
                    duration: formatTime(recordingTime),
                    createdAt: new Date().toLocaleDateString('vi-VN'),
                    status: 'ready',
                    audioUrl,
                    audioBlob,
                    path: serverPath,
                    transcript: ''
                }
                console.log('Adding new voice to list:', newVoice.name)
                setVoices(prev => [newVoice, ...prev])

                // Reload from backend after a delay to ensure WAV conversion completes
                if (serverPath) {
                    setTimeout(() => {
                        console.log('Reloading voices from backend...')
                        loadRefAudios()
                    }, 2000) // Increased from 1000ms to 2000ms for WAV conversion
                }
            }

            mediaRecorderRef.current.start()
            console.log('MediaRecorder started, setting isRecording to true')
            setIsRecording(true)
            setRecordingTime(0)

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1)
            }, 1000)
            console.log('Timer started')
        } catch (error) {
            console.error('Recording error:', error)
            alert('Không thể truy cập microphone')
        }
    }

    const stopRecording = () => {
        console.log('stopRecording called, isRecording:', isRecording)
        if (mediaRecorderRef.current && isRecording) {
            console.log('Stopping MediaRecorder...')
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
        }
        setIsRecording(false)
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        console.log('stopRecording completed')
    }

    const deleteVoice = async (id) => {
        const voice = voices.find(v => v.id === id)

        // Delete from backend if it has a path
        if (voice?.path && window.electronAPI?.tts) {
            try {
                console.log('Deleting voice file:', voice.path)
                const result = await window.electronAPI.tts.deleteRef(voice.path)
                if (!result.success) {
                    console.error('Failed to delete file:', result.error)
                    alert('Không thể xóa file: ' + result.error)
                    return // Don't proceed if delete failed
                }
                console.log('File deleted successfully')
            } catch (e) {
                console.error('Error deleting voice file:', e)
                alert('Lỗi khi xóa file')
                return
            }
        }

        // Revoke blob URL if exists
        if (voice?.audioUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(voice.audioUrl)
        }

        // Remove from state
        setVoices(prev => prev.filter(v => v.id !== id))
        if (selectedVoice === id) setSelectedVoice(null)

        // Reload from backend to stay in sync
        setTimeout(() => loadRefAudios(), 300)
    }

    const playVoice = async (voice) => {
        console.log('=== PLAY VOICE CALLED ===')
        console.log('Voice object:', voice)
        console.log('Voice audioUrl:', voice.audioUrl)
        console.log('Voice path:', voice.path)

        // Toggle off if clicking same voice - PAUSE FIRST
        if (isPlaying === voice.id) {
            console.log('Pausing current playback')
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }
            setIsPlaying(null)
            return
        }

        // Stop current playback if switching to different voice
        if (audioPlayerRef.current) {
            console.log('Stopping different voice playback')
            audioPlayerRef.current.pause()
            audioPlayerRef.current = null
        }

        // Create and play new audio
        try {
            let audioUrl = voice.audioUrl

            // If we have a file path but no blob URL, read file via Electron and create blob
            if (!audioUrl && voice.path && window.electronAPI?.tts) {
                console.log('Reading audio file from:', voice.path)
                try {
                    const result = await window.electronAPI.tts.readAudio(voice.path)
                    if (result.success) {
                        const uint8Array = new Uint8Array(result.data)
                        const blob = new Blob([uint8Array], { type: result.mimeType })
                        audioUrl = URL.createObjectURL(blob)
                        console.log('Created blob URL:', audioUrl)
                    } else {
                        console.error('Failed to read audio file:', result.error)
                        alert('Không thể đọc file audio: ' + result.error)
                        return
                    }
                } catch (e) {
                    console.error('Error reading audio file:', e)
                    alert('Lỗi khi đọc file audio')
                    return
                }
            }

            if (!audioUrl) {
                alert('Không tìm thấy audio URL')
                return
            }

            console.log('Attempting to play audio from:', audioUrl)
            const audio = new Audio(audioUrl)

            audio.onended = () => {
                console.log('Audio playback ended')
                setIsPlaying(null)
                audioPlayerRef.current = null
            }

            audio.onerror = (e) => {
                console.error('Audio playback error:', e)
                console.error('Error target:', e.target)
                console.error('Error details:', e.target.error)
                alert('Không thể phát audio. File có thể bị lỗi.')
                setIsPlaying(null)
                audioPlayerRef.current = null
            }

            audio.onloadeddata = () => {
                console.log('Audio data loaded successfully')
            }

            audio.play().catch(err => {
                console.error('Play error:', err)
                alert('Không thể phát audio')
                setIsPlaying(null)
                audioPlayerRef.current = null
            })

            audioPlayerRef.current = audio
            setIsPlaying(voice.id)
            console.log('Audio playback initiated')
        } catch (error) {
            console.error('Playback error:', error)
            alert('Lỗi khi phát audio')
        }
    }

    const updateTranscript = (id, transcript) => {
        setVoices(prev => prev.map(v => v.id === id ? { ...v, transcript } : v))
    }

    const generateTTS = async () => {
        if (!ttsText.trim() || !selectedVoice) return

        const refVoice = voices.find(v => v.id === selectedVoice)
        if (!refVoice || !refVoice.path) {
            alert('Vui lòng chọn giọng mẫu đã upload')
            return
        }

        setIsGenerating(true)
        setGeneratedAudio(null)

        try {
            let result
            if (window.electronAPI?.tts) {
                result = await window.electronAPI.tts.generate({
                    refAudio: refVoice.path,
                    refText: refVoice.transcript || '',
                    genText: ttsText,
                    speed: 1.0
                })
            } else {
                // Demo mode
                await new Promise(r => setTimeout(r, 2000))
                result = { success: true, audioPath: refVoice.audioUrl }
            }

            if (result.success) {
                setGeneratedAudio({
                    path: result.audioPath,
                    url: result.audioPath.startsWith('file://') ? result.audioPath : `file://${result.audioPath}`
                })
            } else {
                alert('Lỗi: ' + result.error)
            }
        } catch (e) {
            alert('Lỗi tạo giọng nói: ' + e.message)
        } finally {
            setIsGenerating(false)
        }
    }

    const playGenerated = async () => {
        if (!generatedAudio) return

        try {
            let audioUrl = generatedAudio.url

            // If URL is file://, read via IPC and create blob
            if (audioUrl && audioUrl.startsWith('file://')) {
                const filepath = audioUrl.replace('file://', '')
                console.log('Reading generated audio from:', filepath)

                if (window.electronAPI?.tts) {
                    const result = await window.electronAPI.tts.readAudio(filepath)
                    if (result.success) {
                        const uint8Array = new Uint8Array(result.data)
                        const blob = new Blob([uint8Array], { type: result.mimeType })
                        audioUrl = URL.createObjectURL(blob)
                        console.log('Created blob URL for playback:', audioUrl)
                    } else {
                        alert('Không thể đọc file audio: ' + result.error)
                        return
                    }
                }
            } else if (generatedAudio.path && window.electronAPI?.tts) {
                // Fallback: use path directly
                const result = await window.electronAPI.tts.readAudio(generatedAudio.path)
                if (result.success) {
                    const uint8Array = new Uint8Array(result.data)
                    const blob = new Blob([uint8Array], { type: result.mimeType })
                    audioUrl = URL.createObjectURL(blob)
                } else {
                    alert('Không thể đọc file: ' + result.error)
                    return
                }
            }

            if (!audioUrl) {
                alert('Không tìm thấy audio URL')
                return
            }

            const audio = new Audio(audioUrl)
            audio.play().catch(err => {
                console.error('Playback error:', err)
                alert('Không thể phát audio')
            })
        } catch (error) {
            console.error('Error playing generated audio:', error)
            alert('Lỗi khi phát audio')
        }
    }
    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Voice Training</h1>
                    <p className="text-slate-400 mt-1">Voice Cloning với F5-TTS Vietnamese</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm ${ttsStatus === 'ready'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : ttsStatus === 'checking' || ttsStatus === 'installing'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                        {ttsStatus === 'ready' && <><Check className="w-4 h-4" /> F5-TTS Ready</>}
                        {ttsStatus === 'checking' && <><RefreshCw className="w-4 h-4 animate-spin" /> Đang kiểm tra...</>}
                        {ttsStatus === 'installing' && <><RefreshCw className="w-4 h-4 animate-spin" /> Đang cài đặt...</>}
                        {ttsStatus === 'not_installed' && <><AlertCircle className="w-4 h-4" /> Chưa cài đặt</>}
                        {ttsStatus === 'demo' && <><Check className="w-4 h-4" /> Demo Mode</>}
                    </div>
                    <a
                        href="https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all text-sm"
                    >
                        <ExternalLink className="w-4 h-4" />
                        Model
                    </a>
                </div>
            </div>

            {/* Install Card */}
            {ttsStatus === 'not_installed' && (
                <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                            <Server className="w-6 h-6 text-amber-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-white mb-2">Cài đặt F5-TTS Vietnamese</h3>
                            <p className="text-sm text-slate-400 mb-4">
                                Chạy lệnh sau hoặc nhấn "Cài đặt tự động":
                            </p>
                            <div className="bg-[#0a0a12] rounded-xl p-4 font-mono text-xs text-slate-300 mb-4 overflow-x-auto">
                                <code>cd python && pip install -e F5-TTS-Vietnamese</code>
                            </div>

                            {installLog.length > 0 && (
                                <div className="bg-[#0a0a12] rounded-xl p-4 mb-4 max-h-32 overflow-y-auto">
                                    {installLog.map((log, i) => (
                                        <p key={i} className="text-xs font-mono text-slate-400">{log}</p>
                                    ))}
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={installF5TTS}
                                    disabled={ttsStatus === 'installing'}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-black font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
                                >
                                    {ttsStatus === 'installing' ? (
                                        <><RefreshCw className="w-4 h-4 animate-spin" /> Đang cài...</>
                                    ) : (
                                        <><Download className="w-4 h-4" /> Cài đặt tự động</>
                                    )}
                                </button>
                                <button
                                    onClick={checkStatus}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4" /> Kiểm tra lại
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Info Card */}
            <div className="rounded-2xl bg-gradient-to-r from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-6">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                        <Volume2 className="w-6 h-6 text-violet-400" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-white mb-1">F5-TTS Vietnamese ViVoice</h3>
                        <p className="text-sm text-slate-400 mb-3">
                            Voice Cloning AI - Nhân bản giọng nói từ 3-10 giây audio mẫu. Train trên 1000h data tiếng Việt.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">1000h Dataset</span>
                            <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium">Voice Cloning</span>
                            <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium">Zero-shot TTS</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Panel */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Recording */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <Mic className="w-5 h-5 text-violet-400" />
                            Thu âm giọng mẫu (Reference Audio)
                        </h3>
                        <div className="text-center">
                            <div className="relative inline-block mb-6">
                                <button
                                    onClick={() => {
                                        console.log('Button clicked! isRecording:', isRecording)
                                        if (isRecording) {
                                            stopRecording()
                                        } else {
                                            startRecording()
                                        }
                                    }}
                                    className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all ${isRecording
                                        ? 'bg-rose-500 shadow-[0_0_40px_rgba(239,68,68,0.4)] hover:bg-rose-600'
                                        : 'bg-gradient-to-br from-violet-500 to-purple-600 hover:shadow-[0_0_30px_rgba(139,92,246,0.4)]'
                                        }`}
                                >
                                    {isRecording ? (
                                        <div className="w-8 h-8 bg-white rounded-md"></div>
                                    ) : (
                                        <Mic className="w-10 h-10 text-white" />
                                    )}
                                </button>
                                {isRecording && (
                                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
                                        <div className="px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30">
                                            <span className="text-xs text-rose-300 font-medium">Click để dừng</span>
                                        </div>
                                    </div>
                                )}
                                {isRecording && (
                                    <div className="absolute -inset-4 border-4 border-rose-500/30 rounded-full animate-ping pointer-events-none" />
                                )}
                            </div>

                            <p className="text-4xl font-bold text-white font-mono mb-4">
                                {formatTime(recordingTime)}
                            </p>

                            <p className="text-slate-300 text-sm mb-2">
                                {isRecording
                                    ? 'Đang thu âm... Nhấn để dừng'
                                    : 'Nhấn để thu âm giọng mẫu (3-30 giây)'}
                            </p>

                            {isRecording && (
                                <div className="mt-6 flex items-center justify-center gap-1 h-12">
                                    {[...Array(24)].map((_, i) => {
                                        const baseHeight = 20 + Math.sin(i * 0.5) * 15
                                        const animDuration = 0.8 + (i % 5) * 0.1
                                        return (
                                            <div
                                                key={i}
                                                className="w-1 bg-violet-500 rounded-full animate-pulse"
                                                style={{
                                                    height: `${baseHeight}px`,
                                                    animationDuration: `${animDuration}s`,
                                                    animationDelay: `${i * 30}ms`
                                                }}
                                            />
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Generate */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Zap className="w-5 h-5 text-cyan-400" />
                            Tạo giọng nói (Voice Cloning)
                        </h3>

                        {voices.length === 0 ? (
                            <div className="text-center py-8">
                                <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                                <p className="text-slate-400">Thu âm giọng mẫu trước</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Select Reference */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">1. Chọn giọng mẫu</label>
                                    <div className="flex flex-wrap gap-2">
                                        {voices.map(voice => (
                                            <button
                                                key={voice.id}
                                                onClick={() => setSelectedVoice(voice.id)}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${selectedVoice === voice.id
                                                    ? 'bg-violet-500 text-white'
                                                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                                                    }`}
                                            >
                                                {voice.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Transcript */}
                                {selectedVoice && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-400 mb-2">
                                            2. Transcript (nội dung audio mẫu đọc)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={voices.find(v => v.id === selectedVoice)?.transcript || ''}
                                                onChange={(e) => updateTranscript(selectedVoice, e.target.value)}
                                                placeholder="Nhập nội dung mà audio mẫu đang đọc..."
                                                className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 transition-colors"
                                            />
                                            <button
                                                onClick={async () => {
                                                    const voice = voices.find(v => v.id === selectedVoice);
                                                    if (!voice?.path) return;

                                                    setIsGenerating(true);
                                                    try {
                                                        // Step 1: Whisper transcription
                                                        const result = await window.electronAPI.tts.transcribeAudio(voice.path);
                                                        if (result.success) {
                                                            let finalText = result.text;

                                                            // Step 2: Qwen post-processing (if enabled)
                                                            if (useQwenCorrection) {
                                                                const qwenResult = await window.electronAPI.qwen.processText(result.text, 'correct');
                                                                if (qwenResult.success) {
                                                                    finalText = qwenResult.text;
                                                                }
                                                            }

                                                            updateTranscript(selectedVoice, finalText);
                                                        } else {
                                                            alert('Lỗi: ' + result.error);
                                                        }
                                                    } catch (error) {
                                                        alert('Lỗi transcribe: ' + error.message);
                                                    }
                                                    setIsGenerating(false);
                                                }}
                                                disabled={isGenerating}
                                                className="px-4 py-3 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                                title="Auto-transcribe audio"
                                            >
                                                {isGenerating ? (
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <AudioLines className="w-4 h-4" />
                                                )}
                                                <span className="hidden sm:inline">Auto</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Text to Generate */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">
                                        3. Văn bản cần tạo
                                    </label>
                                    <textarea
                                        value={ttsText}
                                        onChange={(e) => setTtsText(e.target.value)}
                                        placeholder="Nhập văn bản tiếng Việt..."
                                        className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none h-24"
                                    />
                                </div>

                                {/* Generate Button */}
                                <button
                                    onClick={generateTTS}
                                    disabled={!ttsText.trim() || !selectedVoice || isGenerating}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isGenerating ? (
                                        <><RefreshCw className="w-5 h-5 animate-spin" /> Đang tạo...</>
                                    ) : (
                                        <><Zap className="w-5 h-5" /> Tạo giọng nói</>
                                    )}
                                </button>

                                {/* Result */}
                                {generatedAudio && (
                                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                                    <Check className="w-5 h-5 text-emerald-400" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-white text-sm">Thành công!</p>
                                                    <p className="text-xs text-slate-400 truncate max-w-[200px]">{generatedAudio.path}</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={playGenerated} className="p-2 rounded-lg bg-white/10 hover:bg-emerald-500/20">
                                                    <Play className="w-4 h-4 text-white" />
                                                </button>
                                                <a href={generatedAudio.url} download className="p-2 rounded-lg bg-white/10 hover:bg-violet-500/20">
                                                    <Download className="w-4 h-4 text-white" />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Generated Voices List */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-3">
                                <Zap className="w-5 h-5 text-emerald-400" />
                                Giọng đã tạo
                            </h2>
                            <span className="text-sm text-slate-400">{generatedVoices.length}</span>
                        </div>

                        {generatedVoices.length === 0 ? (
                            <div className="p-8 text-center">
                                <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                                <p className="text-slate-500 text-sm">Chưa có giọng nào được tạo</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                                {generatedVoices.map(voice => (
                                    <div
                                        key={voice.id}
                                        className="px-4 py-3 hover:bg-white/[0.02] group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => playVoice(voice)}
                                                className="shrink-0 w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-emerald-500/20"
                                            >
                                                {isPlaying === voice.id ? (
                                                    <Pause className="w-4 h-4 text-emerald-400" />
                                                ) : (
                                                    <Play className="w-4 h-4 text-emerald-400" />
                                                )}
                                            </button>

                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-white text-sm truncate">{voice.name}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    {new Date(voice.timestamp).toLocaleString('vi-VN', {
                                                        day: '2-digit',
                                                        month: '2-digit',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </p>
                                            </div>

                                            <a
                                                href={`file://${voice.path}`}
                                                download
                                                className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Download"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Reference Voices List */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-3">
                                <FileAudio className="w-5 h-5 text-cyan-400" />
                                Giọng mẫu
                            </h2>
                            <span className="text-sm text-slate-400">{voices.length}</span>
                        </div>

                        {voices.length === 0 ? (
                            <div className="p-8 text-center">
                                <Mic className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                                <p className="text-slate-500 text-sm">Chưa có giọng mẫu</p>
                                <p className="text-slate-600 text-xs">Thu âm 3-10 giây</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
                                {voices.map(voice => (
                                    <div
                                        key={voice.id}
                                        className={`px-4 py-3 hover:bg-white/[0.02] cursor-pointer ${selectedVoice === voice.id ? 'bg-violet-500/10 border-l-2 border-violet-500' : ''}`}
                                        onClick={() => setSelectedVoice(voice.id)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); playVoice(voice) }}
                                                    className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-violet-500/20"
                                                >
                                                    {isPlaying === voice.id ? (
                                                        <Pause className="w-4 h-4 text-violet-400" />
                                                    ) : (
                                                        <Play className="w-4 h-4 text-slate-400" />
                                                    )}
                                                </button>
                                                <div>
                                                    <p className="font-medium text-white text-sm truncate max-w-[120px]">{voice.name}</p>
                                                    <p className="text-xs text-slate-500">{voice.duration || '---'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {voice.path && <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</span>}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteVoice(voice.id) }}
                                                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
