import { useState, useEffect, useCallback } from 'react'
import { Settings as SettingsIcon, Save, Globe, Bell, Shield, Mic, Brain, Server, Check, AlertCircle, Terminal, Download, RefreshCw, CheckCircle2, XCircle, Loader2, Monitor } from 'lucide-react'

export default function Settings() {
    const [settings, setSettings] = useState({
        language: 'vi-VN',
        autoAnswer: true,
        voiceEngine: 'vits',
        llmModel: 'qwen3-4b',
        notifications: true,
        apiEndpoint: 'http://localhost:8000',
    })
    const [isSaving, setIsSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)

    // Python environment state
    const [pythonEnv, setPythonEnv] = useState(null)
    const [pythonChecking, setPythonChecking] = useState(false)
    const [pythonInstalling, setPythonInstalling] = useState(false)
    const [setupProgress, setSetupProgress] = useState(null)
    const [setupLogs, setSetupLogs] = useState([])
    const [platformInfo, setPlatformInfo] = useState(null)

    useEffect(() => {
        const loadSettings = async () => {
            try {
                if (window.electronAPI?.db) {
                    const data = await window.electronAPI.db.getSettings()
                    if (Object.keys(data).length > 0) {
                        setSettings(prev => ({ ...prev, ...data }))
                    }
                }
            } catch (error) {
                console.error('Failed to load settings:', error)
            }
        }
        loadSettings()
    }, [])

    // Load platform info and check Python env on mount
    useEffect(() => {
        const init = async () => {
            if (window.electronAPI?.python) {
                try {
                    const platform = await window.electronAPI.python.getPlatform()
                    setPlatformInfo(platform)
                } catch (e) {
                    console.error('Failed to get platform:', e)
                }
                checkPythonEnv()
            }
        }
        init()

        // Cleanup progress listener on unmount
        return () => {
            if (window.electronAPI?.python?.removeSetupProgress) {
                window.electronAPI.python.removeSetupProgress()
            }
        }
    }, [])

    const checkPythonEnv = useCallback(async () => {
        if (!window.electronAPI?.python) return
        setPythonChecking(true)
        try {
            const result = await window.electronAPI.python.checkEnv()
            setPythonEnv(result)
        } catch (error) {
            setPythonEnv({ ready: false, error: error.message })
        } finally {
            setPythonChecking(false)
        }
    }, [])

    const handleSetupPython = useCallback(async () => {
        if (!window.electronAPI?.python) return
        setPythonInstalling(true)
        setSetupLogs([])
        setSetupProgress(null)

        // Listen for progress events
        window.electronAPI.python.onSetupProgress((data) => {
            if (data.event === 'progress') {
                setSetupProgress(data)
            } else if (data.event === 'step') {
                setSetupLogs(prev => [...prev, { type: 'info', message: data.message, step: data.step }])
            } else if (data.event === 'error') {
                setSetupLogs(prev => [...prev, { type: 'error', message: data.message, step: data.step }])
            } else if (data.event === 'complete') {
                setSetupLogs(prev => [...prev, {
                    type: data.success ? 'success' : 'error',
                    message: data.message,
                    step: 'complete'
                }])
            }
        })

        try {
            await window.electronAPI.python.setupEnv()
            // Re-check after setup
            await checkPythonEnv()
        } catch (error) {
            setSetupLogs(prev => [...prev, { type: 'error', message: error.message }])
        } finally {
            setPythonInstalling(false)
            window.electronAPI.python.removeSetupProgress()
        }
    }, [checkPythonEnv])

    const handleSave = async () => {
        setIsSaving(true)
        try {
            if (window.electronAPI?.db) {
                for (const [key, value] of Object.entries(settings)) {
                    await window.electronAPI.db.saveSetting(key, value)
                }
            }
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 2000)
        } catch (error) {
            console.error('Failed to save settings:', error)
        } finally {
            setIsSaving(false)
        }
    }

    const updateSetting = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }))
    }

    const getPlatformLabel = () => {
        if (!platformInfo) return 'Detecting...'
        const labels = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
        const archLabels = { x64: 'x86_64', arm64: 'ARM64', ia32: 'x86' }
        return `${labels[platformInfo.platform] || platformInfo.platform} ${archLabels[platformInfo.arch] || platformInfo.arch}`
    }

    const StatusBadge = ({ ok, label }) => (
        <div className="flex items-center gap-2 py-1">
            {ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span className={`text-sm ${ok ? 'text-slate-300' : 'text-slate-500'}`}>{label}</span>
        </div>
    )

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Cài đặt</h1>
                    <p className="text-slate-400 mt-1">Cấu hình hệ thống AI Voice Bot</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    {saveSuccess ? (
                        <>
                            <Check className="w-5 h-5" />
                            Đã lưu!
                        </>
                    ) : isSaving ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Đang lưu...
                        </>
                    ) : (
                        <>
                            <Save className="w-5 h-5" />
                            Lưu thay đổi
                        </>
                    )}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Python Environment - Featured Card */}
                <div className="lg:col-span-2 rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                                <Terminal className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white">Python Environment</h2>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <Monitor className="w-3.5 h-3.5 text-slate-500" />
                                    <span className="text-xs text-slate-500">{getPlatformLabel()}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={checkPythonEnv}
                                disabled={pythonChecking || pythonInstalling}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-sm font-medium hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${pythonChecking ? 'animate-spin' : ''}`} />
                                Kiểm tra
                            </button>
                            {pythonEnv && !pythonEnv.ready && (
                                <button
                                    onClick={handleSetupPython}
                                    disabled={pythonInstalling}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                    {pythonInstalling ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Đang cài đặt...
                                        </>
                                    ) : (
                                        <>
                                            <Download className="w-4 h-4" />
                                            Cài đặt tự động
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Status Overview */}
                    {pythonEnv && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                            <div className={`p-4 rounded-xl border ${pythonEnv.ready ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    {pythonEnv.ready ? (
                                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                    ) : (
                                        <AlertCircle className="w-5 h-5 text-red-400" />
                                    )}
                                    <span className={`font-semibold text-sm ${pythonEnv.ready ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {pythonEnv.ready ? 'Sẵn sàng' : 'Chưa cài đặt'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500">Trạng thái chung</p>
                            </div>

                            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                                <p className="text-sm font-medium text-slate-300 mb-1">
                                    {pythonEnv.system_python_version || pythonEnv?.platform?.python_version || 'N/A'}
                                </p>
                                <p className="text-xs text-slate-500">Python version</p>
                            </div>

                            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                                <StatusBadge ok={pythonEnv.venv_exists} label="Virtual Environment" />
                            </div>

                            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                                <p className="text-sm font-medium text-slate-300 mb-1">
                                    {pythonEnv.installed_count || 0} packages
                                </p>
                                <p className="text-xs text-slate-500">Đã cài đặt</p>
                            </div>
                        </div>
                    )}

                    {/* Detailed Status */}
                    {pythonEnv && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
                            <StatusBadge ok={pythonEnv.venv_exists} label="Venv" />
                            <StatusBadge ok={pythonEnv.torch_installed} label="PyTorch" />
                            <StatusBadge ok={pythonEnv.whisper_installed} label="Whisper (Node.js)" />
                            <StatusBadge ok={pythonEnv.f5_tts_installed} label="F5-TTS" />
                            <StatusBadge ok={pythonEnv.cli_available} label="TTS CLI" />
                            <StatusBadge ok={pythonEnv.f5_tts_cloned} label="F5-TTS Repo" />
                            <StatusBadge ok={pythonEnv.requirements_exist} label="requirements.txt" />
                            <StatusBadge ok={!!pythonEnv.system_python} label="System Python" />
                        </div>
                    )}

                    {/* Error Display */}
                    {pythonEnv?.error && (
                        <div className="mt-4 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                            <p className="text-sm text-red-400">{pythonEnv.error}</p>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {pythonInstalling && setupProgress && (
                        <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-slate-400">
                                    Bước {setupProgress.current}/{setupProgress.total}
                                </span>
                                <span className="text-sm font-medium text-cyan-400">{setupProgress.percent}%</span>
                            </div>
                            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                                    style={{ width: `${setupProgress.percent}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Setup Logs */}
                    {setupLogs.length > 0 && (
                        <div className="mt-4 max-h-48 overflow-y-auto rounded-xl bg-[#0a0a12] border border-white/5 p-4 font-mono text-xs space-y-1">
                            {setupLogs.map((log, i) => (
                                <div key={i} className={`flex items-start gap-2 ${
                                    log.type === 'error' ? 'text-red-400' :
                                    log.type === 'success' ? 'text-emerald-400' :
                                    'text-slate-400'
                                }`}>
                                    <span className="shrink-0">
                                        {log.type === 'error' ? '✗' : log.type === 'success' ? '✓' : '→'}
                                    </span>
                                    <span>{log.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* General Settings */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                            <SettingsIcon className="w-5 h-5 text-white" />
                        </div>
                        <h2 className="text-lg font-bold text-white">Cài đặt chung</h2>
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Ngôn ngữ</label>
                            <select
                                value={settings.language}
                                onChange={(e) => updateSetting('language', e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                            >
                                <option value="vi-VN">Tiếng Việt</option>
                                <option value="en-US">English</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between py-3 border-b border-white/5">
                            <div>
                                <p className="font-medium text-white">Tự động trả lời</p>
                                <p className="text-sm text-slate-500">Tự động nhận cuộc gọi đến</p>
                            </div>
                            <button
                                onClick={() => updateSetting('autoAnswer', !settings.autoAnswer)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${settings.autoAnswer ? 'bg-cyan-500' : 'bg-white/10'
                                    }`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.autoAnswer ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between py-3">
                            <div>
                                <p className="font-medium text-white">Thông báo</p>
                                <p className="text-sm text-slate-500">Nhận thông báo về cuộc gọi</p>
                            </div>
                            <button
                                onClick={() => updateSetting('notifications', !settings.notifications)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${settings.notifications ? 'bg-cyan-500' : 'bg-white/10'
                                    }`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.notifications ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Voice Settings */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                            <Mic className="w-5 h-5 text-white" />
                        </div>
                        <h2 className="text-lg font-bold text-white">Voice Engine</h2>
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Model TTS</label>
                            <select
                                value={settings.voiceEngine}
                                onChange={(e) => updateSetting('voiceEngine', e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                            >
                                <option value="vits">VITS Vietnamese</option>
                                <option value="coqui">Coqui TTS</option>
                                <option value="edge">Edge TTS</option>
                            </select>
                        </div>

                        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                            <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                <Check className="w-4 h-4" />
                                <span className="font-medium text-sm">Trạng thái: Sẵn sàng</span>
                            </div>
                            <p className="text-sm text-slate-400">Model hiện tại đang hoạt động bình thường</p>
                        </div>
                    </div>
                </div>

                {/* LLM Settings */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                            <Brain className="w-5 h-5 text-white" />
                        </div>
                        <h2 className="text-lg font-bold text-white">LLM Engine</h2>
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Model LLM</label>
                            <select
                                value={settings.llmModel}
                                onChange={(e) => updateSetting('llmModel', e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                            >
                                <option value="qwen3-4b">Qwen3 4B</option>
                                <option value="llama-3.2-8b">Llama 3.2 8B</option>
                            </select>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-500/5 border border-white/5">
                            <div className="flex items-center gap-2 text-slate-400 mb-2">
                                <AlertCircle className="w-4 h-4" />
                                <span className="font-medium text-sm">node-llama-cpp Local</span>
                            </div>
                            <p className="text-sm text-slate-500">Chạy model GGUF trực tiếp, không cần Ollama</p>
                        </div>
                    </div>
                </div>

                {/* API Settings */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                            <Server className="w-5 h-5 text-white" />
                        </div>
                        <h2 className="text-lg font-bold text-white">API & Kết nối</h2>
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">API Endpoint</label>
                            <input
                                type="text"
                                value={settings.apiEndpoint}
                                onChange={(e) => updateSetting('apiEndpoint', e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-cyan-500/50 transition-colors"
                                placeholder="http://localhost:8000"
                            />
                        </div>

                        <button className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 font-medium hover:text-white hover:border-cyan-500/30 transition-all">
                            Kiểm tra kết nối
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

