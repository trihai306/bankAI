import { useState, useEffect, useCallback } from 'react'
import {
    CheckCircle2, XCircle, Loader2, Download, AlertTriangle,
    Monitor, Cpu, Zap, Music, Brain, Mic, HardDrive, Database,
    ArrowRight, RefreshCw, Bot, Shield, Terminal
} from 'lucide-react'

const DEPS = [
    { key: 'ffmpeg', label: 'FFmpeg', desc: 'Chuyển đổi âm thanh (WebM → WAV)', icon: Music, required: true },
    { key: 'python', label: 'Python 3.11+', desc: 'Runtime cho TTS server', icon: Terminal, required: true },
    { key: 'pythonVenv', label: 'Python Venv', desc: 'Môi trường ảo Python', icon: HardDrive, required: true },
    { key: 'torch', label: 'PyTorch', desc: 'Deep learning framework', icon: Zap, required: false },
    { key: 'vieneuTTS', label: 'VieNeu-TTS', desc: 'Voice synthesis server', icon: Music, required: true },
    { key: 'nodeLlamaCpp', label: 'node-llama-cpp', desc: 'LLM inference engine', icon: Brain, required: true },
    { key: 'nodejsWhisper', label: 'nodejs-whisper', desc: 'Speech-to-text (STT)', icon: Mic, required: true },
    { key: 'sqlite', label: 'better-sqlite3', desc: 'Database engine', icon: Database, required: true },
    { key: 'cuda', label: 'CUDA Toolkit', desc: 'GPU acceleration', icon: Monitor, required: false },
]

function getDepStatus(results, key) {
    if (!results) return 'checking'
    const dep = results[key]
    if (!dep) return 'missing'
    if (key === 'cuda') return dep.available ? 'ready' : 'missing'
    return dep.installed ? 'ready' : 'missing'
}

function StatusIcon({ status, size = 'w-5 h-5' }) {
    switch (status) {
        case 'ready':
            return <CheckCircle2 className={`${size} text-emerald-400`} />
        case 'missing':
            return <XCircle className={`${size} text-red-400`} />
        case 'checking':
            return <Loader2 className={`${size} text-cyan-400 animate-spin`} />
        case 'installing':
            return <Loader2 className={`${size} text-amber-400 animate-spin`} />
        default:
            return <AlertTriangle className={`${size} text-slate-500`} />
    }
}

