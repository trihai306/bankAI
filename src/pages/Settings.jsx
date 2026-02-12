import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, Globe, Bell, Shield, Mic, Brain, Server, Check, AlertCircle } from 'lucide-react'

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
                    className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
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
                {/* General Settings */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
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
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white focus:outline-none focus:border-violet-500/50 transition-colors appearance-none cursor-pointer"
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
                                className={`relative w-12 h-6 rounded-full transition-colors ${settings.autoAnswer ? 'bg-violet-500' : 'bg-white/10'
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
                                className={`relative w-12 h-6 rounded-full transition-colors ${settings.notifications ? 'bg-violet-500' : 'bg-white/10'
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
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white focus:outline-none focus:border-violet-500/50 transition-colors appearance-none cursor-pointer"
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
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white focus:outline-none focus:border-violet-500/50 transition-colors appearance-none cursor-pointer"
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
                                className="w-full px-4 py-3 rounded-xl bg-[#0a0a12] border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-violet-500/50 transition-colors"
                                placeholder="http://localhost:8000"
                            />
                        </div>

                        <button className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 font-medium hover:text-white hover:border-violet-500/30 transition-all">
                            Kiểm tra kết nối
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
