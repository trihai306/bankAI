import { useState } from 'react'
import { Upload, File, Trash2, Eye, Check, AlertCircle, Database, FileText } from 'lucide-react'

export default function TrainingData() {
    const [datasets, setDatasets] = useState([])
    const [uploading, setUploading] = useState(false)
    const [selectedFile, setSelectedFile] = useState(null)

    const handleFileUpload = async (event) => {
        const files = event.target.files
        if (!files || files.length === 0) return

        setUploading(true)

        // Simulate upload - replace with actual IPC call
        for (let file of files) {
            const newDataset = {
                id: Date.now() + Math.random(),
                name: file.name,
                size: (file.size / 1024).toFixed(2) + ' KB',
                type: file.name.split('.').pop().toUpperCase(),
                uploadedAt: new Date().toLocaleString('vi-VN'),
                samples: Math.floor(Math.random() * 1000) + 100
            }
            setDatasets(prev => [newDataset, ...prev])
        }

        setTimeout(() => setUploading(false), 1000)
    }

    const handleDelete = (id) => {
        setDatasets(prev => prev.filter(d => d.id !== id))
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Training Data</h1>
                    <p className="text-slate-400 mt-1">Upload và quản lý datasets để fine-tune model</p>
                </div>
                <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-slate-400 text-sm">Datasets: </span>
                    <span className="text-white font-semibold">{datasets.length}</span>
                </div>
            </div>

            {/* Upload Area */}
            <div className="rounded-2xl bg-white/[0.03] border-2 border-dashed border-white/10 hover:border-violet-500/30 transition-all p-12">
                <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
                        <Upload className="w-8 h-8 text-violet-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">Upload Training Data</h3>
                    <p className="text-sm text-slate-400 mb-6">
                        Hỗ trợ: TXT, JSON, JSONL, CSV (Max 10MB per file)
                    </p>
                    <label className="inline-block">
                        <input
                            type="file"
                            multiple
                            accept=".txt,.json,.jsonl,.csv"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        <div className="px-6 py-3 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-medium cursor-pointer transition-all flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Chọn files
                        </div>
                    </label>
                </div>
            </div>

            {/* Datasets List */}
            {datasets.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-xl font-bold text-white">Datasets đã upload</h2>
                    <div className="grid grid-cols-1 gap-4">
                        {datasets.map(dataset => (
                            <div
                                key={dataset.id}
                                className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 hover:border-violet-500/30 transition-all group"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg">
                                            <Database className="w-6 h-6 text-white" />
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="font-bold text-white text-lg">{dataset.name}</h3>
                                            <p className="text-sm text-slate-400">
                                                {dataset.type} • {dataset.size} • {dataset.samples} samples
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                Uploaded: {dataset.uploadedAt}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSelectedFile(dataset)}
                                            className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:bg-violet-500/20 hover:text-violet-400 transition-all"
                                            title="Preview"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(dataset.id)}
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
            )}

            {/* Empty State */}
            {datasets.length === 0 && (
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                        <FileText className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">Chưa có dataset nào</h3>
                    <p className="text-sm text-slate-500">Upload files để bắt đầu training model</p>
                </div>
            )}

            {/* Preview Modal */}
            {selectedFile && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-2xl max-h-[80vh] overflow-hidden">
                        <div className="p-6 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">{selectedFile.name}</h3>
                            <button
                                onClick={() => setSelectedFile(null)}
                                className="p-2 rounded-lg hover:bg-white/10 text-slate-400"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto max-h-96">
                            <pre className="text-sm text-slate-300 font-mono bg-black/30 p-4 rounded-lg">
                                {`// Sample preview\n{\n  "instruction": "Sửa lỗi chính tả",\n  "input": "xin chao moi nguoi",\n  "output": "Xin chào mọi người"\n}`}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
