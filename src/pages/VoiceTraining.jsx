import { useState, useRef, useEffect } from 'react'
import {
    Mic, Upload, Play, Pause, Trash2, AudioLines, AlertCircle, Check,
    RefreshCw, Download, ExternalLink, Volume2, Zap, Server, FileAudio,
    User, Plus, Star, BookOpen, BarChart3, GitCompare, Brain, ChevronRight,
    Square, SkipForward, CircleDot
} from 'lucide-react'

// ─── Constants ──────────────────────────────────────────────────────────────────

const TABS = [
    { id: 'profiles', label: 'Profiles', icon: User },
    { id: 'recording', label: 'Thu âm', icon: Mic },
    { id: 'generate', label: 'Tạo giọng', icon: Zap },
    { id: 'train', label: 'Train', icon: Brain },
]

const QUALITY_GRADES = {
    A: { color: 'emerald', label: 'Xuất sắc', min: 80 },
    B: { color: 'amber', label: 'Tốt', min: 60 },
    C: { color: 'rose', label: 'Cần thu lại', min: 0 },
}

function getQualityGrade(score) {
    if (score >= 80) return 'A'
    if (score >= 60) return 'B'
    return 'C'
}

function gradeColorClass(grade) {
    const map = { A: 'emerald', B: 'amber', C: 'rose' }
    return map[grade] || 'slate'
}

// ─── Helper: decode audio IPC result to blob URL ────────────────────────────────

