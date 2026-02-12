import { useState, useRef, useEffect } from 'react'
import { Mic, Play, Pause, Trash2, AudioLines, AlertCircle, Check, RefreshCw, Volume2, Zap, Plus, Save, TestTube, Edit3, X, FolderOpen, FileAudio } from 'lucide-react'

export default function VoiceCreate() {
    // Voice list state
    const [voices, setVoices] = useState([])
    const [loading, setLoading] = useState(true)

    // Create form state
    const [showForm, setShowForm] = useState(false)
    const [voiceName, setVoiceName] = useState('')
    const [transcript, setTranscript] = useState('')
    const [recordedBlob, setRecordedBlob] = useState(null)
    const [recordedUrl, setRecordedUrl] = useState(null)

    // Audio source mode: 'record' or 'file'
    const [audioSource, setAudioSource] = useState('record')
    const [refFiles, setRefFiles] = useState([])
    const [selectedFile, setSelectedFile] = useState(null)
    const [loadingFiles, setLoadingFiles] = useState(false)
    const [saving, setSaving] = useState(false)

    // Recording state
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const timerRef = useRef(null)

    // Playback state
    const [playingId, setPlayingId] = useState(null)
    const audioPlayerRef = useRef(null)

    // Transcribe state
    const [isTranscribing, setIsTranscribing] = useState(false)

    // Test generate state
    const [testVoiceId, setTestVoiceId] = useState(null)
    const [testText, setTestText] = useState('Xin chào, đây là giọng nói thử nghiệm.')
    const [isGenerating, setIsGenerating] = useState(false)
    const [generatedAudioPath, setGeneratedAudioPath] = useState(null)

    // Edit state
    const [editingId, setEditingId] = useState(null)
    const [editName, setEditName] = useState('')
    const [editTranscript, setEditTranscript] = useState('')
    const [editAudioSource, setEditAudioSource] = useState('keep')
    const [editRecordedBlob, setEditRecordedBlob] = useState(null)
    const [editRecordedUrl, setEditRecordedUrl] = useState(null)
    const [editSelectedFile, setEditSelectedFile] = useState(null)
    const [editRecording, setEditRecording] = useState(false)
    const [editRecordingTime, setEditRecordingTime] = useState(0)
    const [editSaving, setEditSaving] = useState(false)
    const [editTranscribing, setEditTranscribing] = useState(false)
    const editMediaRecorderRef = useRef(null)
    const editAudioChunksRef = useRef([])
    const editTimerRef = useRef(null)

    useEffect(() => {
        loadVoices()
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }
            if (recordedUrl) URL.revokeObjectURL(recordedUrl)
        }
    }, [])

    const loadVoices = async () => {
        try {
            if (window.electronAPI?.voices) {
                const list = await window.electronAPI.voices.list()
                setVoices(list || [])
            }
        } catch (e) {
            console.error('Error loading voices:', e)
        } finally {
            setLoading(false)
        }
    }

    const loadRefFiles = async () => {
        setLoadingFiles(true)
        try {
            if (window.electronAPI?.tts) {
                const files = await window.electronAPI.tts.listRefs()
                setRefFiles(files || [])
            }
        } catch (e) {
            console.error('Error loading ref files:', e)
        } finally {
            setLoadingFiles(false)
        }
    }

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    // === Recording ===
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 48000
                }
            })

            mediaRecorderRef.current = new MediaRecorder(stream)
            audioChunksRef.current = []

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data)
            }

            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                if (recordedUrl) URL.revokeObjectURL(recordedUrl)
                const url = URL.createObjectURL(audioBlob)
                setRecordedBlob(audioBlob)
                setRecordedUrl(url)
            }

            mediaRecorderRef.current.start()
            setIsRecording(true)
            setRecordingTime(0)
            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1)
            }, 1000)
        } catch (error) {
            console.error('Recording error:', error)
            alert('Không thể truy cập microphone')
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
        }
        setIsRecording(false)
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
    }

    // === Auto Transcribe ===
    const autoTranscribe = async () => {
        if (audioSource === 'record' && !recordedBlob) return
        if (audioSource === 'file' && !selectedFile) return
        setIsTranscribing(true)
        try {
            let audioPath

            if (audioSource === 'file' && selectedFile) {
                // Use existing file directly
                audioPath = selectedFile.path
            } else {
                // Upload temp file for transcription
                const arrayBuffer = await recordedBlob.arrayBuffer()
                const tempFilename = `temp_transcribe_${Date.now()}.webm`
                const uploadResult = await window.electronAPI.tts.uploadRef(arrayBuffer, tempFilename)
                if (!uploadResult.success) throw new Error(uploadResult.error)

                audioPath = uploadResult.path
                const convResult = await window.electronAPI.tts.convertToWav(audioPath)
                if (convResult.success) audioPath = convResult.wavPath
            }

            // Transcribe
            const result = await window.electronAPI.tts.transcribeAudio(audioPath)
            if (result.success) {
                let finalText = result.text
                try {
                    const qwen = await window.electronAPI.qwen.processText(result.text, 'correct')
                    if (qwen.success) finalText = qwen.text
                } catch {}
                setTranscript(finalText)
            } else {
                alert('Lỗi nhận dạng: ' + result.error)
            }

            // Cleanup temp file only for recorded audio
            if (audioSource === 'record') {
                try { await window.electronAPI.tts.deleteRef(audioPath) } catch {}
            }
        } catch (e) {
            console.error('Transcribe error:', e)
            alert('Lỗi: ' + e.message)
        } finally {
            setIsTranscribing(false)
        }
    }

    // === Save Voice ===
    const saveVoice = async () => {
        if (!voiceName.trim()) return alert('Vui lòng nhập tên giọng')
        if (audioSource === 'record' && !recordedBlob) return alert('Vui lòng ghi âm giọng mẫu')
        if (audioSource === 'file' && !selectedFile) return alert('Vui lòng chọn file audio')

        setSaving(true)
        try {
            let createPayload

            if (audioSource === 'file' && selectedFile) {
                // Use existing file path directly
                createPayload = {
                    name: voiceName.trim(),
                    filePath: selectedFile.path,
                    transcript: transcript.trim()
                }
            } else {
                // Upload recorded audio
                const arrayBuffer = await recordedBlob.arrayBuffer()
                createPayload = {
                    name: voiceName.trim(),
                    audioData: arrayBuffer,
                    filename: `voice_${Date.now()}.webm`,
                    transcript: transcript.trim()
                }
            }

            const result = await window.electronAPI.voices.create(createPayload)

            if (result.success) {
                // Reset form
                setVoiceName('')
                setTranscript('')
                setRecordedBlob(null)
                if (recordedUrl) URL.revokeObjectURL(recordedUrl)
                setRecordedUrl(null)
                setRecordingTime(0)
                setSelectedFile(null)
                setShowForm(false)
                await loadVoices()
            } else {
                alert('Lỗi lưu: ' + result.error)
            }
        } catch (e) {
            alert('Lỗi: ' + e.message)
        } finally {
            setSaving(false)
        }
    }

    // === Play voice audio ===
    const playVoice = async (voice) => {
        if (playingId === voice.id) {
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }
            setPlayingId(null)
            return
        }

        if (audioPlayerRef.current) {
            audioPlayerRef.current.pause()
            audioPlayerRef.current = null
        }

        try {
            const result = await window.electronAPI.tts.readAudio(voice.audio_path)
            if (!result.success) {
                alert('Không thể đọc audio: ' + result.error)
                return
            }
            const uint8Array = new Uint8Array(result.data)
            const blob = new Blob([uint8Array], { type: result.mimeType })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)

            audio.onended = () => {
                setPlayingId(null)
                audioPlayerRef.current = null
                URL.revokeObjectURL(url)
            }
            audio.onerror = () => {
                setPlayingId(null)
                audioPlayerRef.current = null
                alert('Lỗi phát audio')
            }

            audio.play()
            audioPlayerRef.current = audio
            setPlayingId(voice.id)
        } catch (e) {
            alert('Lỗi: ' + e.message)
        }
    }

    // === Delete voice ===
    const deleteVoice = async (id) => {
        if (!confirm('Bạn có chắc muốn xóa giọng này?')) return
        try {
            const result = await window.electronAPI.voices.delete(id)
            if (result.success) {
                await loadVoices()
                if (testVoiceId === id) setTestVoiceId(null)
            } else {
                alert('Lỗi xóa: ' + result.error)
            }
        } catch (e) {
            alert('Lỗi: ' + e.message)
        }
    }

    // === Edit voice ===
    const startEdit = (voice) => {
        setEditingId(voice.id)
        setEditName(voice.name)
        setEditTranscript(voice.transcript || '')
        setEditAudioSource('keep')
        setEditRecordedBlob(null)
        setEditRecordedUrl(null)
        setEditSelectedFile(null)
        setEditRecordingTime(0)
        setEditRecording(false)
    }

    const cancelEdit = () => {
        if (editRecordedUrl) URL.revokeObjectURL(editRecordedUrl)
        if (editTimerRef.current) clearInterval(editTimerRef.current)
        setEditingId(null)
    }

    const startEditRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 }
            })
            editMediaRecorderRef.current = new MediaRecorder(stream)
            editAudioChunksRef.current = []
            editMediaRecorderRef.current.ondataavailable = (e) => editAudioChunksRef.current.push(e.data)
            editMediaRecorderRef.current.onstop = () => {
                const blob = new Blob(editAudioChunksRef.current, { type: 'audio/webm' })
                if (editRecordedUrl) URL.revokeObjectURL(editRecordedUrl)
                setEditRecordedBlob(blob)
                setEditRecordedUrl(URL.createObjectURL(blob))
            }
            editMediaRecorderRef.current.start()
            setEditRecording(true)
            setEditRecordingTime(0)
            editTimerRef.current = setInterval(() => setEditRecordingTime(p => p + 1), 1000)
        } catch {
            alert('Không thể truy cập microphone')
        }
    }

    const stopEditRecording = () => {
        if (editMediaRecorderRef.current && editRecording) {
            editMediaRecorderRef.current.stop()
            editMediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
        }
        setEditRecording(false)
        if (editTimerRef.current) { clearInterval(editTimerRef.current); editTimerRef.current = null }
    }

    const editAutoTranscribe = async () => {
        const voice = voices.find(v => v.id === editingId)
        const useFile = editAudioSource === 'file' && editSelectedFile
        const useRecord = editAudioSource === 'record' && editRecordedBlob
        const useKeep = editAudioSource === 'keep' && voice
        if (!useFile && !useRecord && !useKeep) return
        setEditTranscribing(true)
        try {
            let audioPath
            if (useFile) {
                audioPath = editSelectedFile.path
            } else if (useKeep) {
                audioPath = voice.audio_path
            } else {
                const ab = await editRecordedBlob.arrayBuffer()
                const up = await window.electronAPI.tts.uploadRef(ab, `temp_edit_${Date.now()}.webm`)
                if (!up.success) throw new Error(up.error)
                audioPath = up.path
                const conv = await window.electronAPI.tts.convertToWav(audioPath)
                if (conv.success) audioPath = conv.wavPath
            }
            const result = await window.electronAPI.tts.transcribeAudio(audioPath)
            if (result.success) {
                let finalText = result.text
                try { const q = await window.electronAPI.qwen.processText(result.text, 'correct'); if (q.success) finalText = q.text } catch {}
                setEditTranscript(finalText)
            } else {
                alert('Lỗi nhận dạng: ' + result.error)
            }
            if (useRecord) { try { await window.electronAPI.tts.deleteRef(audioPath) } catch {} }
        } catch (e) {
            alert('Lỗi: ' + e.message)
        } finally {
            setEditTranscribing(false)
        }
    }

    const saveEdit = async () => {
        if (!editName.trim()) return
        setEditSaving(true)
        try {
            const updatePayload = {
                name: editName.trim(),
                transcript: editTranscript.trim()
            }
            if (editAudioSource === 'file' && editSelectedFile) {
                updatePayload.filePath = editSelectedFile.path
            } else if (editAudioSource === 'record' && editRecordedBlob) {
                updatePayload.audioData = await editRecordedBlob.arrayBuffer()
                updatePayload.filename = `voice_edit_${Date.now()}.webm`
            }

            const result = await window.electronAPI.voices.update(editingId, updatePayload)
            if (result.success) {
                cancelEdit()
                await loadVoices()
            } else {
                alert('Lỗi: ' + result.error)
            }
        } catch (e) {
            alert('Lỗi: ' + e.message)
        } finally {
            setEditSaving(false)
        }
    }

    // === Test Generate ===
    const testGenerate = async () => {
        if (!testVoiceId || !testText.trim()) return
        setIsGenerating(true)
        setGeneratedAudioPath(null)

        try {
            const result = await window.electronAPI.voices.testGenerate(testVoiceId, testText.trim())
            if (result.success) {
                setGeneratedAudioPath(result.audioPath)
            } else {
                alert('Lỗi tạo audio: ' + result.error)
            }
        } catch (e) {
            alert('Lỗi: ' + e.message)
        } finally {
            setIsGenerating(false)
        }
    }

    const playGenerated = async () => {
        if (!generatedAudioPath) return
        try {
            const result = await window.electronAPI.tts.readAudio(generatedAudioPath)
            if (result.success) {
                const uint8Array = new Uint8Array(result.data)
                const blob = new Blob([uint8Array], { type: result.mimeType })
                const url = URL.createObjectURL(blob)
                const audio = new Audio(url)
                audio.onended = () => URL.revokeObjectURL(url)
                audio.play()
            } else {
                alert('Không thể đọc audio: ' + result.error)
            }
        } catch (e) {
            alert('Lỗi: ' + e.message)
        }
    }

    // === Preview recorded audio ===
    const playRecorded = () => {
        if (!recordedUrl) return
        if (playingId === 'preview') {
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }
            setPlayingId(null)
            return
        }
        const audio = new Audio(recordedUrl)
        audio.onended = () => {
            setPlayingId(null)
            audioPlayerRef.current = null
        }
        audio.play()
        audioPlayerRef.current = audio
        setPlayingId('preview')
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Voice Create</h1>
                    <p className="mt-1 text-slate-400">Tạo và quản lý giọng đọc cho F5-TTS</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { setShowForm(!showForm); setRecordedBlob(null); setRecordedUrl(null); setVoiceName(''); setTranscript(''); setRecordingTime(0); setSelectedFile(null); setAudioSource('record') }}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all text-sm ${showForm
                            ? 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                            : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:shadow-[0_0_30px_rgba(6,182,212,0.3)]'
                            }`}
                    >
                        {showForm ? <><X className="w-4 h-4" /> Đóng</> : <><Plus className="w-4 h-4" /> Tạo Voice Mới</>}
                    </button>
                    <button
                        onClick={loadVoices}
                        className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all"
                        title="Tải lại"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Create Form */}
            {showForm && (
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 space-y-6">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                        <AudioLines className="w-5 h-5 text-cyan-400" />
                        Tạo giọng đọc mới
                    </h3>

                    {/* Voice Name */}
                    <div>
                        <label className="block mb-2 text-sm font-medium text-slate-400">Tên giọng <span className="text-rose-400">*</span></label>
                        <input
                            type="text"
                            value={voiceName}
                            onChange={(e) => setVoiceName(e.target.value)}
                            placeholder="VD: Giọng nam miền Bắc, Giọng nữ dịu dàng..."
                            className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500/50 transition-colors"
                        />
                    </div>

                    {/* Audio Source Tabs */}
                    <div>
                        <label className="block mb-3 text-sm font-medium text-slate-400">Nguồn audio mẫu <span className="text-rose-400">*</span></label>
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setAudioSource('record')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                    audioSource === 'record'
                                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                        : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                                }`}
                            >
                                <Mic className="w-4 h-4" /> Ghi âm
                            </button>
                            <button
                                onClick={() => { setAudioSource('file'); loadRefFiles() }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                    audioSource === 'file'
                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                                }`}
                            >
                                <FolderOpen className="w-4 h-4" /> Chọn từ ref_audio
                            </button>
                        </div>

                        {/* Recording Mode */}
                        {audioSource === 'record' && (
                            <div className="flex items-center gap-6">
                                <button
                                    onClick={() => isRecording ? stopRecording() : startRecording()}
                                    className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all shrink-0 ${isRecording
                                        ? 'bg-rose-500 shadow-[0_0_30px_rgba(239,68,68,0.4)] hover:bg-rose-600'
                                        : 'bg-gradient-to-br from-cyan-500 to-blue-600 hover:shadow-[0_0_24px_rgba(6,182,212,0.3)]'
                                        }`}
                                >
                                    {isRecording ? (
                                        <div className="w-6 h-6 bg-white rounded-md" />
                                    ) : (
                                        <Mic className="w-8 h-8 text-white" />
                                    )}
                                    {isRecording && (
                                        <div className="absolute border-4 rounded-full pointer-events-none -inset-3 border-rose-500/30 animate-ping" />
                                    )}
                                </button>

                                <div className="flex-1 space-y-2">
                                    <p className="font-mono text-2xl font-bold text-white">{formatTime(recordingTime)}</p>
                                    <p className="text-xs text-slate-400">
                                        {isRecording ? '🎙️ Đang thu âm... Nhấn để dừng' : recordedBlob ? '✅ Đã ghi âm xong' : 'Nhấn nút để bắt đầu ghi âm'}
                                    </p>

                                    {isRecording && (
                                        <div className="flex items-center h-8 gap-0.5">
                                            {[...Array(20)].map((_, i) => (
                                                <div
                                                    key={i}
                                                    className="w-1 rounded-full bg-cyan-500 animate-pulse"
                                                    style={{
                                                        height: `${12 + Math.sin(i * 0.6) * 10}px`,
                                                        animationDuration: `${0.6 + (i % 4) * 0.15}s`,
                                                        animationDelay: `${i * 25}ms`
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {recordedBlob && !isRecording && (
                                        <button
                                            onClick={playRecorded}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white text-xs transition-all"
                                        >
                                            {playingId === 'preview' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                            {playingId === 'preview' ? 'Dừng' : 'Nghe thử'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* File Picker Mode */}
                        {audioSource === 'file' && (
                            <div className="space-y-3">
                                {loadingFiles ? (
                                    <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                                        <RefreshCw className="w-4 h-4 animate-spin" /> Đang tải danh sách file...
                                    </div>
                                ) : refFiles.length === 0 ? (
                                    <div className="py-6 text-center rounded-xl bg-white/[0.02] border border-white/5">
                                        <FileAudio className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                                        <p className="text-sm text-slate-500">Không có file nào trong thư mục ref_audio</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-48 overflow-y-auto pr-1">
                                        {refFiles.map((file, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setSelectedFile(file)}
                                                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm transition-all ${
                                                    selectedFile?.path === file.path
                                                        ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                                                        : 'bg-white/[0.02] border border-white/5 text-slate-400 hover:text-white hover:border-white/15'
                                                }`}
                                            >
                                                <FileAudio className="w-4 h-4 shrink-0" />
                                                <span className="truncate">{file.filename}</span>
                                                {selectedFile?.path === file.path && (
                                                    <Check className="w-4 h-4 ml-auto text-amber-400 shrink-0" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {selectedFile && (
                                    <div className="flex items-center gap-2 pt-1">
                                        <span className="text-xs text-slate-500">Đã chọn:</span>
                                        <span className="text-xs font-medium text-amber-400">{selectedFile.filename}</span>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const result = await window.electronAPI.tts.readAudio(selectedFile.path)
                                                    if (result.success) {
                                                        const uint8Array = new Uint8Array(result.data)
                                                        const blob = new Blob([uint8Array], { type: result.mimeType })
                                                        const url = URL.createObjectURL(blob)
                                                        const audio = new Audio(url)
                                                        audio.onended = () => URL.revokeObjectURL(url)
                                                        audio.play()
                                                    }
                                                } catch {}
                                            }}
                                            className="flex items-center gap-1 px-2 py-1 ml-2 rounded-md bg-white/5 text-slate-400 hover:text-white text-[11px] transition-all"
                                        >
                                            <Play className="w-3 h-3" /> Nghe
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Transcript */}
                    <div>
                        <label className="block mb-2 text-sm font-medium text-slate-400">
                            Transcript (nội dung audio mẫu đọc)
                        </label>
                        <div className="flex gap-2">
                            <textarea
                                value={transcript}
                                onChange={(e) => setTranscript(e.target.value)}
                                placeholder="Nhập nội dung mà audio mẫu đang đọc, hoặc nhấn 'Tự động nhận dạng'..."
                                rows={3}
                                className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
                            />
                            {(recordedBlob || selectedFile) && (
                                <button
                                    onClick={autoTranscribe}
                                    disabled={isTranscribing}
                                    className="self-start flex items-center gap-2 px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 text-sm font-medium transition-all disabled:opacity-50 whitespace-nowrap"
                                >
                                    {isTranscribing ? (
                                        <><RefreshCw className="w-4 h-4 animate-spin" /> Đang nhận dạng...</>
                                    ) : (
                                        <><Zap className="w-4 h-4" /> Tự động nhận dạng</>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Save Button */}
                    <div className="flex justify-end pt-2">
                        <button
                            onClick={saveVoice}
                            disabled={saving || !voiceName.trim() || (audioSource === 'record' ? !recordedBlob : !selectedFile)}
                            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-medium hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {saving ? (
                                <><RefreshCw className="w-4 h-4 animate-spin" /> Đang lưu...</>
                            ) : (
                                <><Save className="w-4 h-4" /> Lưu Voice</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Voice List */}
            <div className="space-y-4">
                <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                    <Volume2 className="w-5 h-5 text-cyan-400" />
                    Danh sách giọng đọc
                    {voices.length > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-cyan-500/20">
                            {voices.length}
                        </span>
                    )}
                </h3>

                {loading ? (
                    <div className="py-12 text-center">
                        <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-slate-500" />
                        <p className="text-slate-400">Đang tải...</p>
                    </div>
                ) : voices.length === 0 ? (
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 py-16 text-center">
                        <AudioLines className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                        <p className="mb-2 text-slate-400">Chưa có giọng đọc nào</p>
                        <p className="text-sm text-slate-500">Nhấn "Tạo Voice Mới" để bắt đầu</p>
                    </div>
                ) : (
                    <>
                    {/* Edit Panel (full-width, above grid) */}
                    {editingId && (
                        <div className="mb-4 rounded-2xl bg-white/[0.03] border border-amber-500/20 p-8 space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                                    <Edit3 className="w-5 h-5 text-amber-400" />
                                    Chỉnh sửa giọng đọc
                                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-medium border border-amber-500/20">
                                        {voices.find(v => v.id === editingId)?.name}
                                    </span>
                                </h3>
                                <button onClick={cancelEdit} className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white transition-all">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Name */}
                            <div>
                                <label className="block mb-2 text-sm font-medium text-slate-400">Tên giọng <span className="text-rose-400">*</span></label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500/50 transition-colors"
                                />
                            </div>

                            {/* Audio Source Tabs */}
                            <div>
                                <label className="block mb-3 text-sm font-medium text-slate-400">Audio mẫu</label>
                                <div className="flex gap-2 mb-4">
                                    <button
                                        onClick={() => setEditAudioSource('keep')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                            editAudioSource === 'keep'
                                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                                        }`}
                                    >
                                        <Check className="w-4 h-4" /> Giữ nguyên
                                    </button>
                                    <button
                                        onClick={() => setEditAudioSource('record')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                            editAudioSource === 'record'
                                                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                                : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                                        }`}
                                    >
                                        <Mic className="w-4 h-4" /> Ghi âm mới
                                    </button>
                                    <button
                                        onClick={() => { setEditAudioSource('file'); loadRefFiles() }}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                            editAudioSource === 'file'
                                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                                : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                                        }`}
                                    >
                                        <FolderOpen className="w-4 h-4" /> Chọn từ ref_audio
                                    </button>
                                </div>

                                {/* Keep current */}
                                {editAudioSource === 'keep' && (() => {
                                    const voice = voices.find(v => v.id === editingId)
                                    return voice ? (
                                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
                                            <FileAudio className="w-4 h-4 text-slate-500" />
                                            <span className="text-sm text-slate-400 truncate">{voice.audio_path?.split('/').pop() || 'Audio hiện tại'}</span>
                                            <button
                                                onClick={() => playVoice(voice)}
                                                className="flex items-center gap-1 px-2 py-1 ml-auto rounded-md bg-white/5 text-slate-400 hover:text-white text-[11px] transition-all"
                                            >
                                                {playingId === voice.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                                {playingId === voice.id ? 'Dừng' : 'Nghe'}
                                            </button>
                                        </div>
                                    ) : null
                                })()}

                                {/* Record new */}
                                {editAudioSource === 'record' && (
                                    <div className="flex items-center gap-6">
                                        <button
                                            onClick={() => editRecording ? stopEditRecording() : startEditRecording()}
                                            className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all shrink-0 ${editRecording
                                                ? 'bg-rose-500 shadow-[0_0_24px_rgba(239,68,68,0.4)] hover:bg-rose-600'
                                                : 'bg-gradient-to-br from-cyan-500 to-blue-600 hover:shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                                            }`}
                                        >
                                            {editRecording ? <div className="w-5 h-5 bg-white rounded-sm" /> : <Mic className="w-6 h-6 text-white" />}
                                            {editRecording && <div className="absolute border-4 rounded-full pointer-events-none -inset-2 border-rose-500/30 animate-ping" />}
                                        </button>
                                        <div className="flex-1 space-y-1">
                                            <p className="font-mono text-xl font-bold text-white">{formatTime(editRecordingTime)}</p>
                                            <p className="text-xs text-slate-400">
                                                {editRecording ? '🎙️ Đang thu âm...' : editRecordedBlob ? '✅ Đã ghi âm xong' : 'Nhấn nút để ghi âm'}
                                            </p>
                                            {editRecording && (
                                                <div className="flex items-center h-6 gap-0.5">
                                                    {[...Array(16)].map((_, i) => (
                                                        <div key={i} className="w-1 rounded-full bg-cyan-500 animate-pulse" style={{ height: `${10 + Math.sin(i * 0.6) * 8}px`, animationDuration: `${0.6 + (i % 4) * 0.15}s`, animationDelay: `${i * 25}ms` }} />
                                                    ))}
                                                </div>
                                            )}
                                            {editRecordedBlob && !editRecording && (
                                                <button
                                                    onClick={() => {
                                                        if (!editRecordedUrl) return
                                                        const audio = new Audio(editRecordedUrl)
                                                        audio.play()
                                                    }}
                                                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white text-xs transition-all"
                                                >
                                                    <Play className="w-3 h-3" /> Nghe thử
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* File picker */}
                                {editAudioSource === 'file' && (
                                    <div className="space-y-3">
                                        {loadingFiles ? (
                                            <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                                                <RefreshCw className="w-4 h-4 animate-spin" /> Đang tải danh sách file...
                                            </div>
                                        ) : refFiles.length === 0 ? (
                                            <div className="py-6 text-center rounded-xl bg-white/[0.02] border border-white/5">
                                                <FileAudio className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                                                <p className="text-sm text-slate-500">Không có file nào trong thư mục ref_audio</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-48 overflow-y-auto pr-1">
                                                {refFiles.map((file, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => setEditSelectedFile(file)}
                                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm transition-all ${
                                                            editSelectedFile?.path === file.path
                                                                ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                                                                : 'bg-white/[0.02] border border-white/5 text-slate-400 hover:text-white hover:border-white/15'
                                                        }`}
                                                    >
                                                        <FileAudio className="w-4 h-4 shrink-0" />
                                                        <span className="truncate">{file.filename}</span>
                                                        {editSelectedFile?.path === file.path && <Check className="w-4 h-4 ml-auto text-amber-400 shrink-0" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {editSelectedFile && (
                                            <div className="flex items-center gap-2 pt-1">
                                                <span className="text-xs text-slate-500">Đã chọn:</span>
                                                <span className="text-xs font-medium text-amber-400">{editSelectedFile.filename}</span>
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const r = await window.electronAPI.tts.readAudio(editSelectedFile.path)
                                                            if (r.success) {
                                                                const blob = new Blob([new Uint8Array(r.data)], { type: r.mimeType })
                                                                const url = URL.createObjectURL(blob)
                                                                const a = new Audio(url)
                                                                a.onended = () => URL.revokeObjectURL(url)
                                                                a.play()
                                                            }
                                                        } catch {}
                                                    }}
                                                    className="flex items-center gap-1 px-2 py-1 ml-2 rounded-md bg-white/5 text-slate-400 hover:text-white text-[11px] transition-all"
                                                >
                                                    <Play className="w-3 h-3" /> Nghe
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Transcript */}
                            <div>
                                <label className="block mb-2 text-sm font-medium text-slate-400">Transcript</label>
                                <div className="flex gap-2">
                                    <textarea
                                        value={editTranscript}
                                        onChange={(e) => setEditTranscript(e.target.value)}
                                        placeholder="Nhập nội dung mà audio mẫu đang đọc..."
                                        rows={3}
                                        className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500/50 transition-colors resize-none"
                                    />
                                    <button
                                        onClick={editAutoTranscribe}
                                        disabled={editTranscribing}
                                        className="self-start flex items-center gap-2 px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 text-sm font-medium transition-all disabled:opacity-50 whitespace-nowrap"
                                    >
                                        {editTranscribing ? (
                                            <><RefreshCw className="w-4 h-4 animate-spin" /> Đang nhận dạng...</>
                                        ) : (
                                            <><Zap className="w-4 h-4" /> Tự động nhận dạng</>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={cancelEdit}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white font-medium text-sm transition-all"
                                >
                                    <X className="w-4 h-4" /> Hủy
                                </button>
                                <button
                                    onClick={saveEdit}
                                    disabled={editSaving || !editName.trim()}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium hover:shadow-[0_0_30px_rgba(245,158,11,0.3)] transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                                >
                                    {editSaving ? (
                                        <><RefreshCw className="w-4 h-4 animate-spin" /> Đang lưu...</>
                                    ) : (
                                        <><Save className="w-4 h-4" /> Lưu thay đổi</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {voices.map(voice => (
                            <div
                                key={voice.id}
                                className={`rounded-2xl bg-white/[0.03] border p-5 transition-all ${editingId === voice.id
                                    ? 'border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                                    : testVoiceId === voice.id
                                        ? 'border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                                        : 'border-white/10 hover:border-white/20'
                                    }`}
                            >
                                {/* View mode */}
                                    <>
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-semibold text-white truncate">{voice.name}</h4>
                                                {voice.transcript && (
                                                    <p className="mt-1 text-xs truncate text-slate-500" title={voice.transcript}>
                                                        📝 {voice.transcript}
                                                    </p>
                                                )}
                                                <p className="mt-1 text-xs text-slate-600">
                                                    {voice.created_at}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {/* Play */}
                                            <button
                                                onClick={() => playVoice(voice)}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${playingId === voice.id
                                                    ? 'bg-cyan-500/20 text-cyan-400'
                                                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                                                    }`}
                                            >
                                                {playingId === voice.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                                {playingId === voice.id ? 'Dừng' : 'Nghe'}
                                            </button>

                                            {/* Select for test */}
                                            <button
                                                onClick={() => setTestVoiceId(testVoiceId === voice.id ? null : voice.id)}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${testVoiceId === voice.id
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                                                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                                                    }`}
                                            >
                                                <TestTube className="w-3 h-3" />
                                                {testVoiceId === voice.id ? 'Đã chọn' : 'Test'}
                                            </button>

                                            {/* Edit */}
                                            <button
                                                onClick={() => startEdit(voice)}
                                                className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white text-xs transition-all"
                                                title="Sửa"
                                            >
                                                <Edit3 className="w-3 h-3" />
                                            </button>

                                            {/* Delete */}
                                            <button
                                                onClick={() => deleteVoice(voice.id)}
                                                className="p-1.5 rounded-lg bg-white/5 text-rose-400/60 hover:text-rose-400 hover:bg-rose-500/10 text-xs transition-all ml-auto"
                                                title="Xóa"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </>
                            </div>
                        ))}
                    </div>
                    </>
                )}
            </div>

            {/* Test Generate Section */}
            {testVoiceId && (
                <div className="rounded-2xl bg-white/[0.03] border border-cyan-500/20 p-6 space-y-4">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                        <Zap className="w-5 h-5 text-amber-400" />
                        Test tạo âm thanh
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium border border-emerald-500/20">
                            {voices.find(v => v.id === testVoiceId)?.name}
                        </span>
                    </h3>

                    <div>
                        <label className="block mb-2 text-sm font-medium text-slate-400">Nhập văn bản cần tạo âm thanh</label>
                        <textarea
                            value={testText}
                            onChange={(e) => setTestText(e.target.value)}
                            rows={3}
                            placeholder="Nhập văn bản tiếng Việt..."
                            className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={testGenerate}
                            disabled={isGenerating || !testText.trim()}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium hover:shadow-[0_0_24px_rgba(245,158,11,0.3)] transition-all disabled:opacity-40"
                        >
                            {isGenerating ? (
                                <><RefreshCw className="w-4 h-4 animate-spin" /> Đang tạo...</>
                            ) : (
                                <><Zap className="w-4 h-4" /> Tạo âm thanh</>
                            )}
                        </button>

                        {generatedAudioPath && (
                            <button
                                onClick={playGenerated}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 font-medium text-sm transition-all"
                            >
                                <Play className="w-4 h-4" /> Nghe kết quả
                            </button>
                        )}
                    </div>

                    {generatedAudioPath && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                            <p className="text-xs text-emerald-400 truncate">Audio đã tạo thành công</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
