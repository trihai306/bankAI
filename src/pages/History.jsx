import { useState, useEffect } from 'react'
import { Phone, Search, Filter, ChevronDown, Play, Bot, User, Calendar, AlertCircle } from 'lucide-react'

export default function History() {
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedId, setExpandedId] = useState(null)
    const [calls, setCalls] = useState([])
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const loadCalls = async () => {
            setIsLoading(true)
            try {
                if (window.electronAPI?.db) {
                    const data = await window.electronAPI.db.getAllCalls()
                    setCalls(data)
                } else {
                    setCalls([])
                }
            } catch (error) {
                console.error('Failed to load calls:', error)
                setCalls([])
            } finally {
                setIsLoading(false)
            }
        }
        loadCalls()
    }, [])

    const getMessages = (transcript) => {
        try {
            return JSON.parse(transcript) || []
        } catch {
            return []
        }
    }

    const formatDateTime = (isoString) => {
        const date = new Date(isoString)
        return {
            date: date.toLocaleDateString('vi-VN'),
            time: date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
    }

    const filteredCalls = calls.filter(call =>
        call.phone_number?.includes(searchQuery) ||
        call.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">Lịch sử cuộc gọi</h1>
                <p className="text-slate-400 mt-1">Xem lại và nghe lại các cuộc hội thoại đã thực hiện</p>
            </div>

            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Tìm kiếm theo tên hoặc số điện thoại..."
                        className="w-full pl-12 pr-4 py-3 bg-[#0a0a12] border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 transition-all"
                    />
                </div>
                <button className="flex items-center justify-center gap-2 px-4 py-3 bg-[#0a0a12] border border-white/10 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:border-violet-500/30 transition-all">
                    <Filter className="w-4 h-4" />
                    Bộ lọc
                </button>
                <button className="flex items-center justify-center gap-2 px-4 py-3 bg-[#0a0a12] border border-white/10 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:border-violet-500/30 transition-all">
                    <Calendar className="w-4 h-4" />
                    Hôm nay
                </button>
            </div>

            {/* Calls List */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-3" />
                        <p className="text-slate-500">Đang tải dữ liệu...</p>
                    </div>
                ) : filteredCalls.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                            <AlertCircle className="w-8 h-8 text-slate-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">Chưa có lịch sử</h3>
                        <p className="text-sm text-slate-500 max-w-sm mx-auto">
                            {searchQuery ? 'Không tìm thấy kết quả phù hợp.' : 'Lịch sử cuộc gọi sẽ xuất hiện khi bạn thực hiện cuộc gọi đầu tiên.'}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {filteredCalls.map((call) => {
                            const { date, time } = formatDateTime(call.start_time)
                            const messages = getMessages(call.transcript)

                            return (
                                <div key={call.id} className="group hover:bg-white/[0.01] transition-colors">
                                    <div
                                        onClick={() => setExpandedId(expandedId === call.id ? null : call.id)}
                                        className="flex items-center justify-between p-5 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-5 min-w-0">
                                            <div className="shrink-0 w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center ring-1 ring-emerald-500/20">
                                                <Phone className="w-5 h-5 text-emerald-400" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <p className="font-semibold text-white text-base">{call.customer_name || 'Khách hàng'}</p>
                                                    <span className="text-xs text-slate-400 font-mono bg-white/5 px-2 py-0.5 rounded">{call.phone_number}</span>
                                                </div>
                                                <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
                                                    <span>{date} • {time}</span>
                                                    <span>•</span>
                                                    <span>Thời lượng: {call.duration}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0 ml-4">
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${call.status === 'completed'
                                                    ? 'bg-emerald-500/10 text-emerald-400'
                                                    : 'bg-rose-500/10 text-rose-400'
                                                }`}>
                                                {call.status === 'completed' ? 'Hoàn thành' : 'Nhỡ'}
                                            </span>
                                            <button
                                                onClick={(e) => { e.stopPropagation() }}
                                                className="p-2.5 rounded-xl bg-white/5 hover:bg-violet-500 text-slate-400 hover:text-white transition-all"
                                            >
                                                <Play className="w-4 h-4" />
                                            </button>
                                            <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${expandedId === call.id ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>

                                    {/* Expanded Transcript */}
                                    {expandedId === call.id && (
                                        <div className="px-5 pb-6 pt-2 bg-black/20 border-t border-white/5">
                                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">Nội dung hội thoại</h4>
                                            {messages.length > 0 ? (
                                                <div className="space-y-4 pl-4 border-l-2 border-white/5 ml-2">
                                                    {messages.map((msg, idx) => (
                                                        <div key={idx} className={`flex items-start gap-3 ${msg.role === 'ai' ? '' : 'flex-row-reverse'}`}>
                                                            <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${msg.role === 'ai' ? 'bg-violet-500/20' : 'bg-slate-700/50'
                                                                }`}>
                                                                {msg.role === 'ai' ? <Bot className="w-4 h-4 text-violet-400" /> : <User className="w-4 h-4 text-slate-400" />}
                                                            </div>
                                                            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'ai'
                                                                    ? 'bg-violet-500/10 text-slate-200 rounded-tl-none'
                                                                    : 'bg-white/5 text-slate-300 rounded-tr-none'
                                                                }`}>
                                                                {msg.content}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-slate-500 italic px-2">Không có nội dung hội thoại</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
