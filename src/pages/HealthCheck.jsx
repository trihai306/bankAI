import { useState, useEffect, useCallback } from 'react'
import {
    Activity, RefreshCw, Cpu, Zap, Monitor, Brain, Mic, Music,
    CheckCircle2, XCircle, AlertTriangle, Loader2, Download,
    ChevronDown, ChevronUp, HardDrive, Server, MemoryStick, Rocket, Power
} from 'lucide-react'

const GPU_MODES = [
    { value: 'cpu', icon: Cpu, label: 'CPU', desc: 'Ổn định, mọi máy', color: 'cyan' },
    { value: 'cuda', icon: Zap, label: 'CUDA', desc: 'NVIDIA GPU', color: 'emerald' },
    { value: 'auto', icon: RefreshCw, label: 'Auto', desc: 'Tự phát hiện', color: 'amber' },
]

const WHISPER_MODES = [
    { value: 'cpu', icon: Cpu, label: 'CPU', desc: 'Ổn định, mọi máy', color: 'cyan' },
    { value: 'cuda', icon: Zap, label: 'CUDA', desc: 'NVIDIA GPU', color: 'emerald' },
]

const TTS_MODES = [
    { value: 'cuda', icon: Zap, label: 'GPU', desc: 'Nhanh hơn (CUDA)', color: 'emerald' },
    { value: 'cpu', icon: Cpu, label: 'CPU', desc: 'Ổn định, ít VRAM', color: 'cyan' },
]

function StatusDot({ status }) {
    const colors = {
        ready: 'bg-emerald-400 shadow-emerald-400/50',
        error: 'bg-red-400 shadow-red-400/50',
        loading: 'bg-amber-400 shadow-amber-400/50 animate-pulse',
        not_installed: 'bg-slate-500 shadow-slate-500/50',
    }
    return (
        <span className={`inline-block w-2.5 h-2.5 rounded-full shadow-[0_0_8px] ${colors[status] || colors.not_installed}`} />
    )
}