export default function SystemSetup({ onComplete }) {
    const [results, setResults] = useState(null)
    const [checking, setChecking] = useState(true)
    const [installing, setInstalling] = useState({})
    const [installLogs, setInstallLogs] = useState({})
    const [setupProgress, setSetupProgress] = useState(null)
    const [autoRedirect, setAutoRedirect] = useState(false)

    const runCheck = useCallback(async () => {
        setChecking(true)
        try {
            const data = await window.electronAPI?.setup?.checkAll()
            setResults(data)

            // Auto-redirect if all ready
            if (data?.allReady) {
                setAutoRedirect(true)
                setTimeout(() => onComplete(), 1500)
            }
        } catch (e) {
            console.error('System check failed:', e)
        } finally {
            setChecking(false)
        }
    }, [onComplete])

    useEffect(() => {
        // If not in Electron, skip setup
        if (!window.electronAPI?.setup) {
            onComplete()
            return
        }

        runCheck()

        // Listen for install progress
        window.electronAPI.setup.onProgress((data) => {
            setSetupProgress(data)
        })

        return () => {
            window.electronAPI?.setup?.removeProgressListener()
        }
    }, [runCheck, onComplete])

    const handleInstallFfmpeg = async () => {
        setInstalling(prev => ({ ...prev, ffmpeg: true }))
        try {
            const result = await window.electronAPI.setup.installFfmpeg()
            setInstallLogs(prev => ({ ...prev, ffmpeg: result }))
            if (result.success) await runCheck()
        } catch (e) {
            setInstallLogs(prev => ({ ...prev, ffmpeg: { success: false, error: e.message } }))
        } finally {
            setInstalling(prev => ({ ...prev, ffmpeg: false }))
        }
    }

    const handleInstallPythonEnv = async () => {
        setInstalling(prev => ({ ...prev, pythonEnv: true }))
        setSetupProgress(null)
        try {
            const result = await window.electronAPI.setup.installPythonEnv()
            setInstallLogs(prev => ({ ...prev, pythonEnv: result }))
            if (result.success) await runCheck()
        } catch (e) {
            setInstallLogs(prev => ({ ...prev, pythonEnv: { success: false, error: e.message } }))
        } finally {
            setInstalling(prev => ({ ...prev, pythonEnv: false }))
            setSetupProgress(null)
        }
    }

    const handleInstallNpmDeps = async () => {
        setInstalling(prev => ({ ...prev, npm: true }))
        try {
            const result = await window.electronAPI.setup.installNpmDeps()
            setInstallLogs(prev => ({ ...prev, npm: result }))
            if (result.success) await runCheck()
        } catch (e) {
            setInstallLogs(prev => ({ ...prev, npm: { success: false, error: e.message } }))
        } finally {
            setInstalling(prev => ({ ...prev, npm: false }))
        }
    }

    const readyCount = results ? DEPS.filter(d => getDepStatus(results, d.key) === 'ready').length : 0
    const totalCount = DEPS.length
    const requiredMissing = results ? DEPS.filter(d => d.required && getDepStatus(results, d.key) === 'missing') : []
    const canProceed = results && requiredMissing.length === 0

    // Group missing deps for install actions
    const ffmpegMissing = results && !results.ffmpeg?.installed
    const pythonEnvMissing = results && (!results.pythonVenv?.installed || !results.torch?.installed)
    const npmDepsMissing = results && (!results.nodeLlamaCpp?.installed || !results.nodejsWhisper?.installed || !results.sqlite?.installed)

    return (
        <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center p-4">
            <div className="w-full max-w-2xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-2xl shadow-violet-500/30 mb-6">
                        <Bot className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">AI Voice Bot</h1>
                    <p className="text-slate-400">Kiểm tra hệ thống trước khi bắt đầu</p>
                </div>

                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-slate-400">
                            {checking ? 'Đang kiểm tra...' :
                                autoRedirect ? 'Tất cả sẵn sàng! Đang chuyển hướng...' :
                                    `${readyCount}/${totalCount} thành phần sẵn sàng`}
                        </span>
                        {!checking && (
                            <button
                                onClick={runCheck}
                                className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                            >
                                <RefreshCw className="w-3 h-3" />
                                Kiểm tra lại
                            </button>
                        )}
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-700 ease-out ${canProceed ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-cyan-500 to-blue-500'}`}
                            style={{ width: `${(readyCount / totalCount) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Dependencies Grid */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden mb-6">
                    <div className="p-4 border-b border-white/5">
                        <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-cyan-400" />
                            <h2 className="text-sm font-semibold text-white">Thành phần hệ thống</h2>
                        </div>
                    </div>
                    <div className="divide-y divide-white/5">
                        {DEPS.map(dep => {
                            const status = getDepStatus(results, dep.key)
                            const Icon = dep.icon
                            const extraInfo = results?.[dep.key]

                            return (
                                <div key={dep.key} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                                    <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                                        <Icon className="w-4 h-4 text-slate-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white">{dep.label}</span>
                                            {!dep.required && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-500">
                                                    Tùy chọn
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 truncate">{dep.desc}</p>
                                        {/* Show version info */}
                                        {status === 'ready' && extraInfo?.version && (
                                            <p className="text-[10px] text-slate-600 mt-0.5 truncate">{extraInfo.version}</p>
                                        )}
                                    </div>
                                    <StatusIcon status={checking ? 'checking' : status} />
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Install Actions */}
                {!checking && !canProceed && (
                    <div className="space-y-3 mb-6">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Download className="w-4 h-4 text-amber-400" />
                            Cài đặt thành phần thiếu
                        </h3>

                        {ffmpegMissing && (
                            <button
                                onClick={handleInstallFfmpeg}
                                disabled={installing.ffmpeg}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3">
                                    {installing.ffmpeg ? (
                                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                                    ) : (
                                        <Download className="w-4 h-4 text-cyan-400" />
                                    )}
                                    <div className="text-left">
                                        <span className="text-sm font-medium text-white">Cài FFmpeg</span>
                                        <p className="text-xs text-slate-500">
                                            {process.platform === 'darwin' ? 'via Homebrew' : 'via apt/yum'}
                                        </p>
                                    </div>
                                </div>
                                {installLogs.ffmpeg && !installLogs.ffmpeg.success && (
                                    <span className="text-xs text-red-400 max-w-[200px] truncate">{installLogs.ffmpeg.error}</span>
                                )}
                            </button>
                        )}

                        {pythonEnvMissing && (
                            <button
                                onClick={handleInstallPythonEnv}
                                disabled={installing.pythonEnv}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3">
                                    {installing.pythonEnv ? (
                                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                                    ) : (
                                        <Download className="w-4 h-4 text-cyan-400" />
                                    )}
                                    <div className="text-left">
                                        <span className="text-sm font-medium text-white">Cài Python Environment</span>
                                        <p className="text-xs text-slate-500">Venv + PyTorch + VieNeu-TTS</p>
                                    </div>
                                </div>
                                {installing.pythonEnv && setupProgress && (
                                    <span className="text-xs text-cyan-400">
                                        {setupProgress.message || `${setupProgress.percent || 0}%`}
                                    </span>
                                )}
                                {installLogs.pythonEnv && !installLogs.pythonEnv.success && (
                                    <span className="text-xs text-red-400 max-w-[200px] truncate">{installLogs.pythonEnv.error}</span>
                                )}
                            </button>
                        )}

                        {npmDepsMissing && (
                            <button
                                onClick={handleInstallNpmDeps}
                                disabled={installing.npm}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3">
                                    {installing.npm ? (
                                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                                    ) : (
                                        <Download className="w-4 h-4 text-cyan-400" />
                                    )}
                                    <div className="text-left">
                                        <span className="text-sm font-medium text-white">Cài Node.js Dependencies</span>
                                        <p className="text-xs text-slate-500">node-llama-cpp, nodejs-whisper, better-sqlite3</p>
                                    </div>
                                </div>
                                {installLogs.npm && !installLogs.npm.success && (
                                    <span className="text-xs text-red-400 max-w-[200px] truncate">{installLogs.npm.error}</span>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-3">
                    {!checking && !autoRedirect && (
                        <>
                            <button
                                onClick={onComplete}
                                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all border border-white/10 text-slate-400 hover:text-white hover:border-white/20 hover:bg-white/5"
                            >
                                Bỏ qua
                                <ArrowRight className="w-4 h-4" />
                            </button>
                            {canProceed && (
                                <button
                                    onClick={onComplete}
                                    className="flex-[2] flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-emerald-500/25"
                                >
                                    Bắt đầu sử dụng
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Platform Info */}
                {results?.platform && (
                    <div className="mt-6 text-center">
                        <p className="text-[10px] text-slate-600">
                            {results.platform.system} {results.platform.arch} | Node {results.platform.nodeVersion}
                            {results.cuda?.available && ' | CUDA Available'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
