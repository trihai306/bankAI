import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Phone, Mic, Brain, History, Settings, Bot, Menu, X, Zap, Database, MessageSquare, Activity, AudioLines, Mic2 } from 'lucide-react'
import { useState } from 'react'

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Call Center', href: '/calls', icon: Phone },
    { name: 'Voice Create', href: '/voice-create', icon: AudioLines },
    { name: 'Models', href: '/models', icon: Brain },
    { name: 'Training Data', href: '/training-data', icon: Database },
    { name: 'AI Chat', href: '/chat', icon: MessageSquare },
    { name: 'Voice Chat', href: '/voice-chat', icon: Mic2 },
    { name: 'History', href: '/history', icon: History },
    { name: 'Health Check', href: '/health-check', icon: Activity },
    { name: 'Settings', href: '/settings', icon: Settings },
]

export default function Layout({ children }) {
    const [sidebarOpen, setSidebarOpen] = useState(false)

    return (
        <div className="min-h-screen flex bg-[#0a0a12]">
            {/* Mobile Header */}
            <header className="lg:hidden fixed top-0 left-0 right-0 z-40 h-16 px-4 flex items-center justify-between bg-[#0d0d15]/95 backdrop-blur-xl border-b border-white/5 shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25 animate-float">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <span className="text-base font-bold text-white">AI Voice Bot</span>
                        <span className="block text-2xs text-slate-500">Professional v2.1</span>
                    </div>
                </div>
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white active:scale-95 transition-all duration-200 touch-target"
                >
                    {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
            </header>

            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    className="lg:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar - Pure Tailwind */}
            <aside className={`
                fixed lg:sticky top-0 left-0 z-50 h-screen w-72
                bg-[#0d0d15] border-r border-white/5
                flex flex-col
                transition-transform duration-300 ease-out
                lg:translate-x-0
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                {/* Logo */}
                <div className="h-16 px-6 flex items-center gap-3 border-b border-white/5">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold text-white">AI Voice Bot</h1>
                        <p className="text-xs text-slate-500">Professional v2.0</p>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
                    {navigation.map((item) => (
                        <NavLink
                            key={item.name}
                            to={item.href}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                                ${isActive
                                    ? 'bg-gradient-to-r from-violet-500/20 to-purple-500/10 text-white border border-violet-500/20 shadow-[0_0_24px_-6px_rgba(139,92,246,0.4)]'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <item.icon className={`w-5 h-5 transition-colors ${isActive ? 'text-violet-400' : 'text-slate-500'}`} />
                                    <span>{item.name}</span>
                                    {isActive && (
                                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400" />
                                    )}
                                </>
                            )}
                        </NavLink>
                    ))}
                </nav>

                {/* Bottom Status */}
                <div className="p-4 border-t border-white/5">
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 hover:bg-emerald-500/10 transition-colors cursor-pointer group">
                        <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                            <Zap className="w-4 h-4 text-white" />
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse border-2 border-[#0d0d15]" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-emerald-400 group-hover:text-emerald-300">System Ready</p>
                            <p className="text-xs text-slate-500">All services online</p>
                        </div>
                    </div>
                    <p className="mt-3 text-center text-[11px] text-slate-600">v2.1.0 • Built with Electron</p>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 pt-16 lg:pt-0 min-h-screen relative overflow-hidden">
                {/* Ambient background glow */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-0 left-1/4 w-80 h-80 md:w-96 md:h-96 bg-violet-500/5 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
                    <div className="absolute bottom-0 right-1/4 w-64 h-64 md:w-80 md:h-80 bg-cyan-500/5 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
                </div>

                <div className="p-4 md:p-6 lg:p-10 relative z-10">
                    {children}
                </div>
            </main>
        </div>
    )
}
