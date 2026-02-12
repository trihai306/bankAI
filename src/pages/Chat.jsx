import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, RefreshCw, AlertCircle, Check, Trash2 } from 'lucide-react'

export default function Chat() {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [modelStatus, setModelStatus] = useState('checking')
    const messagesEndRef = useRef(null)

    useEffect(() => {
        checkModelStatus()
    }, [])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const checkModelStatus = async () => {
        try {
            if (window.electronAPI?.qwen) {
                const result = await window.electronAPI.qwen.getStatus()
                setModelStatus(result.status === 'ready' ? 'ready' : 
                               result.status === 'loading' ? 'checking' : 
                               result.status === 'not_loaded' ? 'ready' : 'offline')
            } else {
                // Fallback: try sending a test to see if model loads
                setModelStatus('ready')
            }
        } catch {
            setModelStatus('offline')
        }
    }

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return

        const userMessage = { role: 'user', content: input }
        setMessages(prev => [...prev, userMessage])
        setInput('')
        setIsLoading(true)

        try {
            const result = await window.electronAPI.qwen.processText(input, 'custom')

            if (result.success) {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: result.text
                }])
            } else {
                throw new Error(result.error)
            }
        } catch (error) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `❌ Lỗi: ${error.message}`,
                isError: true
            }])
        }

        setIsLoading(false)
    }

    const clearChat = () => {
        setMessages([])
    }

    const getStatusBadge = () => {
        switch (modelStatus) {
            case 'ready':
                return (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm">
                        <Check className="w-4 h-4" />
                        <span>Qwen3 4B Ready</span>
                    </div>
                )
            case 'checking':
                return (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-sm">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Checking...</span>
                    </div>
                )
            default:
                return (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        <span>Model Offline</span>
                    </div>
                )
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">AI Chat</h1>
                    <p className="text-slate-400 mt-1">Test Qwen3 4B LLM với Vietnamese prompts</p>
                </div>
                <div className="flex items-center gap-3">
                    {getStatusBadge()}
                    {messages.length > 0 && (
                        <button
                            onClick={clearChat}
                            className="p-2 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all"
                            title="Clear chat"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 && (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
                                <Bot className="w-8 h-8 text-violet-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-2">Bắt đầu trò chuyện</h3>
                            <p className="text-sm text-slate-500">Gửi tin nhắn để test Qwen3 4B</p>
                        </div>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        {msg.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                        )}
                        <div
                            className={`max-w-2xl rounded-2xl p-4 ${msg.role === 'user'
                                    ? 'bg-violet-500 text-white'
                                    : msg.isError
                                        ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                                        : 'bg-white/[0.03] border border-white/10 text-slate-200'
                                }`}
                        >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        {msg.role === 'user' && (
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5 text-white" />
                            </div>
                        )}
                    </div>
                ))}

                {isLoading && (
                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                        </div>
                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
                            <div className="flex gap-1">
                                <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-6 border-t border-white/10">
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Nhập tin nhắn..."
                        disabled={modelStatus !== 'ready' || isLoading}
                        className="flex-1 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 disabled:opacity-50"
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!input.trim() || modelStatus !== 'ready' || isLoading}
                        className="px-6 py-3 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                        <Send className="w-4 h-4" />
                        Gửi
                    </button>
                </div>
            </div>
        </div>
    )
}
