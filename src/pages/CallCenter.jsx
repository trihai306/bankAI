import { useState, useEffect } from 'react'
import { Phone, PhoneCall, PhoneOff, Mic, MicOff, Volume2, VolumeX, User, Clock, AlertCircle } from 'lucide-react'

export default function CallCenter() {
    const [isCallActive, setIsCallActive] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [isSpeakerOn, setIsSpeakerOn] = useState(true)
    const [callDuration, setCallDuration] = useState(0)
    const [phoneNumber, setPhoneNumber] = useState('')
    const [callQueue, setCallQueue] = useState([])

    useEffect(() => {
        let timer
        if (isCallActive) {
            timer = setInterval(() => {
                setCallDuration(prev => prev + 1)
            }, 1000)
        }
        return () => clearInterval(timer)
    }, [isCallActive])

    const formatDuration = (seconds) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    const startCall = () => {
        if (phoneNumber.length >= 10) {
            setIsCallActive(true)
            setCallDuration(0)
        }
    }

    const endCall = () => {
        setIsCallActive(false)
        setCallDuration(0)
    }

    return (
        <div className="space-y-6 md:space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Call Center</h1>
                <p className="text-sm md:text-base text-slate-400 mt-1">Quản lý cuộc gọi và tương tác với khách hàng</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
                {/* Dialer */}
                <div className="lg:col-span-2 space-y-4 md:space-y-6">
                    {/* Phone Input */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 md:p-6 hover:border-violet-500/20 transition-colors duration-300">
                        <label className="block text-xs md:text-sm font-medium text-slate-400 mb-2 md:mb-3">Số điện thoại</label>
                        <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                            <input
                                type="tel"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                placeholder="Nhập số điện thoại..."
                                className="flex-1 px-4 py-3 md:py-3.5 rounded-xl bg-[#0a0a12] border border-white/10 text-white placeholder-slate-500 text-base md:text-lg font-mono focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all touch-target"
                                disabled={isCallActive}
                            />
                            {!isCallActive ? (
                                <button
                                    onClick={startCall}
                                    disabled={phoneNumber.length < 10}
                                    className="px-6 py-3 md:py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-medium flex items-center justify-center gap-2 hover:from-emerald-600 hover:to-green-700 hover:shadow-glow-emerald active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed touch-target"
                                >
                                    <PhoneCall className="w-5 h-5" />
                                    <span className="text-sm md:text-base">Gọi</span>
                                </button>
                            ) : (
                                <button
                                    onClick={endCall}
                                    className="px-6 py-3 md:py-3.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-medium flex items-center justify-center gap-2 hover:from-rose-600 hover:to-red-700 active:scale-95 transition-all duration-200 touch-target"
                                >
                                    <PhoneOff className="w-5 h-5" />
                                    <span className="text-sm md:text-base">Kết thúc</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Active Call Panel */}
                    {isCallActive && (
                        <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-6 md:p-8 animate-scale-in">
                            <div className="text-center mb-6 md:mb-8">
                                <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-4 animate-pulse shadow-glow-violet">
                                    <User className="w-10 h-10 md:w-12 md:h-12 text-white" />
                                </div>
                                <p className="text-xl md:text-2xl font-bold text-white font-mono">{phoneNumber}</p>
                                <div className="flex items-center justify-center gap-2 mt-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-sm md:text-base text-emerald-400 font-medium">Đang kết nối...</span>
                                </div>
                                <p className="text-3xl md:text-4xl font-bold text-white mt-4 font-mono">{formatDuration(callDuration)}</p>
                            </div>

                            <div className="flex justify-center gap-3 md:gap-4">
                                <button
                                    onClick={() => setIsMuted(!isMuted)}
                                    className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center transition-all touch-target active:scale-90 ${isMuted ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                                        }`}
                                >
                                    {isMuted ? <MicOff className="w-6 h-6 md:w-7 md:h-7" /> : <Mic className="w-6 h-6 md:w-7 md:h-7" />}
                                </button>
                                <button
                                    onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                                    className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center transition-all touch-target active:scale-90 ${!isSpeakerOn ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                                        }`}
                                >
                                    {isSpeakerOn ? <Volume2 className="w-6 h-6 md:w-7 md:h-7" /> : <VolumeX className="w-6 h-6 md:w-7 md:h-7" />}
                                </button>
                                <button
                                    onClick={endCall}
                                    className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center hover:from-rose-600 hover:to-red-700 active:scale-90 transition-all touch-target"
                                >
                                    <PhoneOff className="w-6 h-6 md:w-7 md:h-7" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Idle State */}
                    {!isCallActive && (
                        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-12 text-center">
                            <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                                <Phone className="w-10 h-10 text-slate-500" />
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2">Sẵn sàng gọi</h3>
                            <p className="text-slate-400 max-w-md mx-auto">
                                Nhập số điện thoại và nhấn "Gọi" để bắt đầu cuộc gọi với AI Voice Bot
                            </p>
                        </div>
                    )}
                </div>

                {/* Call Queue */}
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/5">
                        <h2 className="text-lg font-bold text-white flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                                <Clock className="w-4 h-4 text-cyan-400" />
                            </div>
                            Hàng đợi
                        </h2>
                    </div>

                    {callQueue.length === 0 ? (
                        <div className="p-8 text-center">
                            <div className="w-12 h-12 rounded-xl bg-slate-800/50 flex items-center justify-center mx-auto mb-3">
                                <AlertCircle className="w-6 h-6 text-slate-500" />
                            </div>
                            <p className="text-slate-500 text-sm">Không có cuộc gọi trong hàng đợi</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {callQueue.map((call, idx) => (
                                <div key={idx} className="px-6 py-4 hover:bg-white/[0.02] transition-colors">
                                    <p className="font-medium text-white">{call.phone}</p>
                                    <p className="text-sm text-slate-400">{call.time}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