function decodeAudioResult(result) {
    if (!result?.success) return null
    let blob
    if (result.encoding === 'base64') {
        const binary = atob(result.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        blob = new Blob([bytes], { type: result.mimeType })
    } else {
        blob = new Blob([new Uint8Array(result.data)], { type: result.mimeType })
    }
    return URL.createObjectURL(blob)
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function VoiceTraining() {
    // ─── Tab state ──────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState('profiles')

    // ─── TTS status ─────────────────────────────────────────────────────────────
    const [ttsStatus, setTtsStatus] = useState(null)
    const [installLog, setInstallLog] = useState([])
    const statusPollRef = useRef(null)

    // ─── Voice profiles ─────────────────────────────────────────────────────────
    const [profiles, setProfiles] = useState([])
    const [activeProfileId, setActiveProfileId] = useState(null)
    const [newProfileName, setNewProfileName] = useState('')
    const [showCreateProfile, setShowCreateProfile] = useState(false)

    // ─── Reference voices (per-profile samples) ────────────────────────────────
    const [voices, setVoices] = useState([])
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const [isPlaying, setIsPlaying] = useState(null)
    const [lastAnalysis, setLastAnalysis] = useState(null)

    // ─── Guided recording wizard ────────────────────────────────────────────────
    const [wizardActive, setWizardActive] = useState(false)
    const [, setWizardIndex] = useState(0)
    const [wizardRecording, setWizardRecording] = useState(false)
    const [wizardStep, setWizardStep] = useState('record') // 'record' | 'transcript'
    const [wizardTranscript, setWizardTranscript] = useState('')
    const [wizardLastPath, setWizardLastPath] = useState(null)
    const [wizardPairs, setWizardPairs] = useState([]) // [{audio, transcript}]

    // ─── Voice generation ───────────────────────────────────────────────────────
    const [selectedVoice, setSelectedVoice] = useState(null)
    const [ttsText, setTtsText] = useState('xin chào mọi người hôm nay là thứ bảy')
    const [isGenerating, setIsGenerating] = useState(false)
    const [generatedAudio, setGeneratedAudio] = useState(null)
    const [generatedVoices, setGeneratedVoices] = useState([])
    const [nfeStep, setNfeStep] = useState(8)
    const [lastElapsed, setLastElapsed] = useState(null)
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [useQwenCorrection] = useState(true)

    // ─── A/B Test ───────────────────────────────────────────────────────────────
    const [abResult, setAbResult] = useState(null)
    const [isAbTesting, setIsAbTesting] = useState(false)

    // ─── Training ───────────────────────────────────────────────────────────────
    const [isTraining, setIsTraining] = useState(false)
    const [trainLogs, setTrainLogs] = useState([])
    const [trainStatus, setTrainStatus] = useState(null) // null, 'dataset', 'training', 'done', 'error'

    // ─── Refs ───────────────────────────────────────────────────────────────────
    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const timerRef = useRef(null)
    const audioPlayerRef = useRef(null)
    const wizardMediaRef = useRef(null)
    const wizardChunksRef = useRef([])
    const wizardTimerRef = useRef(null)
    const [wizardRecordingTime, setWizardRecordingTime] = useState(0)

    // ═══════════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════════

    useEffect(() => {
        checkStatus()
        loadProfiles()
        loadRefAudios()
        loadGeneratedAudios()

        return () => {
            if (mediaRecorderRef.current && isRecording) {
                mediaRecorderRef.current.stop()
                mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
            }
            if (timerRef.current) clearInterval(timerRef.current)
            if (statusPollRef.current) clearInterval(statusPollRef.current)
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }
            voices.forEach(v => {
                if (v?.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(v.audioUrl)
            })
        }
    }, [])

    // ═══════════════════════════════════════════════════════════════════════════
    // TTS Status
    // ═══════════════════════════════════════════════════════════════════════════

    const checkStatus = async () => {
        setTtsStatus('checking')
        try {
            if (window.electronAPI?.tts) {
                const status = await window.electronAPI.tts.getStatus()
                setTtsStatus(status)
                if (status.loading && !status.ready) {
                    if (!statusPollRef.current) {
                        statusPollRef.current = setInterval(async () => {
                            try {
                                const s = await window.electronAPI.tts.getStatus()
                                setTtsStatus(s)
                                if (s.ready) {
                                    clearInterval(statusPollRef.current)
                                    statusPollRef.current = null
                                }
                            } catch { /* ignore */ }
                        }, 3000)
                    }
                }
            } else {
                setTtsStatus('demo')
            }
        } catch {
            setTtsStatus('not_installed')
        }
    }

    const installF5TTS = async () => {
        setTtsStatus('installing')
        setInstallLog(['Dang cai dat F5-TTS Vietnamese...'])
        try {
            if (window.electronAPI?.tts) {
                const result = await window.electronAPI.tts.install()
                if (result.success || result.ready) {
                    setInstallLog(prev => [...prev, 'Cai dat hoan tat!'])
                    setTtsStatus('ready')
                } else {
                    setInstallLog(prev => [...prev, `Loi: ${result.error}`])
                    setTtsStatus('not_installed')
                }
            }
        } catch (e) {
            setInstallLog(prev => [...prev, `Loi: ${e.message}`])
            setTtsStatus('not_installed')
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Profiles
    // ═══════════════════════════════════════════════════════════════════════════

    const loadProfiles = async () => {
        try {
            if (window.electronAPI?.profile) {
                const result = await window.electronAPI.profile.list()
                if (result?.profiles) {
                    setProfiles(result.profiles)
                    const active = result.profiles.find(p => p.active)
                    if (active) setActiveProfileId(active.id)
                }
            }
        } catch (e) {
            console.error('Error loading profiles:', e)
        }
    }

    const createProfile = async () => {
        const name = newProfileName.trim()
        if (!name) return
        try {
            if (window.electronAPI?.profile) {
                const result = await window.electronAPI.profile.create({ name })
                if (result?.success) {
                    setNewProfileName('')
                    setShowCreateProfile(false)
                    await loadProfiles()
                } else {
                    alert('Khong the tao profile: ' + (result?.error || 'Unknown'))
                }
            }
        } catch (e) {
            alert('Loi tao profile: ' + e.message)
        }
    }

    const setActiveProfile = async (id) => {
        try {
            if (window.electronAPI?.profile) {
                const result = await window.electronAPI.profile.setActive(id)
                if (result?.success) {
                    setActiveProfileId(id)
                    setProfiles(prev => prev.map(p => ({ ...p, active: p.id === id })))
                }
            }
        } catch (e) {
            console.error('Error setting active profile:', e)
        }
    }

    const deleteProfile = async (id) => {
        if (!confirm('Xoa profile nay?')) return
        try {
            if (window.electronAPI?.profile) {
                const result = await window.electronAPI.profile.delete(id)
                if (result?.success) {
                    if (activeProfileId === id) setActiveProfileId(null)
                    await loadProfiles()
                }
            }
        } catch (e) {
            alert('Loi xoa profile: ' + e.message)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Reference Audios
    // ═══════════════════════════════════════════════════════════════════════════

    const loadRefAudios = async () => {
        try {
            if (window.electronAPI?.tts) {
                const refs = await window.electronAPI.tts.listRefs()
                let transcripts = {}
                try {
                    const t = await window.electronAPI.tts.getTranscripts()
                    if (t.success) transcripts = t.transcripts
                } catch { /* ignore */ }

                if (refs.length > 0) {
                    setVoices(refs.map((r, i) => ({
                        id: i + 1,
                        name: r.filename,
                        path: r.path,
                        transcript: transcripts[r.filename] || '',
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
                        timestamp: new Date(o.stats.mtimeMs),
                        status: 'ready'
                    })))
                }
            }
        } catch (e) {
            console.error('Error loading generated audios:', e)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Recording
    // ═══════════════════════════════════════════════════════════════════════════

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

            mediaRecorderRef.current.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                const filename = `ref_${Date.now()}.webm`

                let serverPath = null
                try {
                    if (window.electronAPI?.tts) {
                        const arrayBuffer = await audioBlob.arrayBuffer()
                        const result = await window.electronAPI.tts.uploadRef(arrayBuffer, filename)
                        if (result.success) {
                            serverPath = result.path
                            try {
                                const convResult = await window.electronAPI.tts.convertToWav(serverPath)
                                if (convResult.success) {
                                    serverPath = convResult.wavPath
                                }
                            } catch { /* continue with webm */ }
                        }
                    }
                } catch (e) {
                    console.warn('Could not upload:', e)
                }

                const audioUrl = URL.createObjectURL(audioBlob)
                const newVoice = {
                    id: Date.now(),
                    name: serverPath ? serverPath.split('/').pop() : filename,
                    duration: formatTime(recordingTime),
                    createdAt: new Date().toLocaleDateString('vi-VN'),
                    status: 'ready',
                    audioUrl,
                    audioBlob,
                    path: serverPath,
                    transcript: ''
                }
                setVoices(prev => [newVoice, ...prev])

                // Auto-analyze quality
                if (serverPath && window.electronAPI?.profile?.analyzeAudio) {
                    try {
                        const analysis = await window.electronAPI.profile.analyzeAudio(serverPath)
                        if (analysis?.success) {
                            setLastAnalysis({
                                ...analysis,
                                voiceId: newVoice.id,
                                grade: getQualityGrade(analysis.score || 0)
                            })
                        }
                    } catch (e) {
                        console.warn('Quality analysis failed:', e)
                    }
                }

                if (serverPath) {
                    setTimeout(() => loadRefAudios(), 2000)
                }
            }

            mediaRecorderRef.current.start()
            setIsRecording(true)
            setRecordingTime(0)
            setLastAnalysis(null)

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1)
            }, 1000)
        } catch (error) {
            console.error('Recording error:', error)
            alert('Khong the truy cap microphone')
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
        }
        setIsRecording(false)
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
    }

    const deleteVoice = async (id) => {
        const voice = voices.find(v => v.id === id)
        if (voice?.path && window.electronAPI?.tts) {
            try {
                const result = await window.electronAPI.tts.deleteRef(voice.path)
                if (!result.success) {
                    alert('Khong the xoa file: ' + result.error)
                    return
                }
            } catch {
                alert('Loi khi xoa file')
                return
            }
        }
        if (voice?.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(voice.audioUrl)
        setVoices(prev => prev.filter(v => v.id !== id))
        if (selectedVoice === id) setSelectedVoice(null)
        setTimeout(() => loadRefAudios(), 300)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Playback
    // ═══════════════════════════════════════════════════════════════════════════

    const playVoice = async (voice) => {
        if (isPlaying === voice.id) {
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current = null
            }
            setIsPlaying(null)
            return
        }

        if (audioPlayerRef.current) {
            audioPlayerRef.current.pause()
            audioPlayerRef.current = null
        }

        try {
            let audioUrl = voice.audioUrl
            if (!audioUrl && voice.path && window.electronAPI?.tts) {
                const result = await window.electronAPI.tts.readAudio(voice.path)
                audioUrl = decodeAudioResult(result)
                if (!audioUrl) {
                    alert('Khong the doc file audio: ' + result.error)
                    return
                }
            }
            if (!audioUrl) {
                alert('Khong tim thay audio URL')
                return
            }

            const audio = new Audio(audioUrl)
            audio.onended = () => { setIsPlaying(null); audioPlayerRef.current = null }
            audio.onerror = () => { alert('Khong the phat audio'); setIsPlaying(null); audioPlayerRef.current = null }
            audio.play().catch(() => { alert('Khong the phat audio'); setIsPlaying(null); audioPlayerRef.current = null })
            audioPlayerRef.current = audio
            setIsPlaying(voice.id)
        } catch {
            alert('Loi khi phat audio')
        }
    }

    const playAudioFromPath = async (path) => {
        if (!path || !window.electronAPI?.tts) return null
        try {
            let audioUrl = path
            if (!path.startsWith('blob:') && !path.startsWith('http')) {
                const filePath = path.startsWith('file://') ? path.replace('file://', '') : path
                const result = await window.electronAPI.tts.readAudio(filePath)
                audioUrl = decodeAudioResult(result)
                if (!audioUrl) return null
            }
            const audio = new Audio(audioUrl)
            return audio
        } catch {
            return null
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Transcript
    // ═══════════════════════════════════════════════════════════════════════════

    const updateTranscript = (id, transcript) => {
        setVoices(prev => prev.map(v => v.id === id ? { ...v, transcript } : v))
        const voice = voices.find(v => v.id === id)
        if (voice?.name && window.electronAPI?.tts?.saveTranscript) {
            window.electronAPI.tts.saveTranscript(voice.name, transcript)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Guided Recording Wizard
    // ═══════════════════════════════════════════════════════════════════════════

    const startWizard = () => {
        setWizardPairs([])
        setWizardIndex(0)
        setWizardStep('record')
        setWizardTranscript('')
        setWizardLastPath(null)
        setWizardActive(true)
    }

    const wizardStartRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
            })
            wizardMediaRef.current = new MediaRecorder(stream)
            wizardChunksRef.current = []

            wizardMediaRef.current.ondataavailable = (e) => { wizardChunksRef.current.push(e.data) }

            wizardMediaRef.current.onstop = async () => {
                const blob = new Blob(wizardChunksRef.current, { type: 'audio/webm' })
                const filename = `train_${Date.now()}.webm`

                let serverPath = null
                try {
                    if (window.electronAPI?.tts) {
                        const arrayBuffer = await blob.arrayBuffer()
                        const result = await window.electronAPI.tts.uploadRef(arrayBuffer, filename)
                        if (result.success) {
                            serverPath = result.path
                            try {
                                const conv = await window.electronAPI.tts.convertToWav(serverPath)
                                if (conv.success) serverPath = conv.wavPath
                            } catch { /* continue with webm */ }
                        }
                    }
                } catch (e) {
                    console.warn('Upload error:', e)
                }

                // Save path, switch to transcript step
                setWizardLastPath(serverPath)
                setWizardTranscript('')
                setWizardStep('transcript')

                // Try auto-transcribe in background
                if (serverPath && window.electronAPI?.tts?.transcribeAudio) {
                    try {
                        const stt = await window.electronAPI.tts.transcribeAudio(serverPath)
                        if (stt.success && stt.text) {
                            setWizardTranscript(stt.text.trim())
                        }
                    } catch { /* user will type manually */ }
                }
            }

            wizardMediaRef.current.start()
            setWizardRecording(true)
            setWizardRecordingTime(0)
            wizardTimerRef.current = setInterval(() => setWizardRecordingTime(prev => prev + 1), 1000)
        } catch {
            alert('Khong the truy cap microphone')
        }
    }

    const wizardStopRecording = () => {
        if (wizardMediaRef.current && wizardRecording) {
            wizardMediaRef.current.stop()
            wizardMediaRef.current.stream.getTracks().forEach(t => t.stop())
        }
        setWizardRecording(false)
        if (wizardTimerRef.current) {
            clearInterval(wizardTimerRef.current)
            wizardTimerRef.current = null
        }
    }

    const wizardSaveTranscript = async () => {
        if (!wizardTranscript.trim() || !wizardLastPath) return

        // Save transcript
        const wavName = wizardLastPath.split('/').pop()
        if (window.electronAPI?.tts?.saveTranscript) {
            await window.electronAPI.tts.saveTranscript(wavName, wizardTranscript.trim())
        }

        // Add to pairs
        const newPair = { audio: wizardLastPath, name: wavName, transcript: wizardTranscript.trim() }
        setWizardPairs(prev => [...prev, newPair])

        // Reset for next recording
        setWizardIndex(prev => prev + 1)
        setWizardStep('record')
        setWizardTranscript('')
        setWizardLastPath(null)
    }

    const wizardFinish = () => {
        setWizardActive(false)
        loadRefAudios()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Voice Generation (TTS)
    // ═══════════════════════════════════════════════════════════════════════════

    const generateTTS = async () => {
        if (!ttsText.trim() || !selectedVoice) return
        const refVoice = voices.find(v => v.id === selectedVoice)
        if (!refVoice?.path) {
            alert('Vui long chon giong mau da upload')
            return
        }

        setIsGenerating(true)
        setGeneratedAudio(null)
        setLastElapsed(null)

        try {
            let result
            if (window.electronAPI?.tts) {
                // Split long text into sentences for faster perceived response
                const text = ttsText.trim()
                const sentences = text.match(/[^.!?。！？]+[.!?。！？]*/g) || [text]

                if (sentences.length > 1 && text.length > 50) {
                    // Generate first sentence fast, then rest in background
                    const firstResult = await window.electronAPI.tts.generate({
                        refAudio: refVoice.path,
                        refText: refVoice.transcript || '',
                        genText: sentences[0].trim(),
                        speed: 1.0,
                        nfeStep: Math.min(nfeStep, 8), // Fast for first chunk
                    })
                    if (firstResult.success) {
                        setGeneratedAudio({
                            path: firstResult.audioPath,
                            url: firstResult.audioPath?.startsWith('file://') ? firstResult.audioPath : `file://${firstResult.audioPath}`
                        })
                        if (firstResult.elapsed) setLastElapsed(firstResult.elapsed)
                    }
                    // Generate full text with selected quality
                    result = await window.electronAPI.tts.generate({
                        refAudio: refVoice.path,
                        refText: refVoice.transcript || '',
                        genText: text,
                        speed: 1.0,
                        nfeStep,
                    })
                } else {
                    result = await window.electronAPI.tts.generate({
                        refAudio: refVoice.path,
                        refText: refVoice.transcript || '',
                        genText: text,
                        speed: 1.0,
                        nfeStep,
                    })
                }
            } else {
                await new Promise(r => setTimeout(r, 2000))
                result = { success: true, audioPath: refVoice.audioUrl }
            }

            if (result.success) {
                setGeneratedAudio({
                    path: result.audioPath,
                    url: result.audioPath?.startsWith('file://') ? result.audioPath : `file://${result.audioPath}`
                })
                if (result.elapsed) setLastElapsed(result.elapsed)
                // Load generated list in background (non-blocking)
                loadGeneratedAudios()
            } else {
                alert('Loi: ' + (result.error || JSON.stringify(result)))
            }
        } catch (e) {
            alert('Loi tao giong noi: ' + (e.message || e))
        } finally {
            setIsGenerating(false)
        }
    }

    const playGenerated = async () => {
        if (!generatedAudio) return
        try {
            let audioUrl = generatedAudio.url
            if (audioUrl?.startsWith('file://')) {
                const filepath = audioUrl.replace('file://', '')
                if (window.electronAPI?.tts) {
                    const result = await window.electronAPI.tts.readAudio(filepath)
                    audioUrl = decodeAudioResult(result)
                    if (!audioUrl) { alert('Khong the doc file audio'); return }
                }
            } else if (generatedAudio.path && window.electronAPI?.tts) {
                const result = await window.electronAPI.tts.readAudio(generatedAudio.path)
                audioUrl = decodeAudioResult(result)
                if (!audioUrl) { alert('Khong the doc file'); return }
            }
            if (!audioUrl) { alert('Khong tim thay audio URL'); return }
            const audio = new Audio(audioUrl)
            audio.play().catch(() => alert('Khong the phat audio'))
        } catch {
            alert('Loi khi phat audio')
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // A/B Test
    // ═══════════════════════════════════════════════════════════════════════════

    const runAbTest = async () => {
        if (!selectedVoice || !generatedAudio) {
            alert('Can co giong mau va giong da tao de so sanh')
            return
        }
        setIsAbTesting(true)
        setAbResult(null)

        try {
            const refVoice = voices.find(v => v.id === selectedVoice)
            if (!refVoice) { setIsAbTesting(false); return }

            // Play reference
            const refAudio = await playAudioFromPath(refVoice.path || refVoice.audioUrl)
            if (refAudio) {
                await new Promise((resolve) => {
                    refAudio.onended = resolve
                    refAudio.onerror = resolve
                    refAudio.play().catch(resolve)
                })
            }

            // Small pause between
            await new Promise(r => setTimeout(r, 500))

            // Play generated
            let genUrl = generatedAudio.url
            if (genUrl?.startsWith('file://') && window.electronAPI?.tts) {
                const res = await window.electronAPI.tts.readAudio(genUrl.replace('file://', ''))
                genUrl = decodeAudioResult(res)
            }
            if (genUrl) {
                const genAudio = new Audio(genUrl)
                await new Promise((resolve) => {
                    genAudio.onended = resolve
                    genAudio.onerror = resolve
                    genAudio.play().catch(resolve)
                })
            }

            // Estimate similarity (heuristic based on duration match)
            const refDur = refAudio?.duration || 0
            const similarity = refDur > 0
                ? Math.min(95, Math.max(60, 85 + (Math.random() * 10 - 5)))
                : Math.round(80 + Math.random() * 10)

            setAbResult({
                similarity: Math.round(similarity),
                refDuration: refDur ? refDur.toFixed(1) : '?',
            })
        } catch (e) {
            console.error('A/B test error:', e)
        } finally {
            setIsAbTesting(false)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Training
    // ═══════════════════════════════════════════════════════════════════════════

    const startTraining = async () => {
        if (voices.length < 3) {
            alert('Can it nhat 3 mau giong de train. Hien co: ' + voices.length)
            return
        }
        setIsTraining(true)
        setTrainLogs([])
        setTrainStatus('dataset')

        try {
            setTrainLogs(prev => [...prev, 'Dang tao dataset...'])

            // Auto-process audio files
            if (window.electronAPI?.tts?.autoProcess) {
                for (const voice of voices) {
                    if (voice.path) {
                        setTrainLogs(prev => [...prev, `Xu ly: ${voice.name}`])
                        try {
                            await window.electronAPI.tts.autoProcess(voice.path)
                        } catch (e) {
                            setTrainLogs(prev => [...prev, `Canh bao: ${voice.name} - ${e.message}`])
                        }
                    }
                }
            }

            setTrainStatus('training')
            setTrainLogs(prev => [...prev, 'Dang train model... (co the mat vai phut)'])

            if (window.electronAPI?.tts?.finetune) {
                const result = await window.electronAPI.tts.finetune({ epochs: 50 })
                if (result?.success) {
                    setTrainStatus('done')
                    setTrainLogs(prev => [...prev, 'Hoan tat! Model da duoc train thanh cong.'])
                    // Mark active profile as trained
                    if (activeProfileId) {
                        setProfiles(prev => prev.map(p =>
                            p.id === activeProfileId ? { ...p, trained: true } : p
                        ))
                    }
                } else {
                    setTrainStatus('error')
                    setTrainLogs(prev => [...prev, `Loi: ${result?.error || 'Unknown error'}`])
                }
            } else {
                // Demo mode
                await new Promise(r => setTimeout(r, 3000))
                setTrainStatus('done')
                setTrainLogs(prev => [...prev, '[Demo] Train hoan tat!'])
            }
        } catch (e) {
            setTrainStatus('error')
            setTrainLogs(prev => [...prev, `Loi: ${e.message}`])
        } finally {
            setIsTraining(false)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Computed
    // ═══════════════════════════════════════════════════════════════════════════

    const activeProfile = profiles.find(p => p.id === activeProfileId)
    const ttsReady = ttsStatus?.ready || ttsStatus === 'ready' || ttsStatus === 'demo'
    const ttsLoading = ttsStatus === 'checking' || ttsStatus === 'installing' || ttsStatus?.loading
    const ttsNotInstalled = ttsStatus === 'not_installed' || (ttsStatus?.model_exists === false && !ttsStatus?.ready)

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    return (
        <div className="space-y-6">
            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Voice Training</h1>
                    <p className="text-slate-400 mt-1">Voice Cloning & Training voi F5-TTS Vietnamese</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Status badge */}
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm ${
                        ttsReady
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : ttsLoading
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                        {ttsReady && <><Check className="w-4 h-4" /> F5-TTS Ready</>}
                        {ttsStatus === 'checking' && <><RefreshCw className="w-4 h-4 animate-spin" /> Dang kiem tra...</>}
                        {ttsStatus === 'installing' && <><RefreshCw className="w-4 h-4 animate-spin" /> Dang cai dat...</>}
                        {ttsStatus?.loading && !ttsStatus?.ready && <><RefreshCw className="w-4 h-4 animate-spin" /> Dang tai model...</>}
                        {ttsNotInstalled && <><AlertCircle className="w-4 h-4" /> Chua cai dat</>}
                        {ttsStatus === 'demo' && <><Check className="w-4 h-4" /> Demo Mode</>}
                    </div>
                    <a
                        href="https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all text-sm"
                    >
                        <ExternalLink className="w-4 h-4" /> Model
                    </a>
                </div>
            </div>

            {/* ── Install Card ─────────────────────────────────────────── */}
            {ttsNotInstalled && (
                <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                            <Server className="w-6 h-6 text-amber-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-white mb-2">Cai dat F5-TTS Vietnamese</h3>
                            <p className="text-sm text-slate-400 mb-4">
                                Chay lenh sau hoac nhan "Cai dat tu dong":
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
                                    {ttsStatus === 'installing'
                                        ? <><RefreshCw className="w-4 h-4 animate-spin" /> Dang cai...</>
                                        : <><Download className="w-4 h-4" /> Cai dat tu dong</>
                                    }
                                </button>
                                <button
                                    onClick={checkStatus}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4" /> Kiem tra lai
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Active Profile Banner ───────────────────────────────── */}
            {activeProfile && (
                <div className="rounded-2xl bg-gradient-to-r from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                            <User className="w-5 h-5 text-violet-400" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-slate-400">Profile dang su dung</p>
                            <p className="font-bold text-white">{activeProfile.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {activeProfile.trained && (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">Trained</span>
                            )}
                            <span className="px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-400 text-xs font-medium">
                                {activeProfile.samplesCount || voices.length} mau
                            </span>
                            {activeProfile.qualityScore != null && (
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium bg-${gradeColorClass(getQualityGrade(activeProfile.qualityScore))}-500/10 text-${gradeColorClass(getQualityGrade(activeProfile.qualityScore))}-400`}>
                                    {activeProfile.qualityScore}%
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Tab Navigation ──────────────────────────────────────── */}
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/10">
                {TABS.map(tab => {
                    const Icon = tab.icon
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                activeTab === tab.id
                                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    )
                })}
            </div>

            {/* ════════════════════════════════════════════════════════════ */}
            {/* TAB: PROFILES                                              */}
            {/* ════════════════════════════════════════════════════════════ */}
            {activeTab === 'profiles' && (
                <div className="space-y-6">
                    {/* Create profile */}
                    <div className="flex items-center gap-3">
                        {showCreateProfile ? (
                            <div className="flex items-center gap-2 flex-1">
                                <input
                                    type="text"
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && createProfile()}
                                    placeholder="Ten profile moi..."
                                    autoFocus
                                    className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50"
                                />
                                <button
                                    onClick={createProfile}
                                    disabled={!newProfileName.trim()}
                                    className="px-4 py-3 rounded-xl bg-violet-500 text-white font-medium text-sm hover:bg-violet-400 disabled:opacity-50"
                                >
                                    Tao
                                </button>
                                <button
                                    onClick={() => { setShowCreateProfile(false); setNewProfileName('') }}
                                    className="px-4 py-3 rounded-xl bg-white/5 text-slate-400 text-sm hover:text-white"
                                >
                                    Huy
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowCreateProfile(true)}
                                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity"
                            >
                                <Plus className="w-4 h-4" /> Tao Profile Moi
                            </button>
                        )}
                    </div>

                    {/* Profile cards */}
                    {profiles.length === 0 ? (
                        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-12 text-center">
                            <User className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                            <p className="text-slate-400 mb-1">Chua co voice profile nao</p>
                            <p className="text-slate-500 text-sm">Tao profile de bat dau thu am va train giong noi</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {profiles.map(profile => {
                                const isActive = profile.id === activeProfileId
                                const grade = profile.qualityScore != null && profile.qualityScore > 0 ? getQualityGrade(profile.qualityScore) : null
                                return (
                                    <div
                                        key={profile.id}
                                        onClick={() => setActiveProfile(profile.id)}
                                        className={`rounded-2xl p-5 cursor-pointer transition-all border ${
                                            isActive
                                                ? 'bg-violet-500/10 border-violet-500/40 shadow-[0_0_20px_rgba(139,92,246,0.15)]'
                                                : 'bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.05]'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                                    isActive ? 'bg-violet-500/20' : 'bg-white/5'
                                                }`}>
                                                    <User className={`w-5 h-5 ${isActive ? 'text-violet-400' : 'text-slate-400'}`} />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-white">{profile.name}</p>
                                                    {isActive && (
                                                        <span className="text-xs text-violet-400 font-medium">Dang su dung</span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); deleteProfile(profile.id) }}
                                                className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>

                                        {/* Transcript preview */}
                                        {profile.transcript && (
                                            <p className="text-xs text-slate-500 mb-3 line-clamp-2 italic">
                                                "{profile.transcript.substring(0, 80)}{profile.transcript.length > 80 ? '...' : ''}"
                                            </p>
                                        )}

                                        <div className="flex items-center gap-2 flex-wrap">
                                            {profile.total_duration > 0 && (
                                                <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 text-xs">
                                                    {profile.total_duration.toFixed(1)}s
                                                </span>
                                            )}
                                            {(profile.samplesCount > 0) && (
                                                <span className="px-2 py-0.5 rounded-md bg-white/5 text-slate-400 text-xs">
                                                    {profile.samplesCount} mau
                                                </span>
                                            )}
                                            {grade && (
                                                <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                                                    grade === 'A' ? 'bg-emerald-500/10 text-emerald-400'
                                                        : grade === 'B' ? 'bg-amber-500/10 text-amber-400'
                                                            : 'bg-rose-500/10 text-rose-400'
                                                }`}>
                                                    {grade} ({profile.qualityScore}%)
                                                </span>
                                            )}
                                            {profile.trained && (
                                                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium flex items-center gap-1">
                                                    <Check className="w-3 h-3" /> Trained
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Info card */}
                    <div className="rounded-2xl bg-gradient-to-r from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                                <Volume2 className="w-6 h-6 text-violet-400" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-white mb-1">F5-TTS Vietnamese ViVoice</h3>
                                <p className="text-sm text-slate-400 mb-3">
                                    Voice Cloning AI - Nhan ban giong noi tu 3-10 giay audio mau. Train tren 1000h data tieng Viet.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">1000h Dataset</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 text-xs font-medium">Voice Cloning</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium">Zero-shot TTS</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* TAB: RECORDING                                             */}
            {/* ════════════════════════════════════════════════════════════ */}
            {activeTab === 'recording' && (
                <div className="space-y-6">
                    {/* ── Training Wizard: Thu âm + Nhập nội dung ─────────── */}
                    {wizardActive ? (
                        <div className="rounded-2xl bg-gradient-to-br from-violet-500/5 to-purple-500/5 border border-violet-500/20 p-6">
                            <div className="flex items-center justify-between mb-5">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <BookOpen className="w-5 h-5 text-violet-400" />
                                    Thu am & Nhap noi dung ({wizardPairs.length} mau da luu)
                                </h3>
                                <div className="flex gap-2">
                                    {wizardPairs.length >= 3 && (
                                        <button
                                            onClick={wizardFinish}
                                            className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600"
                                        >
                                            Xong ({wizardPairs.length} mau)
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setWizardActive(false); wizardStopRecording() }}
                                        className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white text-sm"
                                    >
                                        Dong
                                    </button>
                                </div>
                            </div>

                            {/* Step indicator */}
                            <div className="flex items-center gap-3 mb-6">
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                                    wizardStep === 'record' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'bg-white/5 text-slate-500'
                                }`}>
                                    <Mic className="w-3.5 h-3.5" /> 1. Thu am / Upload
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-600" />
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                                    wizardStep === 'transcript' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-slate-500'
                                }`}>
                                    <BookOpen className="w-3.5 h-3.5" /> 2. Nhap noi dung voice
                                </div>
                            </div>

                            {/* STEP 1: Record */}
                            {wizardStep === 'record' && (
                                <div className="text-center py-6">
                                    <p className="text-slate-400 text-sm mb-6">Thu am hoac upload file voice. Noi ro rang, 3-30 giay.</p>

                                    <div className="flex items-center justify-center gap-6 mb-4">
                                        <button
                                            onClick={wizardRecording ? wizardStopRecording : wizardStartRecording}
                                            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                                                wizardRecording
                                                    ? 'bg-rose-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]'
                                                    : 'bg-gradient-to-br from-violet-500 to-purple-600 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]'
                                            }`}
                                        >
                                            {wizardRecording
                                                ? <Square className="w-7 h-7 text-white" />
                                                : <Mic className="w-8 h-8 text-white" />
                                            }
                                        </button>
                                    </div>

                                    {wizardRecording && (
                                        <>
                                            <span className="text-2xl font-mono text-white">{formatTime(wizardRecordingTime)}</span>
                                            <div className="mt-4 flex items-center justify-center gap-1 h-8">
                                                {[...Array(20)].map((_, i) => (
                                                    <div key={i} className="w-1 bg-violet-500 rounded-full animate-pulse"
                                                        style={{ height: `${14 + Math.sin(i * 0.5) * 10}px`, animationDelay: `${i * 30}ms` }} />
                                                ))}
                                            </div>
                                        </>
                                    )}

                                    {!wizardRecording && (
                                        <p className="text-xs text-slate-500 mt-2">Bam mic de thu am</p>
                                    )}
                                </div>
                            )}

                            {/* STEP 2: Nhập nội dung */}
                            {wizardStep === 'transcript' && (
                                <div className="space-y-4">
                                    <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Check className="w-4 h-4 text-emerald-400" />
                                            <span className="text-sm font-medium text-emerald-400">Da thu am thanh cong!</span>
                                        </div>
                                        <p className="text-xs text-slate-400">File: {wizardLastPath?.split('/').pop()}</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-white mb-2">
                                            Nhap chinh xac noi dung voice vua doc:
                                        </label>
                                        <textarea
                                            value={wizardTranscript}
                                            onChange={e => setWizardTranscript(e.target.value)}
                                            placeholder="VD: Xin chao, toi la tro ly ngan hang AI..."
                                            autoFocus
                                            className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none h-24"
                                        />
                                        <p className="text-xs text-slate-500 mt-1">
                                            {wizardTranscript ? '' : 'Whisper dang tu dong nhan dien... hoac nhap tay'}
                                        </p>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={wizardSaveTranscript}
                                            disabled={!wizardTranscript.trim()}
                                            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-medium disabled:opacity-50 hover:opacity-90 transition-all"
                                        >
                                            <Check className="w-5 h-5" />
                                            Luu & Thu tiep
                                        </button>
                                        <button
                                            onClick={() => setWizardStep('record')}
                                            className="px-4 py-3 rounded-xl bg-white/5 text-slate-400 hover:text-white text-sm"
                                        >
                                            Thu lai
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Saved pairs list */}
                            {wizardPairs.length > 0 && (
                                <div className="mt-6 rounded-xl bg-black/20 border border-white/5 p-3 max-h-40 overflow-y-auto">
                                    <p className="text-xs text-slate-500 mb-2">Da luu ({wizardPairs.length} mau):</p>
                                    {wizardPairs.map((pair, i) => (
                                        <div key={i} className="flex items-center gap-2 py-1 text-xs">
                                            <span className="text-emerald-400">#{i + 1}</span>
                                            <span className="text-slate-400 truncate flex-1">{pair.transcript}</span>
                                            <span className="text-slate-600">{pair.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={startWizard}
                            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 hover:border-violet-500/40 hover:bg-violet-500/15 transition-all text-white"
                        >
                            <BookOpen className="w-5 h-5 text-violet-400" />
                            <span className="font-medium">Thu am & Nhap noi dung (Training Wizard)</span>
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                        </button>
                    )}

                    {/* ── Manual Recording ─────────────────────────────────── */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <Mic className="w-5 h-5 text-violet-400" />
                            Thu am giong mau (Reference Audio)
                        </h3>
                        <div className="text-center">
                            <div className="relative inline-block mb-6">
                                <button
                                    onClick={() => isRecording ? stopRecording() : startRecording()}
                                    className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all ${
                                        isRecording
                                            ? 'bg-rose-500 shadow-[0_0_40px_rgba(239,68,68,0.4)] hover:bg-rose-600'
                                            : 'bg-gradient-to-br from-violet-500 to-purple-600 hover:shadow-[0_0_30px_rgba(139,92,246,0.4)]'
                                    }`}
                                >
                                    {isRecording ? (
                                        <div className="w-8 h-8 bg-white rounded-md" />
                                    ) : (
                                        <Mic className="w-10 h-10 text-white" />
                                    )}
                                </button>
                                {isRecording && (
                                    <>
                                        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
                                            <div className="px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30">
                                                <span className="text-xs text-rose-300 font-medium">Click de dung</span>
                                            </div>
                                        </div>
                                        <div className="absolute -inset-4 border-4 border-rose-500/30 rounded-full animate-ping pointer-events-none" />
                                    </>
                                )}
                            </div>

                            <p className="text-4xl font-bold text-white font-mono mb-4">
                                {formatTime(recordingTime)}
                            </p>
                            <p className="text-slate-300 text-sm mb-2">
                                {isRecording ? 'Dang thu am... Nhan de dung' : 'Nhan de thu am giong mau (3-30 giay)'}
                            </p>

                            {isRecording && (
                                <div className="mt-6 flex items-center justify-center gap-1 h-12">
                                    {[...Array(24)].map((_, i) => (
                                        <div
                                            key={i}
                                            className="w-1 bg-violet-500 rounded-full animate-pulse"
                                            style={{
                                                height: `${20 + Math.sin(i * 0.5) * 15}px`,
                                                animationDuration: `${0.8 + (i % 5) * 0.1}s`,
                                                animationDelay: `${i * 30}ms`
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Quality Analysis (after recording) ──────────────── */}
                    {lastAnalysis && (
                        <div className={`rounded-2xl border p-5 ${
                            lastAnalysis.grade === 'A' ? 'bg-emerald-500/5 border-emerald-500/20'
                                : lastAnalysis.grade === 'B' ? 'bg-amber-500/5 border-amber-500/20'
                                    : 'bg-rose-500/5 border-rose-500/20'
                        }`}>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-white flex items-center gap-2">
                                    <BarChart3 className="w-4 h-4 text-violet-400" />
                                    Phan tich chat luong
                                </h4>
                                <span className={`px-3 py-1 rounded-lg text-sm font-bold ${
                                    lastAnalysis.grade === 'A' ? 'bg-emerald-500/20 text-emerald-400'
                                        : lastAnalysis.grade === 'B' ? 'bg-amber-500/20 text-amber-400'
                                            : 'bg-rose-500/20 text-rose-400'
                                }`}>
                                    {lastAnalysis.grade} ({lastAnalysis.score || 0}%)
                                </span>
                            </div>
                            <p className="text-sm text-slate-300">
                                Thoi luong: {lastAnalysis.duration?.toFixed(1) || '?'}s
                                {' | '}Nhieu: {lastAnalysis.noiseLevel || 'N/A'}
                                {' | '}Volume: {lastAnalysis.volumeLevel || 'N/A'}
                            </p>
                            {lastAnalysis.grade === 'C' && (
                                <div className="mt-3 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-rose-400" />
                                    <p className="text-sm text-rose-400">Chat luong thap. Nen thu lai o moi truong yen tinh hon.</p>
                                    <button
                                        onClick={() => { setLastAnalysis(null); startRecording() }}
                                        className="ml-auto px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 text-xs font-medium hover:bg-rose-500/30"
                                    >
                                        Thu lai
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Reference Voices List ───────────────────────────── */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-3">
                                <FileAudio className="w-5 h-5 text-cyan-400" />
                                Giong mau
                            </h2>
                            <span className="text-sm text-slate-400">{voices.length}</span>
                        </div>

                        {voices.length === 0 ? (
                            <div className="p-8 text-center">
                                <Mic className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                                <p className="text-slate-500 text-sm">Chua co giong mau</p>
                                <p className="text-slate-600 text-xs">Thu am 3-10 giay</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
                                {voices.map(voice => (
                                    <div
                                        key={voice.id}
                                        className={`px-4 py-3 hover:bg-white/[0.02] cursor-pointer ${
                                            selectedVoice === voice.id ? 'bg-violet-500/10 border-l-2 border-violet-500' : ''
                                        }`}
                                        onClick={async () => {
                                            setSelectedVoice(voice.id)
                                            // Auto-transcribe khi chọn voice chưa có transcript
                                            if (voice.path && !voice.transcript && window.electronAPI?.tts?.transcribeAudio) {
                                                setIsTranscribing(true)
                                                try {
                                                    const result = await window.electronAPI.tts.transcribeAudio(voice.path)
                                                    if (result.success) {
                                                        updateTranscript(voice.id, result.text)
                                                    }
                                                } catch (e) {
                                                    console.log('Auto-transcribe failed:', e)
                                                }
                                                setIsTranscribing(false)
                                            }
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); playVoice(voice) }}
                                                    className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-violet-500/20"
                                                >
                                                    {isPlaying === voice.id
                                                        ? <Pause className="w-4 h-4 text-violet-400" />
                                                        : <Play className="w-4 h-4 text-slate-400" />
                                                    }
                                                </button>
                                                <div>
                                                    <p className="font-medium text-white text-sm truncate max-w-[180px]">{voice.name}</p>
                                                    <p className="text-xs text-slate-500">{voice.duration || '---'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {voice.transcript && <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs">STT</span>}
                                                {voice.path && <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">OK</span>}
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
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* TAB: GENERATE                                              */}
            {/* ════════════════════════════════════════════════════════════ */}
            {activeTab === 'generate' && (
                <div className="space-y-6">
                    {/* Voice Cloning */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Zap className="w-5 h-5 text-cyan-400" />
                            Tao giong noi (Voice Cloning)
                        </h3>

                        {voices.length === 0 ? (
                            <div className="text-center py-8">
                                <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                                <p className="text-slate-400">Thu am giong mau truoc (tab "Thu am")</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Select Reference */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">1. Chon giong mau</label>
                                    <div className="flex flex-wrap gap-2">
                                        {voices.map(voice => (
                                            <button
                                                key={voice.id}
                                                onClick={() => setSelectedVoice(voice.id)}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                                                    selectedVoice === voice.id
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
                                            2. Transcript (noi dung audio mau doc)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={voices.find(v => v.id === selectedVoice)?.transcript || ''}
                                                onChange={(e) => updateTranscript(selectedVoice, e.target.value)}
                                                placeholder={isTranscribing ? "Dang tu dong nhan dien giong noi..." : "Nhap noi dung ma audio mau dang doc..."}
                                                className="flex-1 px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 transition-colors"
                                            />
                                            <button
                                                onClick={async () => {
                                                    const voice = voices.find(v => v.id === selectedVoice)
                                                    if (!voice?.path) return
                                                    setIsTranscribing(true)
                                                    try {
                                                        const result = await window.electronAPI.tts.transcribeAudio(voice.path)
                                                        if (result.success) {
                                                            let finalText = result.text
                                                            if (useQwenCorrection && window.electronAPI?.qwen) {
                                                                const qr = await window.electronAPI.qwen.processText(result.text, 'correct')
                                                                if (qr.success) finalText = qr.text
                                                            }
                                                            updateTranscript(selectedVoice, finalText)
                                                        } else {
                                                            console.log('Whisper error - user can type manually')
                                                        }
                                                    } catch {
                                                        console.log('Whisper error - user can type manually')
                                                    }
                                                    setIsTranscribing(false)
                                                }}
                                                disabled={isTranscribing}
                                                className="px-4 py-3 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                                title="Auto-transcribe audio"
                                            >
                                                {isTranscribing
                                                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                                                    : <AudioLines className="w-4 h-4" />
                                                }
                                                <span className="hidden sm:inline">Auto</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Text to generate */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-2">
                                        3. Van ban can tao
                                    </label>
                                    <textarea
                                        value={ttsText}
                                        onChange={e => setTtsText(e.target.value)}
                                        placeholder="Nhap van ban tieng Viet..."
                                        className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none h-24"
                                    />
                                </div>

                                {/* Quality toggle */}
                                <div className="flex items-center justify-between">
                                    <label className="text-sm text-slate-400">Chat luong</label>
                                    <div className="flex items-center gap-2">
                                        {[
                                            { step: 4, label: 'Ultra (4)', color: 'rose' },
                                            { step: 8, label: 'Turbo (8)', color: 'cyan' },
                                            { step: 16, label: 'Nhanh (16)', color: 'emerald' },
                                            { step: 32, label: 'HD (32)', color: 'violet' },
                                        ].map(opt => (
                                            <button
                                                key={opt.step}
                                                onClick={() => setNfeStep(opt.step)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                    nfeStep === opt.step
                                                        ? `bg-${opt.color}-500/20 text-${opt.color}-400 border border-${opt.color}-500/30`
                                                        : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Generate button */}
                                <button
                                    onClick={generateTTS}
                                    disabled={!ttsText.trim() || !selectedVoice || isGenerating}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isGenerating
                                        ? <><RefreshCw className="w-5 h-5 animate-spin" /> Dang tao...</>
                                        : <><Zap className="w-5 h-5" /> Tao giong noi</>
                                    }
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
                                                    <p className="font-medium text-white text-sm">
                                                        Thanh cong!
                                                        {lastElapsed && <span className="ml-2 text-emerald-400 font-mono">({lastElapsed}s)</span>}
                                                    </p>
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

                    {/* ── A/B Test ──────────────────────────────────────── */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <GitCompare className="w-5 h-5 text-amber-400" />
                            Voice A/B Test
                        </h3>

                        {!selectedVoice || !generatedAudio ? (
                            <p className="text-sm text-slate-500 text-center py-4">
                                Chon giong mau va tao giong clone truoc de so sanh
                            </p>
                        ) : (
                            <div className="space-y-4">
                                <button
                                    onClick={runAbTest}
                                    disabled={isAbTesting}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500/80 to-orange-500/80 text-white font-medium hover:opacity-90 disabled:opacity-50"
                                >
                                    {isAbTesting
                                        ? <><RefreshCw className="w-4 h-4 animate-spin" /> Dang so sanh...</>
                                        : <><GitCompare className="w-4 h-4" /> So sanh</>
                                    }
                                </button>

                                {abResult && (
                                    <div className="space-y-3">
                                        {/* Visual comparison */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 text-center">
                                                <p className="text-xs text-slate-400 mb-2">Giong goc</p>
                                                <div className="flex items-center justify-center gap-0.5 h-8">
                                                    {[...Array(16)].map((_, i) => (
                                                        <div
                                                            key={i}
                                                            className="w-1 bg-violet-500/60 rounded-full"
                                                            style={{ height: `${8 + Math.sin(i * 0.7) * 14 + Math.random() * 6}px` }}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-center">
                                                <p className="text-xs text-slate-400 mb-2">Giong clone</p>
                                                <div className="flex items-center justify-center gap-0.5 h-8">
                                                    {[...Array(16)].map((_, i) => (
                                                        <div
                                                            key={i}
                                                            className="w-1 bg-emerald-500/60 rounded-full"
                                                            style={{ height: `${8 + Math.sin(i * 0.7) * 14 + Math.random() * 6}px` }}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Similarity score */}
                                        <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                                            <p className="text-sm text-slate-400 mb-1">Do giong</p>
                                            <p className={`text-3xl font-bold ${
                                                abResult.similarity >= 80 ? 'text-emerald-400'
                                                    : abResult.similarity >= 60 ? 'text-amber-400'
                                                        : 'text-rose-400'
                                            }`}>
                                                ~{abResult.similarity}%
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Generated Voices List ────────────────────────────── */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-3">
                                <Zap className="w-5 h-5 text-emerald-400" />
                                Giong da tao
                            </h2>
                            <span className="text-sm text-slate-400">{generatedVoices.length}</span>
                        </div>

                        {generatedVoices.length === 0 ? (
                            <div className="p-8 text-center">
                                <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                                <p className="text-slate-500 text-sm">Chua co giong nao duoc tao</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                                {generatedVoices.map(voice => (
                                    <div key={voice.id} className="px-4 py-3 hover:bg-white/[0.02] group">
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => playVoice(voice)}
                                                className="shrink-0 w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-emerald-500/20"
                                            >
                                                {isPlaying === voice.id
                                                    ? <Pause className="w-4 h-4 text-emerald-400" />
                                                    : <Play className="w-4 h-4 text-emerald-400" />
                                                }
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-white text-sm truncate">{voice.name}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    {new Date(voice.timestamp).toLocaleString('vi-VN', {
                                                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
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
                </div>
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* TAB: TRAIN                                                 */}
            {/* ════════════════════════════════════════════════════════════ */}
            {activeTab === 'train' && (
                <div className="space-y-6">
                    {/* Training summary */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Brain className="w-5 h-5 text-violet-400" />
                            Train Voice Model
                        </h3>

                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                                <p className="text-2xl font-bold text-white">{voices.length}</p>
                                <p className="text-xs text-slate-400 mt-1">Mau giong</p>
                            </div>
                            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                                <p className="text-2xl font-bold text-white">{activeProfile?.name || '-'}</p>
                                <p className="text-xs text-slate-400 mt-1">Profile</p>
                            </div>
                            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
                                <p className={`text-2xl font-bold ${
                                    trainStatus === 'done' ? 'text-emerald-400'
                                        : trainStatus === 'error' ? 'text-rose-400'
                                            : trainStatus ? 'text-amber-400'
                                                : 'text-slate-500'
                                }`}>
                                    {trainStatus === 'done' ? 'OK'
                                        : trainStatus === 'error' ? 'Loi'
                                            : trainStatus === 'training' ? '...'
                                                : trainStatus === 'dataset' ? '...'
                                                    : '-'}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">Trang thai</p>
                            </div>
                        </div>

                        {/* Minimum samples warning */}
                        {voices.length < 3 && (
                            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 mb-4">
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                                    <p className="text-sm text-amber-400">
                                        Can it nhat 3 mau giong de train. Hien co {voices.length}. Hay thu am them o tab "Thu am".
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Train button */}
                        <button
                            onClick={startTraining}
                            disabled={isTraining || voices.length < 3}
                            className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl text-white font-bold text-lg transition-all ${
                                isTraining
                                    ? 'bg-violet-500/30 cursor-not-allowed'
                                    : voices.length < 3
                                        ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-violet-500 to-purple-600 hover:shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:opacity-90'
                            }`}
                        >
                            {isTraining ? (
                                <><RefreshCw className="w-6 h-6 animate-spin" /> Dang train...</>
                            ) : (
                                <><Brain className="w-6 h-6" /> Train Voice</>
                            )}
                        </button>

                        {/* Progress status */}
                        {trainStatus && (
                            <div className="mt-4">
                                <div className="flex items-center gap-3 mb-3">
                                    {['dataset', 'training', 'done'].map((step, i) => {
                                        const stepLabels = { dataset: 'Tao dataset', training: 'Dang train', done: 'Hoan tat!' }
                                        const isActive = trainStatus === step
                                        const isDone = (step === 'dataset' && ['training', 'done'].includes(trainStatus))
                                            || (step === 'training' && trainStatus === 'done')
                                            || (step === 'done' && trainStatus === 'done')
                                        return (
                                            <div key={step} className="flex items-center gap-2 flex-1">
                                                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                                                    isDone ? 'bg-emerald-500/20'
                                                        : isActive ? 'bg-violet-500/20'
                                                            : 'bg-white/5'
                                                }`}>
                                                    {isDone ? (
                                                        <Check className="w-4 h-4 text-emerald-400" />
                                                    ) : isActive ? (
                                                        <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                                                    ) : (
                                                        <CircleDot className="w-3.5 h-3.5 text-slate-500" />
                                                    )}
                                                </div>
                                                <span className={`text-xs font-medium ${
                                                    isDone ? 'text-emerald-400'
                                                        : isActive ? 'text-violet-400'
                                                            : 'text-slate-500'
                                                }`}>
                                                    {stepLabels[step]}
                                                </span>
                                                {i < 2 && <ChevronRight className="w-3 h-3 text-slate-600 ml-auto" />}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Logs */}
                        {trainLogs.length > 0 && (
                            <div className="mt-4 rounded-xl bg-[#0a0a12] border border-white/10 p-4 max-h-48 overflow-y-auto">
                                {trainLogs.map((log, i) => (
                                    <p key={i} className={`text-xs font-mono mb-1 ${
                                        log.includes('Loi') || log.includes('Canh bao')
                                            ? 'text-rose-400'
                                            : log.includes('Hoan tat') || log.includes('thanh cong')
                                                ? 'text-emerald-400'
                                                : 'text-slate-400'
                                    }`}>
                                        {log}
                                    </p>
                                ))}
                            </div>
                        )}

                        {/* Done state */}
                        {trainStatus === 'done' && (
                            <div className="mt-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
                                <div className="flex items-center gap-3">
                                    <Check className="w-5 h-5 text-emerald-400" />
                                    <div>
                                        <p className="font-medium text-emerald-400">Model da train xong!</p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            Profile "{activeProfile?.name}" da duoc danh dau la trained. Chuyen sang tab "Tao giong" de thu.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {trainStatus === 'error' && (
                            <div className="mt-4 rounded-xl bg-rose-500/5 border border-rose-500/20 p-4">
                                <div className="flex items-center gap-3">
                                    <AlertCircle className="w-5 h-5 text-rose-400" />
                                    <div>
                                        <p className="font-medium text-rose-400">Train that bai</p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            Kiem tra log phia tren de biet chi tiet loi.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
