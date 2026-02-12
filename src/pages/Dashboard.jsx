import { useEffect } from 'react'
import { Phone, Clock, TrendingUp, ArrowUp, ArrowDown, Mic, Brain, Cpu, Activity, AlertCircle } from 'lucide-react'
import useStore from '../store/useStore'

export default function Dashboard() {
    const { stats, recentCalls, fetchDashboardData, isLoading } = useStore()

    useEffect(() => {
        fetchDashboardData()
        const interval = setInterval(fetchDashboardData, 30000)
        return () => clearInterval(interval)
    }, [fetchDashboardData])

    const formatTime = (isoString) => {
        if (!isoString) return ''
        const date = new Date(isoString)
        return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    }

    const hasData = stats.totalCalls > 0

    const statCards = [
        { label: 'Cuộc gọi hôm nay', value: stats.todayCalls, change: hasData ? '+0%' : '-', trend: 'up', icon: Phone, gradient: 'from-violet-500 to-purple-600' },
        { label: 'Tổng cuộc gọi', value: stats.totalCalls, change: hasData ? '+0%' : '-', trend: 'up', icon: Activity, gradient: 'from-cyan-500 to-blue-600' },
        { label: 'Thời gian TB', value: stats.avgDuration || '0:00', change: hasData ? '-' : '-', trend: 'down', icon: Clock, gradient: 'from-emerald-500 to-green-600' },
        { label: 'Tỷ lệ thành công', value: `${stats.successRate || 0}%`, change: hasData ? '+0%' : '-', trend: 'up', icon: TrendingUp, gradient: 'from-amber-500 to-orange-600' },
    ]

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
                    <p className="text-slate-400 mt-1">Tổng quan hoạt động hệ thống AI Voice Bot</p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-sm font-medium text-emerald-400">System Online</span>
                </div>
            </div>

            {/* Stats Grid - Staggered Animation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 stagger-children">
                {statCards.map((stat, index) => (
                    <div
                        key={stat.label}
                        className="relative overflow-hidden rounded-2xl bg-white/[0.03] border border-white/10 p-5 md:p-6 
                                   hover:bg-white/[0.06] hover:border-violet-500/30 hover:shadow-glow
                                   transition-all duration-300 group cursor-pointer card-interactive"
                        style={{ animationDelay: `${index * 100}ms` }}
                    >
                        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${stat.gradient}`} />
                        <stat.icon className="absolute top-4 right-4 w-12 h-12 md:w-16 md:h-16 text-white/[0.03] group-hover:text-white/[0.08] transition-all duration-300" />

                        <div className="relative z-10">
                            <div className={`w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3 md:mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                <stat.icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                            <p className="text-2xl md:text-3xl font-bold text-white mb-1">{stat.value}</p>
                            <p className="text-xs md:text-sm text-slate-400 mb-2 md:mb-3">{stat.label}</p>
                            {hasData && stat.change !== '-' && (
                                <div className={`inline-flex items-center gap-1 text-xs md:text-sm font-medium px-2 py-0.5 rounded-full ${stat.trend === 'up'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-rose-500/10 text-rose-400'
                                    }`}>
                                    {stat.trend === 'up' ? <ArrowUp className="w-3 h-3 md:w-3.5 md:h-3.5" /> : <ArrowDown className="w-3 h-3 md:w-3.5 md:h-3.5" />}
                                    {stat.change}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">
                {/* Recent Calls */}
                <div className="xl:col-span-2 rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden hover:border-white/20 transition-colors duration-300">
                    <div className="px-4 md:px-6 py-4 md:py-5 border-b border-white/5 flex items-center justify-between">
                        <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                            <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                                <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-violet-400" />
                            </div>
                            Cuộc gọi gần đây
                        </h2>
                        {hasData && (
                            <button className="text-xs md:text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors">Xem tất cả</button>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="p-12 text-center text-slate-500">
                            <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-3" />
                            Đang tải dữ liệu...
                        </div>
                    ) : !hasData ? (
                        <div className="p-8 md:p-12 text-center">
                            <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 flex items-center justify-center mx-auto mb-4 animate-pulse">
                                <AlertCircle className="w-7 h-7 md:w-8 md:h-8 text-slate-500" />
                            </div>
                            <h3 className="text-base md:text-lg font-semibold text-white mb-2">Chưa có dữ liệu</h3>
                            <p className="text-xs md:text-sm text-slate-500 max-w-sm mx-auto">
                                Hệ thống chưa ghi nhận cuộc gọi nào. Dữ liệu sẽ xuất hiện khi có cuộc gọi được thực hiện.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[600px]">
                                <thead>
                                    <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-white/5">
                                        <th className="px-4 md:px-6 py-3 md:py-4">Số điện thoại</th>
                                        <th className="px-4 md:px-6 py-3 md:py-4">Khách hàng</th>
                                        <th className="px-4 md:px-6 py-3 md:py-4">Thời gian</th>
                                        <th className="px-4 md:px-6 py-3 md:py-4">Thời lượng</th>
                                        <th className="px-4 md:px-6 py-3 md:py-4 text-right">Trạng thái</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {recentCalls.map((call, idx) => (
                                        <tr key={idx} className="hover:bg-white/[0.02] transition-colors group">
                                            <td className="px-4 md:px-6 py-3 md:py-4">
                                                <span className="font-medium text-white text-sm md:text-base group-hover:text-violet-400 transition-colors">{call.phone_number || call.phone}</span>
                                            </td>
                                            <td className="px-4 md:px-6 py-3 md:py-4 text-slate-300 text-sm">{call.customer_name || 'Khách vãng lai'}</td>
                                            <td className="px-4 md:px-6 py-3 md:py-4 text-slate-400 text-xs md:text-sm">{formatTime(call.start_time)}</td>
                                            <td className="px-4 md:px-6 py-3 md:py-4 text-slate-400 font-mono text-xs md:text-sm">{call.duration}</td>
                                            <td className="px-4 md:px-6 py-3 md:py-4 text-right">
                                                <span className={`inline-flex px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg text-2xs md:text-xs font-medium ${call.status === 'completed'
                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                                    }`}>
                                                    {call.status === 'completed' ? 'Hoàn thành' : 'Nhỡ'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Right Panel - System Status */}
                <div className="space-y-4 md:space-y-6">
                    {/* Voice Engine */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 md:p-6 relative overflow-hidden hover:border-violet-500/20 transition-all duration-300 group">
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl group-hover:bg-cyan-500/20 transition-all duration-500" />
                        <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-5 relative">
                            <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg animate-float">
                                <Mic className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-sm md:text-base">Voice Engine</h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-xs text-emerald-400 font-medium">Sẵn sàng</span>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2 md:space-y-3 relative">
                            <div className="flex justify-between py-2 border-b border-white/5">
                                <span className="text-xs md:text-sm text-slate-400">Model</span>
                                <span className="text-xs md:text-sm font-medium text-white">VITS Vietnamese</span>
                            </div>
                            <div className="flex justify-between py-2 border-b border-white/5">
                                <span className="text-xs md:text-sm text-slate-400">Latency</span>
                                <span className="text-xs md:text-sm font-medium text-white">~120ms</span>
                            </div>
                            <div className="flex justify-between py-2">
                                <span className="text-xs md:text-sm text-slate-400">Status</span>
                                <span className="text-xs md:text-sm text-emerald-400">Ready</span>
                            </div>
                        </div>
                    </div>

                    {/* LLM Engine */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 md:p-6 relative overflow-hidden hover:border-violet-500/20 transition-all duration-300 group">
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl group-hover:bg-violet-500/20 transition-all duration-500" />
                        <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-5 relative">
                            <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg animate-float" style={{ animationDelay: '0.5s' }}>
                                <Brain className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-sm md:text-base">LLM Engine</h3>
                                <p className="text-xs text-slate-400 mt-0.5">node-llama-cpp</p>
                            </div>
                        </div>
                        <div className="space-y-2 md:space-y-3 relative">
                            <div className="flex justify-between py-2 border-b border-white/5">
                                <span className="text-xs md:text-sm text-slate-400">Model</span>
                                <span className="text-xs md:text-sm font-medium text-white">Qwen3 4B</span>
                            </div>
                            <div className="flex justify-between py-2 border-b border-white/5">
                                <span className="text-xs md:text-sm text-slate-400">Context</span>
                                <span className="text-xs md:text-sm font-medium text-white">8192 tokens</span>
                            </div>
                            <div className="flex justify-between py-2">
                                <span className="text-xs md:text-sm text-slate-400">Status</span>
                                <span className="text-xs md:text-sm text-emerald-400">Ready</span>
                            </div>
                        </div>
                    </div>

                    {/* System Resources */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 md:p-6 hover:border-emerald-500/20 transition-all duration-300">
                        <div className="flex items-center gap-3 mb-4 md:mb-5">
                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                                <Cpu className="w-4 h-4 md:w-5 md:h-5 text-white" />
                            </div>
                            <h3 className="font-bold text-white text-sm md:text-base">Tài nguyên</h3>
                        </div>
                        <div className="space-y-4 md:space-y-5">
                            <div>
                                <div className="flex justify-between text-xs md:text-sm mb-2">
                                    <span className="text-slate-400">CPU</span>
                                    <span className="text-white font-mono">--%</span>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full w-0 bg-gradient-to-r from-violet-500 to-purple-600 rounded-full transition-all duration-500" />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs md:text-sm mb-2">
                                    <span className="text-slate-400">RAM</span>
                                    <span className="text-white font-mono">--%</span>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full w-0 bg-gradient-to-r from-emerald-500 to-green-600 rounded-full transition-all duration-500" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
