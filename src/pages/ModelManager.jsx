import { useState, useEffect } from 'react'
import { Brain, Cpu, HardDrive, Zap, Download, Trash2, RefreshCw, AlertCircle, Plus, Check } from 'lucide-react'

const defaultModels = [
    {
        id: 'qwen-4b',
        name: 'Qwen 4B',
        type: 'LLM',
        size: '2.3 GB',
        status: 'downloading',
        params: '4B',
        context: '128K',
        description: 'Model AI nhẹ cho xử lý văn bản, sửa lỗi tiếng Việt - Balance tốt giữa tốc độ và accuracy'
    },
    {
        id: 'whisper-medium',
        name: 'Whisper Medium',
        type: 'STT',
        size: '1.5 GB',
        status: 'installed',
        params: '769M',
        context: '-',
        description: 'Model nhận dạng giọng nói tiếng Việt accuracy cao (~93%), balance tốt giữa tốc độ và chất lượng'
    },
    {
        id: 'f5-tts-vi',
        name: 'F5-TTS Vietnamese',
        type: 'TTS',
        size: '1.2 GB',
        status: 'installed',
        params: '1B',
        context: '-',
        description: 'Model text-to-speech tiếng Việt, tạo giọng nói tự nhiên từ văn bản'
    },
]

export default function ModelManager() {
    const [models, setModels] = useState(defaultModels)
    const [isLoading, setIsLoading] = useState(false)
    const [activeTab, setActiveTab] = useState('all')

    const tabs = [
        { id: 'all', label: 'Tất cả' },
        { id: 'LLM', label: 'LLM' },
        { id: 'TTS', label: 'TTS' },
        { id: 'STT', label: 'STT' },
    ]

    const filteredModels = activeTab === 'all' ? models : models.filter(m => m.type === activeTab)
    const installedCount = models.filter(m => m.status === 'installed').length

    const handleInstall = (modelId) => {
        setModels(prev => prev.map(m =>
            m.id === modelId ? { ...m, status: 'downloading' } : m
        ))
        // Simulate download
        setTimeout(() => {
            setModels(prev => prev.map(m =>
                m.id === modelId ? { ...m, status: 'installed' } : m
            ))
        }, 2000)
    }

    const handleUninstall = (modelId) => {
        setModels(prev => prev.map(m =>
            m.id === modelId ? { ...m, status: 'not_installed' } : m
        ))
    }

    const getStatusBadge = (status) => {
        switch (status) {
            case 'installed':
                return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium"><Check className="w-3 h-3" />Đã cài</span>
            case 'downloading':
                return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-400 text-xs font-medium"><RefreshCw className="w-3 h-3 animate-spin" />Đang tải...</span>
            default:
                return <span className="px-2.5 py-1 rounded-lg bg-slate-500/10 text-slate-400 text-xs font-medium">Chưa cài</span>
        }
    }

    const getTypeIcon = (type) => {
        switch (type) {
            case 'LLM': return <Brain className="w-5 h-5" />
            case 'TTS': return <Zap className="w-5 h-5" />
            case 'STT': return <Cpu className="w-5 h-5" />
            default: return <HardDrive className="w-5 h-5" />
        }
    }

    const getTypeColor = (type) => {
        switch (type) {
            case 'LLM': return 'from-violet-500 to-purple-600'
            case 'TTS': return 'from-cyan-500 to-blue-600'
            case 'STT': return 'from-emerald-500 to-green-600'
            default: return 'from-slate-500 to-slate-600'
        }
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Quản lý Model</h1>
                    <p className="text-slate-400 mt-1">Tải và quản lý các model AI cho hệ thống</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                        <span className="text-slate-400 text-sm">Đã cài: </span>
                        <span className="text-white font-semibold">{installedCount}/{models.length}</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 p-1 rounded-xl bg-white/5 w-fit">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px - 4 py - 2 rounded - lg text - sm font - medium transition - all ${activeTab === tab.id
                            ? 'bg-violet-500 text-white'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                            } `}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Models Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredModels.map(model => (
                    <div
                        key={model.id}
                        className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 hover:border-violet-500/30 transition-all group"
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-4">
                                <div className={`w - 12 h - 12 rounded - xl bg - gradient - to - br ${getTypeColor(model.type)} flex items - center justify - center shadow - lg`}>
                                    {getTypeIcon(model.type)}
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-lg">{model.name}</h3>
                                    <p className="text-sm text-slate-400">{model.type} • {model.size}</p>
                                    {model.description && (
                                        <p className="text-xs text-slate-500 mt-1 max-w-xs">{model.description}</p>
                                    )}
                                </div>
                            </div>
                            {getStatusBadge(model.status)}
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-5 py-4 border-y border-white/5">
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Parameters</p>
                                <p className="text-sm font-medium text-white">{model.params}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Context</p>
                                <p className="text-sm font-medium text-white">{model.context} tokens</p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            {model.status === 'not_installed' && (
                                <button
                                    onClick={() => handleInstall(model.id)}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/10 text-violet-400 font-medium hover:bg-violet-500 hover:text-white transition-all"
                                >
                                    <Download className="w-4 h-4" />
                                    Tải về
                                </button>
                            )}
                            {model.status === 'installed' && (
                                <>
                                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 font-medium">
                                        <Check className="w-4 h-4" />
                                        Đang sử dụng
                                    </button>
                                    <button
                                        onClick={() => handleUninstall(model.id)}
                                        className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                            {model.status === 'downloading' && (
                                <button disabled className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/10 text-violet-400 font-medium cursor-not-allowed">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Đang tải...
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Empty State */}
            {filteredModels.length === 0 && (
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">Không có model</h3>
                    <p className="text-sm text-slate-500">Không tìm thấy model nào trong danh mục này.</p>
                </div>
            )}
        </div>
    )
}