function StatusBadge({ ok, label }) {
    return (
        <div className="flex items-center gap-2 py-0.5">
            {ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span className={`text-sm ${ok ? 'text-slate-300' : 'text-slate-500'}`}>{label}</span>
        </div>
    )
}

function ModeSelector({ currentMode, onModeChange, disabled, modes }) {
    const items = modes || GPU_MODES
    return (
        <div className={`grid grid-cols-${items.length} gap-2`}>
            {items.map(({ value, icon: Icon, label, desc, color }) => (
                <button
                    key={value}
                    onClick={() => onModeChange(value)}
                    disabled={disabled}
                    className={`p-3 rounded-xl border text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                        currentMode === value
                            ? `bg-${color}-500/10 border-${color}-500/30 ring-1 ring-${color}-500/20`
                            : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                    }`}
                >
                    <div className="flex items-center gap-2 mb-0.5">
                        <Icon className={`w-3.5 h-3.5 ${
                            currentMode === value ? `text-${color}-400` : 'text-slate-500'
                        }`} />
                        <span className={`text-xs font-semibold ${
                            currentMode === value ? `text-${color}-400` : 'text-slate-400'
                        }`}>{label}</span>
                    </div>
                    <span className="text-[10px] text-slate-600">{desc}</span>
                </button>
            ))}
        </div>
    )
}

function EngineCard({
    title,
    icon: Icon,
    gradient,
    status,
    statusLabel,
    model,
    mode,
    modeOptions,
    onModeChange,
    onInstall,
    installing,
    details,
    children,
}) {
    const [expanded, setExpanded] = useState(false)
    const statusMap = {
        ready: { label: 'Sẵn sàng', class: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
        error: { label: 'Lỗi', class: 'text-red-400 bg-red-500/10 border-red-500/20' },
        loading: { label: 'Đang tải...', class: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
        not_installed: { label: 'Chưa cài đặt', class: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
    }
    const s = statusMap[status] || statusMap.not_installed

    return (
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden transition-all duration-300 hover:border-white/15">
            {/* Header */}
            <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
                            <Icon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-white">{title}</h3>
                            {model && (
                                <p className="text-xs text-slate-500 mt-0.5">Model: {model}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${s.class}`}>
                            <StatusDot status={status} />
                            {statusLabel || s.label}
                        </span>
                    </div>
                </div>

                {/* Main content */}
                <div className="space-y-4">
                    {/* Mode Selector */}
                    {onModeChange && (
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                                Chế độ chạy
                            </label>
                            <ModeSelector currentMode={mode} onModeChange={onModeChange} disabled={installing} modes={modeOptions} />
                        </div>
                    )}

                    {/* Install button */}
                    {status === 'not_installed' && onInstall && (
                        <button
                            onClick={onInstall}
                            disabled={installing}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {installing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Đang cài đặt...
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4" />
                                    Cài đặt
                                </>
                            )}
                        </button>
                    )}

                    {children}
                </div>
            </div>

            {/* Expandable Details */}
            {details && details.length > 0 && (
                <>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 border-t border-white/5 text-xs text-slate-500 hover:text-slate-300 hover:bg-white/[0.02] transition-all"
                    >
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expanded ? 'Ẩn chi tiết' : 'Xem chi tiết'}
                    </button>
                    {expanded && (
                        <div className="px-5 pb-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                            {details.map((d, i) => (
                                <StatusBadge key={i} ok={d.ok} label={d.label} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

export default function HealthCheck() {
    const [scanning, setScanning] = useState(false)
    const [systemInfo, setSystemInfo] = useState(null)
    const [hwInfo, setHwInfo] = useState(null)
    const [pythonEnv, setPythonEnv] = useState(null)
    const [qwenStatus, setQwenStatus] = useState(null)
    const [ttsStatus, setTtsStatus] = useState(null)
    const [lastScan, setLastScan] = useState(null)

    // GPU modes per engine
    const [llmGpuMode, setLlmGpuMode] = useState('cpu')
    const [whisperGpuMode, setWhisperGpuMode] = useState('cpu')
    const [ttsGpuMode, setTtsGpuMode] = useState('cuda')

    // Action states
    const [rebuildingLlama, setRebuildingLlama] = useState(false)
    const [rebuildingWhisper, setRebuildingWhisper] = useState(false)
    const [resettingLlm, setResettingLlm] = useState(false)

    // Preload status
    const [preloadStatus, setPreloadStatus] = useState(null)
    const [triggeringPreload, setTriggeringPreload] = useState(false)

    const runFullScan = useCallback(async () => {
        setScanning(true)
        try {
            // Run all checks in parallel
            const [hw, py, qwen, tts, platform] = await Promise.allSettled([
                window.electronAPI?.hardware?.getInfo(),
                window.electronAPI?.python?.checkEnv(),
                window.electronAPI?.qwen?.getStatus(),
                window.electronAPI?.tts?.getStatus(),
                window.electronAPI?.python?.getPlatform(),
            ])

            if (hw.status === 'fulfilled' && hw.value) {
                setHwInfo(hw.value)
                setLlmGpuMode(hw.value?.llm?.gpuMode || 'cpu')
                setWhisperGpuMode(hw.value?.whisper?.gpuMode || 'cpu')
                setTtsGpuMode(hw.value?.tts?.gpuMode || 'cuda')
            }
            if (py.status === 'fulfilled') setPythonEnv(py.value)
            if (qwen.status === 'fulfilled') setQwenStatus(qwen.value)
            if (tts.status === 'fulfilled') setTtsStatus(tts.value)
            if (platform.status === 'fulfilled' && platform.value) {
                setSystemInfo(platform.value)
            }

            setLastScan(new Date())
        } catch (e) {
            console.error('Health check scan failed:', e)
        } finally {
            setScanning(false)
        }
    }, [])

    useEffect(() => {
        runFullScan()

        // Load preload status
        const loadPreload = async () => {
            try {
                const status = await window.electronAPI?.preload?.getStatus()
                if (status) setPreloadStatus(status)
            } catch { /* ignore */ }
        }
        loadPreload()

        // Subscribe to live preload status updates
        window.electronAPI?.preload?.onStatusUpdate?.((data) => {
            setPreloadStatus({ ...data })
        })

        return () => {
            window.electronAPI?.preload?.removeStatusUpdate?.()
        }
    }, [runFullScan])

    const handleTriggerPreload = async () => {
        setTriggeringPreload(true)
        try {
            const result = await window.electronAPI?.preload?.trigger()
            if (result) setPreloadStatus(result)
            await runFullScan()
        } catch (e) {
            console.error('Preload trigger failed:', e)
        } finally {
            setTriggeringPreload(false)
        }
    }

    // === Handlers ===

    const handleLlmModeChange = async (mode) => {
        setLlmGpuMode(mode)
        try {
            await window.electronAPI?.hardware?.setGpuMode(mode)
        } catch (e) {
            console.error('Failed to set LLM GPU mode:', e)
        }
    }

    const handleWhisperModeChange = async (mode) => {
        setWhisperGpuMode(mode)
        try {
            await window.electronAPI?.hardware?.setWhisperGpuMode(mode)
        } catch (e) {
            console.error('Failed to set Whisper GPU mode:', e)
        }
    }

    const handleTtsModeChange = async (mode) => {
        setTtsGpuMode(mode)
        try {
            await window.electronAPI?.hardware?.setTtsGpuMode(mode)
        } catch (e) {
            console.error('Failed to set TTS GPU mode:', e)
        }
    }

    const handleRebuildWhisper = async () => {
        setRebuildingWhisper(true)
        try {
            const result = await window.electronAPI?.hardware?.rebuildWhisper(whisperGpuMode)
            if (result?.success) {
                await runFullScan()
            } else {
                console.error('Whisper rebuild failed:', result?.error || result?.output)
            }
        } catch (e) {
            console.error('Whisper rebuild error:', e)
        } finally {
            setRebuildingWhisper(false)
        }
    }

    const handleRebuildLlama = async () => {
        const gpuFlag = llmGpuMode === 'cuda' ? 'cuda' : 'false'
        setRebuildingLlama(true)
        try {
            const result = await window.electronAPI?.hardware?.rebuildLlama(gpuFlag)
            if (result?.success) {
                // Rescan after rebuild
                await runFullScan()
            }
        } catch (e) {
            console.error('Rebuild failed:', e)
        } finally {
            setRebuildingLlama(false)
        }
    }

    const handleResetLlm = async () => {
        setResettingLlm(true)
        try {
            await window.electronAPI?.hardware?.resetLlm()
            await runFullScan()
        } catch (e) {
            console.error('Reset LLM failed:', e)
        } finally {
            setResettingLlm(false)
        }
    }



    // === Derived states ===

    const platformLabel = (() => {
        if (!systemInfo) return 'Đang phát hiện...'
        const labels = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
        const archLabels = { x64: 'x86_64', arm64: 'ARM64', ia32: 'x86' }
        return `${labels[systemInfo.platform] || systemInfo.platform} ${archLabels[systemInfo.arch] || systemInfo.arch}`
    })()

    const overallHealth = (() => {
        const checks = [
            hwInfo?.whisper?.ready,
            hwInfo?.llm?.hasLocalBuild,
            pythonEnv?.ready,
        ]
        const passed = checks.filter(Boolean).length
        if (passed === checks.length) return { label: 'Tất cả hệ thống hoạt động', status: 'healthy', color: 'emerald' }
        if (passed > 0) return { label: `${passed}/${checks.length} hệ thống sẵn sàng`, status: 'partial', color: 'amber' }
        return { label: 'Hệ thống chưa được cấu hình', status: 'unhealthy', color: 'red' }
    })()

    const whisperStatus = hwInfo?.whisper?.ready ? 'ready' : 'not_installed'
    const llmStatus = (() => {
        if (qwenStatus?.status === 'ready') return 'ready'
        if (qwenStatus?.status === 'loading') return 'loading'
        if (qwenStatus?.status === 'error') return 'error'
        if (hwInfo?.llm?.hasLocalBuild) return 'ready'
        return 'not_installed'
    })()
    const f5Status = (() => {
        if (ttsStatus?.ready) return 'ready'
        if (pythonEnv?.f5_tts_installed) return 'ready'
        return 'not_installed'
    })()

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                        <Activity className="w-8 h-8 text-cyan-400" />
                        Health Check
                    </h1>
                    <p className="text-slate-400 mt-1">Kiểm tra và cấu hình các thành phần AI</p>
                </div>
                <div className="flex items-center gap-3">
                    {lastScan && (
                        <span className="text-xs text-slate-600">
                            Lần quét cuối: {lastScan.toLocaleTimeString('vi-VN')}
                        </span>
                    )}
                    <button
                        onClick={runFullScan}
                        disabled={scanning}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        <RefreshCw className={`w-5 h-5 ${scanning ? 'animate-spin' : ''}`} />
                        {scanning ? 'Đang quét...' : 'Quét lại'}
                    </button>
                </div>
            </div>

            {/* Overall Status Bar */}
            <div className={`p-4 rounded-2xl border flex items-center justify-between ${
                overallHealth.color === 'emerald' ? 'bg-emerald-500/5 border-emerald-500/20' :
                overallHealth.color === 'amber' ? 'bg-amber-500/5 border-amber-500/20' :
                'bg-red-500/5 border-red-500/20'
            }`}>
                <div className="flex items-center gap-3">
                    <StatusDot status={overallHealth.status === 'healthy' ? 'ready' : overallHealth.status === 'partial' ? 'loading' : 'error'} />
                    <span className={`font-semibold text-sm ${
                        overallHealth.color === 'emerald' ? 'text-emerald-400' :
                        overallHealth.color === 'amber' ? 'text-amber-400' :
                        'text-red-400'
                    }`}>{overallHealth.label}</span>
                </div>
                {hwInfo?.gpu && (
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5" />
                        {hwInfo.gpu} {hwInfo.cudaAvailable && '• CUDA ✓'}
                    </span>
                )}
            </div>

            {/* System Config */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
                        <Server className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-white">Cấu hình hệ thống</h2>
                        <p className="text-xs text-slate-500">Thông tin phần cứng và phần mềm</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Monitor className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[10px] text-slate-600 uppercase tracking-wider">Platform</span>
                        </div>
                        <p className="text-sm font-medium text-slate-300">{platformLabel}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Zap className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[10px] text-slate-600 uppercase tracking-wider">GPU</span>
                        </div>
                        <p className="text-sm font-medium text-slate-300">{hwInfo?.gpu || 'Không phát hiện'}</p>
                        {hwInfo?.cudaAvailable && (
                            <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                CUDA Available
                            </span>
                        )}
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[10px] text-slate-600 uppercase tracking-wider">Node.js</span>
                        </div>
                        <p className="text-sm font-medium text-slate-300">{systemInfo?.nodeVersion || 'N/A'}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <MemoryStick className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[10px] text-slate-600 uppercase tracking-wider">Python</span>
                        </div>
                        <p className="text-sm font-medium text-slate-300">
                            {pythonEnv?.system_python_version || pythonEnv?.platform?.python_version || 'N/A'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Preload Status Banner */}
            {preloadStatus && (preloadStatus.whisper !== 'idle' || preloadStatus.llm !== 'idle') && (
                <div className={`p-4 rounded-2xl border ${
                    preloadStatus.whisper === 'ready' && preloadStatus.llm === 'ready'
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : preloadStatus.whisper === 'error' || preloadStatus.llm === 'error'
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-cyan-500/5 border-cyan-500/20'
                }`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Rocket className={`w-4 h-4 ${
                                preloadStatus.completedAt ? 'text-emerald-400' : 'text-cyan-400 animate-pulse'
                            }`} />
                            <span className="text-sm font-semibold text-white">
                                {preloadStatus.completedAt ? 'Models đã sẵn sàng' : 'Đang nạp models...'}
                            </span>
                            {preloadStatus.completedAt && preloadStatus.startedAt && (
                                <span className="text-[10px] text-slate-500">
                                    ({((preloadStatus.completedAt - preloadStatus.startedAt) / 1000).toFixed(1)}s)
                                </span>
                            )}
                        </div>
                        {!preloadStatus.completedAt && !triggeringPreload && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                Auto-preload
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className={`flex items-center gap-2 p-2 rounded-xl ${
                            preloadStatus.whisper === 'ready' ? 'bg-emerald-500/10' :
                            preloadStatus.whisper === 'error' ? 'bg-red-500/10' :
                            preloadStatus.whisper === 'loading' ? 'bg-cyan-500/10' : 'bg-white/[0.02]'
                        }`}>
                            <Mic className={`w-3.5 h-3.5 ${
                                preloadStatus.whisper === 'ready' ? 'text-emerald-400' :
                                preloadStatus.whisper === 'error' ? 'text-red-400' :
                                preloadStatus.whisper === 'loading' ? 'text-cyan-400 animate-pulse' : 'text-slate-500'
                            }`} />
                            <div>
                                <span className="text-xs font-medium text-slate-300">Whisper</span>
                                <span className={`block text-[10px] ${
                                    preloadStatus.whisper === 'ready' ? 'text-emerald-400' :
                                    preloadStatus.whisper === 'error' ? 'text-red-400' :
                                    preloadStatus.whisper === 'loading' ? 'text-cyan-400' : 'text-slate-500'
                                }`}>
                                    {preloadStatus.whisper === 'ready' ? 'Sẵn sàng' :
                                     preloadStatus.whisper === 'loading' ? 'Đang tải...' :
                                     preloadStatus.whisper === 'error' ? 'Lỗi' : 'Chờ'}
                                </span>
                            </div>
                        </div>
                        <div className={`flex items-center gap-2 p-2 rounded-xl ${
                            preloadStatus.llm === 'ready' ? 'bg-emerald-500/10' :
                            preloadStatus.llm === 'error' ? 'bg-red-500/10' :
                            preloadStatus.llm === 'loading' ? 'bg-cyan-500/10' : 'bg-white/[0.02]'
                        }`}>
                            <Brain className={`w-3.5 h-3.5 ${
                                preloadStatus.llm === 'ready' ? 'text-emerald-400' :
                                preloadStatus.llm === 'error' ? 'text-red-400' :
                                preloadStatus.llm === 'loading' ? 'text-cyan-400 animate-pulse' : 'text-slate-500'
                            }`} />
                            <div>
                                <span className="text-xs font-medium text-slate-300">LLM (Qwen3)</span>
                                <span className={`block text-[10px] ${
                                    preloadStatus.llm === 'ready' ? 'text-emerald-400' :
                                    preloadStatus.llm === 'error' ? 'text-red-400' :
                                    preloadStatus.llm === 'loading' ? 'text-cyan-400' : 'text-slate-500'
                                }`}>
                                    {preloadStatus.llm === 'ready' ? 'Sẵn sàng' :
                                     preloadStatus.llm === 'loading' ? 'Đang tải...' :
                                     preloadStatus.llm === 'error' ? 'Lỗi' : 'Chờ'}
                                </span>
                            </div>
                        </div>
                    </div>
                    {/* Error details */}
                    {(preloadStatus.whisperError || preloadStatus.llmError) && (
                        <div className="mt-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                            {preloadStatus.whisperError && (
                                <p className="text-[10px] text-red-400">Whisper: {preloadStatus.whisperError}</p>
                            )}
                            {preloadStatus.llmError && (
                                <p className="text-[10px] text-red-400">LLM: {preloadStatus.llmError}</p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Manual Preload Trigger */}
            {(!preloadStatus || preloadStatus.whisper === 'idle' || preloadStatus.llm === 'idle' || preloadStatus.whisper === 'error' || preloadStatus.llm === 'error') && (
                <button
                    onClick={handleTriggerPreload}
                    disabled={triggeringPreload}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-blue-600/10 border border-cyan-500/20 text-cyan-400 font-medium hover:bg-cyan-500/20 transition-all disabled:opacity-50"
                >
                    {triggeringPreload ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Rocket className="w-4 h-4" />
                    )}
                    {triggeringPreload ? 'Đang nạp models...' : 'Nạp sẵn models (Whisper + LLM)'}
                </button>
            )}

            {/* Engine Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Whisper (nodejs-whisper / whisper.cpp) */}
                <EngineCard
                    title="Whisper STT"
                    icon={Mic}
                    gradient="from-sky-500 to-blue-600"
                    status={whisperStatus}
                    model={hwInfo?.whisper?.models?.length ? hwInfo.whisper.models.join(', ') : null}
                    mode={whisperGpuMode}
                    modeOptions={WHISPER_MODES}
                    onModeChange={handleWhisperModeChange}
                    details={[
                        { ok: hwInfo?.whisper?.ready, label: 'whisper-cli binary' },
                        { ok: hwInfo?.whisper?.builtWithCuda, label: 'Built with CUDA' },
                        { ok: hwInfo?.cudaAvailable, label: 'CUDA hardware available' },
                    ]}
                >
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <p className="text-xs text-slate-500 mb-0.5">Engine</p>
                        <p className="text-sm font-medium text-slate-300">
                            {hwInfo?.whisper?.engine || 'whisper.cpp (nodejs-whisper)'}
                        </p>
                    </div>

                    {/* Current build mode indicator */}
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <p className="text-xs text-slate-500 mb-0.5">Build hiện tại</p>
                        <div className="flex items-center gap-2">
                            {hwInfo?.whisper?.builtWithCuda ? (
                                <span className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5" /> CUDA
                                </span>
                            ) : hwInfo?.whisper?.ready ? (
                                <span className="text-sm font-semibold text-cyan-400 flex items-center gap-1.5">
                                    <Cpu className="w-3.5 h-3.5" /> CPU
                                </span>
                            ) : (
                                <span className="text-sm text-slate-500">Chưa build</span>
                            )}
                            {/* Mismatch warning */}
                            {hwInfo?.whisper?.ready && (
                                (whisperGpuMode === 'cuda' && !hwInfo?.whisper?.builtWithCuda) ||
                                (whisperGpuMode === 'cpu' && hwInfo?.whisper?.builtWithCuda)
                            ) && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    Cần rebuild
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Rebuild button */}
                    <button
                        onClick={handleRebuildWhisper}
                        disabled={rebuildingWhisper}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        {rebuildingWhisper ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Download className="w-3.5 h-3.5" />
                        )}
                        {rebuildingWhisper ? 'Building...' : `Rebuild (${whisperGpuMode === 'cuda' ? 'CUDA' : 'CPU'})`}
                    </button>
                    <p className="text-[10px] text-slate-600">
                        ⚠️ Rebuild sẽ xoá build cũ và compile lại whisper.cpp với chế độ đã chọn.
                    </p>
                </EngineCard>

                {/* LLM (node-llama-cpp) */}
                <EngineCard
                    title="LLM Engine"
                    icon={Brain}
                    gradient="from-emerald-500 to-green-600"
                    status={llmStatus}
                    statusLabel={qwenStatus?.status === 'loading' ? 'Đang tải model...' : undefined}
                    model={qwenStatus?.model || 'Qwen3 4B'}
                    mode={llmGpuMode}
                    onModeChange={handleLlmModeChange}
                    details={[
                        { ok: hwInfo?.llm?.hasLocalBuild, label: 'node-llama-cpp binary' },
                        { ok: qwenStatus?.status === 'ready', label: 'Model loaded' },
                        { ok: hwInfo?.cudaAvailable, label: 'CUDA support' },
                    ]}
                >
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <p className="text-xs text-slate-500 mb-0.5">Engine</p>
                        <p className="text-sm font-medium text-slate-300">
                            {qwenStatus?.engine || hwInfo?.llm?.engine || 'node-llama-cpp'}
                        </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={handleRebuildLlama}
                            disabled={rebuildingLlama}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {rebuildingLlama ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Download className="w-3.5 h-3.5" />
                            )}
                            {rebuildingLlama ? 'Building...' : `Rebuild (${llmGpuMode === 'cuda' ? 'CUDA' : 'CPU'})`}
                        </button>
                        <button
                            onClick={handleResetLlm}
                            disabled={resettingLlm}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-xs font-medium hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
                        >
                            {resettingLlm ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            Reset Model
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-600">
                        ⚠️ Rebuild cần thời gian. Đổi mode cần restart model.
                    </p>
                </EngineCard>

                {/* F5-TTS */}
                <EngineCard
                    title="F5-TTS"
                    icon={Music}
                    gradient="from-pink-500 to-rose-600"
                    status={f5Status}
                    model={ttsStatus?.model_exists ? 'F5-TTS Vietnamese' : null}
                    mode={ttsGpuMode}
                    modeOptions={TTS_MODES}
                    onModeChange={handleTtsModeChange}

                    details={[
                        { ok: pythonEnv?.venv_exists, label: 'Python Venv' },
                        { ok: pythonEnv?.torch_installed, label: 'PyTorch' },
                        { ok: pythonEnv?.f5_tts_installed, label: 'F5-TTS package' },
                        { ok: pythonEnv?.f5_tts_cloned, label: 'F5-TTS Repo' },
                        { ok: pythonEnv?.cli_available, label: 'TTS CLI' },
                        { ok: pythonEnv?.requirements_exist, label: 'requirements.txt' },
                    ]}
                >
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <p className="text-xs text-slate-500 mb-0.5">Engine</p>
                        <p className="text-sm font-medium text-slate-300">
                            {ttsStatus?.engine || 'F5-TTS Vietnamese'}
                        </p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <p className="text-xs text-slate-500 mb-0.5">PyTorch Backend</p>
                        <p className="text-sm font-medium text-slate-300">
                            {pythonEnv?.torch_installed ? (
                                ttsGpuMode === 'cuda' && hwInfo?.cudaAvailable ? (
                                    <span className="text-emerald-400 font-semibold">GPU (PyTorch CUDA)</span>
                                ) : (
                                    <span className="text-cyan-400 font-semibold">CPU (PyTorch)</span>
                                )
                            ) : (
                                <span className="text-slate-500">N/A</span>
                            )}
                        </p>
                        {ttsGpuMode === 'cuda' && !hwInfo?.cudaAvailable && (
                            <p className="text-[10px] text-amber-400 mt-0.5">
                                ⚠️ GPU được chọn nhưng không phát hiện CUDA
                            </p>
                        )}
                        {ttsGpuMode === 'cuda' && hwInfo?.cudaAvailable && (
                            <p className="text-[10px] text-slate-600 mt-0.5">
                                Cần đủ VRAM cho model (~5GB)
                            </p>
                        )}
                    </div>
                </EngineCard>
            </div>
        </div>
    )
}
