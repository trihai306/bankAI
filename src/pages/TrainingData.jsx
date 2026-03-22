import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Upload, File, Trash2, Eye, Database, FileText, Plus, Play, Send,
    RefreshCw, CheckCircle, AlertCircle, Loader2, X, ChevronDown,
    Zap, Brain, MessageSquare, FolderOpen
} from 'lucide-react'

export default function TrainingData() {
    // Files & data
    const [files, setFiles] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedFile, setSelectedFile] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    // Upload
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef(null)

    // Quick Add QA
    const [qaQuestion, setQaQuestion] = useState('')
    const [qaAnswer, setQaAnswer] = useState('')
    const [qaAdding, setQaAdding] = useState(false)
    const [qaTarget, setQaTarget] = useState('banking_qa_vietnamese.jsonl')

    // Training
    const [training, setTraining] = useState(false)
    const [trainLogs, setTrainLogs] = useState([])
    const [trainStatus, setTrainStatus] = useState(null) // null | 'running' | 'success' | 'error'
    const [trainEpochs, setTrainEpochs] = useState(3)
    const [trainLR, setTrainLR] = useState('2e-5')
    const [trainBatch, setTrainBatch] = useState(4)
    const logsEndRef = useRef(null)

    // Test model
    const [testInput, setTestInput] = useState('')
    const [testOutput, setTestOutput] = useState('')
    const [testing, setTesting] = useState(false)
    const [chatHistory, setChatHistory] = useState([])

    // Active tab
    const [activeTab, setActiveTab] = useState('files') // files | quickadd | train | test

    // Load files on mount
    const loadFiles = useCallback(async () => {
        setLoading(true)
        try {
            const result = await window.electronAPI.training.listFiles()
            if (result.success) {
                setFiles(result.files)
            }
        } catch (err) {
            console.error('Failed to load training files:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadFiles()
    }, [loadFiles])

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [trainLogs])

    // Preview file
    const handlePreview = async (file) => {
        setSelectedFile(file)
        setPreviewLoading(true)
        try {
            const result = await window.electronAPI.training.readFile(file.name)
            if (result.success) {
                setPreviewData(result)
            } else {
                setPreviewData({ error: result.error })
            }
        } catch (err) {
            setPreviewData({ error: err.message })
        } finally {
            setPreviewLoading(false)
        }
    }

    // Upload files
    const handleUpload = async (fileList) => {
        if (!fileList || fileList.length === 0) return
        setUploading(true)
        try {
            for (const file of fileList) {
                const buffer = await file.arrayBuffer()
                await window.electronAPI.training.uploadFile(
                    Array.from(new Uint8Array(buffer)),
                    file.name
                )
            }
            await loadFiles()
        } catch (err) {
            console.error('Upload failed:', err)
        } finally {
            setUploading(false)
        }
    }

    const handleFileInput = (e) => handleUpload(e.target.files)

    // Drag & Drop
    const handleDragOver = (e) => { e.preventDefault(); setDragOver(true) }
    const handleDragLeave = () => setDragOver(false)
    const handleDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        handleUpload(e.dataTransfer.files)
    }

    // Delete file
    const handleDelete = async (filename) => {
        if (!confirm(`Xoa file "${filename}"?`)) return
        try {
            await window.electronAPI.training.deleteFile(filename)
            await loadFiles()
            if (selectedFile?.name === filename) {
                setSelectedFile(null)
                setPreviewData(null)
            }
        } catch (err) {
            console.error('Delete failed:', err)
        }
    }

    // Quick Add QA
    const handleAddQA = async () => {
        if (!qaQuestion.trim() || !qaAnswer.trim()) return
        setQaAdding(true)
        try {
            const result = await window.electronAPI.training.addSample({
                question: qaQuestion.trim(),
                answer: qaAnswer.trim(),
                targetFile: qaTarget,
            })
            if (result.success) {
                setQaQuestion('')
                setQaAnswer('')
                await loadFiles()
            }
        } catch (err) {
            console.error('Add QA failed:', err)
        } finally {
            setQaAdding(false)
        }
    }

    // Train model
    const handleTrain = async () => {
        setTraining(true)
        setTrainStatus('running')
        setTrainLogs([{ time: new Date().toLocaleTimeString('vi-VN'), msg: 'Bat dau training...' }])
        try {
            const result = await window.electronAPI.training.buildModel()
            if (result.success) {
                setTrainLogs(prev => [
                    ...prev,
                    ...((result.logs || []).map(l => ({ time: '', msg: l }))),
                    { time: new Date().toLocaleTimeString('vi-VN'), msg: 'Training hoan tat!' }
                ])
                setTrainStatus('success')
            } else {
                setTrainLogs(prev => [
                    ...prev,
                    { time: new Date().toLocaleTimeString('vi-VN'), msg: `Loi: ${result.error}` }
                ])
                setTrainStatus('error')
            }
        } catch (err) {
            setTrainLogs(prev => [
                ...prev,
                { time: new Date().toLocaleTimeString('vi-VN'), msg: `Loi: ${err.message}` }
            ])
            setTrainStatus('error')
        } finally {
            setTraining(false)
        }
    }

    // Test model
    const handleTest = async () => {
        if (!testInput.trim()) return
        const question = testInput.trim()
        setChatHistory(prev => [...prev, { role: 'user', content: question }])
        setTestInput('')
        setTesting(true)
        setTestOutput('')
        try {
            const result = await window.electronAPI.training.testModel(question)
            const answer = result.success ? result.text : `Loi: ${result.error}`
            const modeLabel = result.mode === 'direct' ? 'DIRECT' : result.mode === 'trained' ? 'TRAINED' : 'RAG'
            const ragInfo = result.ragContext != null
                ? `${modeLabel} | ${result.model || 'qwen'} | ${result.ragContext}/${result.ragTotal} ctx | score: ${result.ragTopScore || '0'} | ${result.totalMs || 0}ms`
                : ''
            setTestOutput(answer)
            setChatHistory(prev => [...prev, { role: 'assistant', content: answer, ragInfo }])
        } catch (err) {
            const errMsg = `Loi: ${err.message}`
            setTestOutput(errMsg)
            setChatHistory(prev => [...prev, { role: 'assistant', content: errMsg }])
        } finally {
            setTesting(false)
        }
    }

    const getFileIcon = (name) => {
        const ext = name.split('.').pop().toLowerCase()
        const colors = {
            jsonl: 'from-violet-500 to-purple-600',
            json: 'from-blue-500 to-cyan-600',
            csv: 'from-emerald-500 to-green-600',
            txt: 'from-amber-500 to-orange-600',
        }
        return colors[ext] || 'from-slate-500 to-slate-600'
    }

    const tabs = [
        { id: 'files', label: 'Training Files', icon: FolderOpen },
        { id: 'quickadd', label: 'Quick Add Q&A', icon: Plus },
        { id: 'train', label: 'Train Model', icon: Brain },
        { id: 'test', label: 'Test Model', icon: MessageSquare },
    ]

    // Computed stats
    const totalSamples = files.reduce((sum, f) => sum + (f.lines || 0), 0)
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
    const totalSizeFormatted = totalSize < 1024 ? `${totalSize} B`
        : totalSize < 1024 * 1024 ? `${(totalSize / 1024).toFixed(1)} KB`
        : `${(totalSize / (1024 * 1024)).toFixed(1)} MB`
    const jsonlFiles = files.filter(f => f.ext === 'jsonl')
    const jsonlSamples = jsonlFiles.reduce((sum, f) => sum + (f.lines || 0), 0)

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Training Data</h1>
                    <p className="text-slate-400 mt-1">Quan ly du lieu & fine-tune Qwen model</p>
                </div>
                <button
                    onClick={loadFiles}
                    className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                    title="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Dataset Overview Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                            <FolderOpen className="w-4 h-4 text-violet-400" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-white">{files.length}</p>
                    <p className="text-xs text-slate-500">Files</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center">
                            <Database className="w-4 h-4 text-cyan-400" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-white">{totalSamples}</p>
                    <p className="text-xs text-slate-500">Tong so dong</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                            <MessageSquare className="w-4 h-4 text-emerald-400" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-white">{jsonlSamples}</p>
                    <p className="text-xs text-slate-500">Q&A samples (JSONL)</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                            <FileText className="w-4 h-4 text-amber-400" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-white">{totalSizeFormatted}</p>
                    <p className="text-xs text-slate-500">Tong dung luong</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/10">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                            activeTab === tab.id
                                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* === TAB: Files === */}
            {activeTab === 'files' && (
                <div className="space-y-6">
                    {/* Upload Area */}
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`rounded-2xl border-2 border-dashed transition-all p-8 ${
                            dragOver
                                ? 'bg-violet-500/10 border-violet-500/50'
                                : 'bg-white/[0.03] border-white/10 hover:border-violet-500/30'
                        }`}
                    >
                        <div className="text-center">
                            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-3">
                                <Upload className={`w-7 h-7 text-violet-400 ${uploading ? 'animate-bounce' : ''}`} />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-1">
                                {uploading ? 'Dang upload...' : 'Upload Training Data'}
                            </h3>
                            <p className="text-sm text-slate-400 mb-4">
                                Keo tha file hoac chon - JSONL, JSON, CSV, TXT
                            </p>
                            <label className="inline-block">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept=".txt,.json,.jsonl,.csv"
                                    onChange={handleFileInput}
                                    className="hidden"
                                />
                                <div className="px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-medium cursor-pointer transition-all flex items-center gap-2 text-sm">
                                    <Upload className="w-4 h-4" />
                                    Chon files
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* File List */}
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                            <span className="ml-3 text-slate-400">Dang tai...</span>
                        </div>
                    ) : files.length > 0 ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-1 gap-3">
                                {files.map(file => (
                                    <div
                                        key={file.name}
                                        className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 hover:border-violet-500/30 transition-all group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4 flex-1 min-w-0">
                                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getFileIcon(file.name)} flex items-center justify-center shadow-lg flex-shrink-0`}>
                                                    <FileText className="w-5 h-5 text-white" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="font-bold text-white truncate">{file.name}</h3>
                                                    <div className="flex items-center gap-3 mt-1">
                                                        <span className="px-2 py-0.5 rounded bg-white/5 text-xs text-slate-400">{file.ext.toUpperCase()}</span>
                                                        <span className="text-xs text-slate-500">{file.sizeFormatted}</span>
                                                        {file.lines > 0 && (
                                                            <span className="text-xs text-cyan-400 font-medium">{file.lines} samples</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-2 flex-shrink-0">
                                                <button
                                                    onClick={() => handlePreview(file)}
                                                    className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:bg-violet-500/20 hover:text-violet-400 transition-all"
                                                    title="Preview"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(file.name)}
                                                    className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-all"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-12 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                                <Database className="w-8 h-8 text-slate-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-2">Chua co training data</h3>
                            <p className="text-sm text-slate-500">Upload files de bat dau</p>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Quick Add === */}
            {activeTab === 'quickadd' && (
                <div className="space-y-6">
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                    <Plus className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Them Q&A nhanh</h2>
                                    <p className="text-sm text-slate-400">Them cap cau hoi - tra loi vao training data</p>
                                </div>
                            </div>
                            {/* Target file info */}
                            {(() => {
                                const targetFile = files.find(f => f.name === qaTarget)
                                return targetFile ? (
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500">{targetFile.name}</p>
                                        <p className="text-sm text-cyan-400 font-semibold">{targetFile.lines} samples</p>
                                    </div>
                                ) : null
                            })()}
                        </div>

                        {/* Target file selector */}
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider font-medium">File dich</label>
                            <select
                                value={qaTarget}
                                onChange={e => setQaTarget(e.target.value)}
                                className="w-full px-4 py-2.5 rounded-xl bg-black/20 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-500/50"
                            >
                                {files.filter(f => f.ext === 'jsonl').map(f => (
                                    <option key={f.name} value={f.name}>{f.name} ({f.lines} samples)</option>
                                ))}
                                <option value="_new_">+ Tao file moi (training_custom.jsonl)</option>
                            </select>
                        </div>

                        {/* Question */}
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider font-medium">
                                Cau hoi (input)
                            </label>
                            <textarea
                                value={qaQuestion}
                                onChange={e => setQaQuestion(e.target.value)}
                                placeholder="VD: Lam sao de mo tai khoan online?"
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-violet-500/50 resize-none"
                            />
                        </div>

                        {/* Answer */}
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider font-medium">
                                Tra loi (output)
                            </label>
                            <textarea
                                value={qaAnswer}
                                onChange={e => setQaAnswer(e.target.value)}
                                placeholder="VD: De mo tai khoan online, ban can truy cap website ngan hang va lam theo huong dan..."
                                rows={4}
                                className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-violet-500/50 resize-none"
                            />
                        </div>

                        {/* Preview */}
                        {qaQuestion.trim() && qaAnswer.trim() && (
                            <div className="rounded-xl bg-black/30 border border-white/5 p-4">
                                <p className="text-xs text-slate-500 mb-2 font-medium">Preview JSONL</p>
                                <pre className="text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono">
{JSON.stringify({
    instruction: "Tra loi cau hoi ve dich vu ngan hang",
    input: qaQuestion.trim(),
    output: qaAnswer.trim(),
}, null, 2)}
                                </pre>
                            </div>
                        )}

                        <button
                            onClick={handleAddQA}
                            disabled={qaAdding || !qaQuestion.trim() || !qaAnswer.trim()}
                            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:from-violet-500/30 disabled:to-purple-600/30 disabled:cursor-not-allowed text-white font-semibold transition-all"
                        >
                            {qaAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            {qaAdding ? 'Dang them...' : 'Them Q&A'}
                        </button>
                    </div>

                    {/* Quick examples */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                        <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wider">Goi y cau hoi banking</p>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { q: 'Phi chuyen khoan lien ngan hang?', a: 'Phi chuyen khoan lien ngan hang tu 1,650d - 11,000d tuy hinh thuc.' },
                                { q: 'Lai suat tiet kiem 12 thang?', a: 'Lai suat tiet kiem 12 thang dao dong tu 5-6%/nam tuy ngan hang.' },
                                { q: 'Cach mo tai khoan online?', a: 'Truy cap app ngan hang, chon Mo tai khoan, xac minh eKYC chi trong 5-10 phut.' },
                            ].map((ex, i) => (
                                <button
                                    key={i}
                                    onClick={() => { setQaQuestion(ex.q); setQaAnswer(ex.a) }}
                                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:text-white hover:border-violet-500/30 transition-all"
                                >
                                    {ex.q}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* === TAB: Train === */}
            {activeTab === 'train' && (
                <div className="space-y-6">
                    {/* Train card */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                    <Brain className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Train Qwen Model</h2>
                                    <p className="text-sm text-slate-400">Fine-tune Qwen voi du lieu banking cua ban</p>
                                </div>
                            </div>
                            {trainStatus === 'success' && (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm">
                                    <CheckCircle className="w-4 h-4" />
                                    Thanh cong
                                </div>
                            )}
                            {trainStatus === 'error' && (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    Loi
                                </div>
                            )}
                        </div>

                        {/* Dataset overview */}
                        <div className="rounded-xl bg-black/20 border border-white/5 p-4 mb-5">
                            <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wider">Dataset</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {files.length > 0 ? files.map(f => (
                                    <div key={f.name} className="px-3 py-2.5 rounded-lg bg-white/5">
                                        <div className="text-xs text-slate-500 truncate">{f.name}</div>
                                        <div className="text-sm text-white font-semibold">{f.sizeFormatted}</div>
                                        {f.lines > 0 && <div className="text-xs text-slate-500">{f.lines} samples</div>}
                                    </div>
                                )) : (
                                    <div className="col-span-4 text-sm text-slate-500">Chua co training data. Upload file o tab "Training Files".</div>
                                )}
                            </div>
                        </div>

                        {/* Training config */}
                        <div className="rounded-xl bg-black/20 border border-white/5 p-4 mb-5">
                            <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wider">Cau hinh Training</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1.5">Epochs</label>
                                    <div className="flex gap-1.5">
                                        {[1, 3, 5, 10].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setTrainEpochs(n)}
                                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                                                    trainEpochs === n
                                                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                                        : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
                                                }`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1.5">Learning Rate</label>
                                    <div className="flex gap-1.5">
                                        {['1e-5', '2e-5', '5e-5'].map(lr => (
                                            <button
                                                key={lr}
                                                onClick={() => setTrainLR(lr)}
                                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                                                    trainLR === lr
                                                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                                        : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
                                                }`}
                                            >
                                                {lr}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1.5">Batch Size</label>
                                    <div className="flex gap-1.5">
                                        {[2, 4, 8].map(bs => (
                                            <button
                                                key={bs}
                                                onClick={() => setTrainBatch(bs)}
                                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                                                    trainBatch === bs
                                                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                                        : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
                                                }`}
                                            >
                                                {bs}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Progress bar khi training */}
                        {training && (
                            <div className="mb-5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-slate-400">Dang training...</span>
                                    <span className="text-xs text-violet-400">{trainLogs.length} logs</span>
                                </div>
                                <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 animate-pulse" style={{ width: '100%' }} />
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleTrain}
                            disabled={training || files.length === 0}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:from-violet-500/30 disabled:to-purple-600/30 disabled:cursor-not-allowed text-white font-semibold transition-all text-base"
                        >
                            {training ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <Zap className="w-5 h-5" />
                            )}
                            {training ? 'Dang training...' : 'Bat dau Training'}
                        </button>
                    </div>

                    {/* Logs */}
                    {trainLogs.length > 0 && (
                        <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-slate-400" />
                                    Training Logs
                                </h3>
                                <div className="flex items-center gap-3">
                                    {training && <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />}
                                    <button
                                        onClick={() => setTrainLogs([])}
                                        className="text-xs text-slate-500 hover:text-slate-300"
                                    >
                                        Xoa logs
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 max-h-80 overflow-y-auto font-mono text-xs space-y-1 bg-black/20">
                                {trainLogs.map((log, i) => (
                                    <div key={i} className="text-slate-300">
                                        {log.time && <span className="text-slate-500">[{log.time}] </span>}
                                        <span className={
                                            log.msg.includes('Loi') || log.msg.includes('Error') ? 'text-rose-400' :
                                            log.msg.includes('hoan tat') || log.msg.includes('Thanh cong') || log.msg.includes('success') ? 'text-emerald-400' :
                                            log.msg.includes('epoch') || log.msg.includes('step') ? 'text-cyan-400' :
                                            'text-slate-300'
                                        }>{log.msg}</span>
                                    </div>
                                ))}
                                <div ref={logsEndRef} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Test === */}
            {activeTab === 'test' && (
                <div className="space-y-6">
                    {/* Suggestion prompts */}
                    <div className="flex flex-wrap gap-2">
                        {[
                            'Phi chuyen khoan lien ngan hang la bao nhieu?',
                            'Lam sao de mo tai khoan online?',
                            'Lai suat tiet kiem 12 thang la bao nhieu?',
                            'Toi bi mat the ATM phai lam gi?',
                            'Cach dang ky Internet Banking?',
                        ].map((q, i) => (
                            <button
                                key={i}
                                onClick={() => setTestInput(q)}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:text-white hover:border-violet-500/30 hover:bg-violet-500/10 transition-all"
                            >
                                {q.length > 40 ? q.substring(0, 40) + '...' : q}
                            </button>
                        ))}
                    </div>

                    {/* Chat area */}
                    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                        {/* Chat history */}
                        <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto min-h-[200px]">
                            {chatHistory.length === 0 && !testing && (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
                                        <MessageSquare className="w-7 h-7 text-violet-400" />
                                    </div>
                                    <p className="text-slate-400 font-medium">Test Model cua ban</p>
                                    <p className="text-sm text-slate-500 mt-1">Nhap cau hoi hoac chon goi y o tren</p>
                                </div>
                            )}
                            {chatHistory.map((msg, i) => (
                                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                                        msg.role === 'user'
                                            ? 'bg-violet-500/20 border border-violet-500/20 text-white'
                                            : 'bg-white/5 border border-white/5 text-slate-200'
                                    }`}>
                                        {msg.role !== 'user' && (
                                            <div className="text-xs text-slate-500 mb-1.5 flex items-center gap-2">
                                                <span className="flex items-center gap-1"><Brain className="w-3 h-3" /> Qwen</span>
                                                {msg.ragInfo && (
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                                        msg.ragInfo.startsWith('DIRECT') ? 'bg-emerald-500/10 text-emerald-400' :
                                                        msg.ragInfo.startsWith('TRAINED') ? 'bg-violet-500/10 text-violet-400' :
                                                        'bg-cyan-500/10 text-cyan-400'
                                                    }`}>
                                                        {msg.ragInfo}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                    </div>
                                </div>
                            ))}
                            {testing && (
                                <div className="flex justify-start">
                                    <div className="rounded-2xl px-4 py-3 bg-white/5 border border-white/5">
                                        <div className="flex items-center gap-2 text-slate-400 text-sm">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Dang suy nghi...
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Input bar */}
                        <div className="p-4 border-t border-white/10 bg-black/20">
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={testInput}
                                    onChange={e => setTestInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && !testing && handleTest()}
                                    placeholder="Nhap cau hoi de test model..."
                                    className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-violet-500/50"
                                />
                                <button
                                    onClick={handleTest}
                                    disabled={testing || !testInput.trim()}
                                    className="flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:bg-violet-500/30 disabled:cursor-not-allowed text-white font-medium transition-all text-sm flex-shrink-0"
                                >
                                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                </button>
                            </div>
                            {chatHistory.length > 0 && (
                                <button
                                    onClick={() => setChatHistory([])}
                                    className="mt-2 text-xs text-slate-500 hover:text-slate-300"
                                >
                                    Xoa lich su chat
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {selectedFile && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setSelectedFile(null); setPreviewData(null) }}>
                    <div className="bg-[#0f0f1a] rounded-2xl border border-white/10 w-full max-w-3xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-white/10 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white">{selectedFile.name}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{selectedFile.sizeFormatted} &bull; {selectedFile.ext.toUpperCase()}</p>
                            </div>
                            <button
                                onClick={() => { setSelectedFile(null); setPreviewData(null) }}
                                className="p-2 rounded-lg hover:bg-white/10 text-slate-400 transition-all"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto max-h-[60vh]">
                            {previewLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                                    <span className="ml-2 text-slate-400 text-sm">Dang doc file...</span>
                                </div>
                            ) : previewData?.error ? (
                                <div className="text-rose-400 text-sm">{previewData.error}</div>
                            ) : previewData?.samples ? (
                                <div className="space-y-3">
                                    <p className="text-xs text-slate-500 mb-3">
                                        Hien thi {previewData.samples.length} / {previewData.totalLines} mau dau tien
                                    </p>
                                    {previewData.samples.map((sample, idx) => (
                                        <div key={idx} className="rounded-lg bg-black/30 p-3 border border-white/5">
                                            {typeof sample === 'object' ? (
                                                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap overflow-x-auto">
                                                    {JSON.stringify(sample, null, 2)}
                                                </pre>
                                            ) : (
                                                <p className="text-xs text-slate-300 font-mono whitespace-pre-wrap">{sample}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : previewData?.content ? (
                                <pre className="text-xs text-slate-300 font-mono bg-black/30 p-4 rounded-lg whitespace-pre-wrap">
                                    {previewData.content}
                                </pre>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
