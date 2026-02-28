import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, Eye, FileText, Plus, X, Save, ToggleLeft, ToggleRight, Pencil, AlertCircle, BookOpen, CheckCircle2 } from 'lucide-react'

export default function TrainingData() {
    const [entries, setEntries] = useState([])
    const [loading, setLoading] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [showPreview, setShowPreview] = useState(null)
    const [editingId, setEditingId] = useState(null)
    const [editForm, setEditForm] = useState({ title: '', content: '' })
    const [addForm, setAddForm] = useState({ title: '', content: '' })
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState(null)
    const [successMsg, setSuccessMsg] = useState(null)
    const fileInputRef = useRef(null)

    useEffect(() => {
        loadEntries()
    }, [])

    useEffect(() => {
        if (successMsg) {
            const t = setTimeout(() => setSuccessMsg(null), 3000)
            return () => clearTimeout(t)
        }
    }, [successMsg])

    const loadEntries = async () => {
        try {
            setLoading(true)
            const list = await window.electronAPI.trainingData.list()
            setEntries(list || [])
        } catch (err) {
            setError('Không thể tải danh sách: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleAdd = async () => {
        if (!addForm.title.trim() || !addForm.content.trim()) {
            setError('Vui lòng nhập tiêu đề và nội dung')
            return
        }
        try {
            const result = await window.electronAPI.trainingData.create({
                title: addForm.title.trim(),
                content: addForm.content.trim(),
                type: 'text',
            })
            if (result.success) {
                setAddForm({ title: '', content: '' })
                setShowAddModal(false)
                setSuccessMsg('Đã thêm training data thành công')
                await loadEntries()
            } else {
                setError(result.error)
            }
        } catch (err) {
            setError('Lỗi: ' + err.message)
        }
    }

    const handleFileUpload = async (event) => {
        const files = event.target.files
        if (!files || files.length === 0) return

        setUploading(true)
        setError(null)

        try {
            for (const file of files) {
                const arrayBuffer = await file.arrayBuffer()
                const fileData = Array.from(new Uint8Array(arrayBuffer))

                const uploadResult = await window.electronAPI.trainingData.upload({
                    fileData,
                    filename: file.name,
                })

                if (!uploadResult.success) {
                    setError(`Upload failed: ${uploadResult.error}`)
                    continue
                }

                const createResult = await window.electronAPI.trainingData.create({
                    title: file.name.replace(/\.[^.]+$/, ''),
                    content: uploadResult.content,
                    type: 'file',
                    file_path: uploadResult.path,
                })

                if (!createResult.success) {
                    setError(`Save failed: ${createResult.error}`)
                }
            }
            setSuccessMsg(`Đã upload ${files.length} file thành công`)
            await loadEntries()
        } catch (err) {
            setError('Upload error: ' + err.message)
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const handleToggleActive = async (entry) => {
        try {
            const result = await window.electronAPI.trainingData.update(entry.id, {
                is_active: entry.is_active ? 0 : 1,
            })
            if (result.success) {
                setEntries(prev => prev.map(e =>
                    e.id === entry.id ? { ...e, is_active: entry.is_active ? 0 : 1 } : e
                ))
            }
        } catch (err) {
            setError('Toggle error: ' + err.message)
        }
    }

    const handleStartEdit = (entry) => {
        setEditingId(entry.id)
        setEditForm({ title: entry.title, content: entry.content })
    }

    const handleSaveEdit = async () => {
        if (!editForm.title.trim() || !editForm.content.trim()) {
            setError('Tiêu đề và nội dung không được trống')
            return
        }
        try {
            const result = await window.electronAPI.trainingData.update(editingId, {
                title: editForm.title.trim(),
                content: editForm.content.trim(),
            })
            if (result.success) {
                setEditingId(null)
                setSuccessMsg('Đã cập nhật thành công')
                await loadEntries()
            } else {
                setError(result.error)
            }
        } catch (err) {
            setError('Save error: ' + err.message)
        }
    }

    const handleDelete = async (id) => {
        try {
            const result = await window.electronAPI.trainingData.delete(id)
            if (result.success) {
                setEntries(prev => prev.filter(e => e.id !== id))
                setSuccessMsg('Đã xoá thành công')
            } else {
                setError(result.error)
            }
        } catch (err) {
            setError('Delete error: ' + err.message)
        }
    }

    const activeCount = entries.filter(e => e.is_active).length

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Training Data</h1>
                    <p className="text-slate-400 mt-1">
                        Quản lý dữ liệu huấn luyện — được thêm vào system prompt của Voice Chat
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm">
                        <span className="text-slate-400">Active: </span>
                        <span className="text-emerald-400 font-semibold">{activeCount}</span>
                        <span className="text-slate-500"> / {entries.length}</span>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-medium transition-all flex items-center gap-2 text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Thêm mới
                    </button>
                </div>
            </div>

            {/* Success / Error Banners */}
            {successMsg && (
                <div className="px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    {successMsg}
                </div>
            )}
            {error && (
                <div className="px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span className="flex-1">{error}</span>
                    <button onClick={() => setError(null)} className="text-rose-400/50 hover:text-rose-400">✕</button>
                </div>
            )}

            {/* Upload Area */}
            <div className="rounded-2xl bg-white/[0.03] border-2 border-dashed border-white/10 hover:border-cyan-500/30 transition-all p-8">
                <div className="text-center">
                    <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-3">
                        <Upload className="w-6 h-6 text-cyan-400" />
                    </div>
                    <h3 className="text-base font-semibold text-white mb-1">Upload Training Data</h3>
                    <p className="text-xs text-slate-400 mb-4">
                        Hỗ trợ: TXT, JSON, JSONL, CSV, MD (Max 10MB per file)
                    </p>
                    <label className="inline-block">
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept=".txt,.json,.jsonl,.csv,.md"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        <div className={`px-5 py-2.5 rounded-xl text-white font-medium cursor-pointer transition-all flex items-center gap-2 text-sm
                            ${uploading
                                ? 'bg-slate-600 cursor-not-allowed'
                                : 'bg-cyan-500 hover:bg-cyan-600'
                            }`}>
                            <Upload className="w-4 h-4" />
                            {uploading ? 'Đang upload...' : 'Chọn files'}
                        </div>
                    </label>
                </div>
            </div>

            {/* Entries List */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto" />
                    <p className="text-slate-500 text-sm mt-3">Đang tải...</p>
                </div>
            ) : entries.length === 0 ? (
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                        <BookOpen className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">Chưa có training data</h3>
                    <p className="text-sm text-slate-500">
                        Thêm kiến thức để AI trả lời tốt hơn trong Voice Chat
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {entries.map(entry => (
                        <div
                            key={entry.id}
                            className={`rounded-xl border p-4 transition-all ${entry.is_active
                                    ? 'bg-white/[0.03] border-white/10 hover:border-cyan-500/30'
                                    : 'bg-white/[0.01] border-white/5 opacity-60'
                                }`}
                        >
                            {editingId === entry.id ? (
                                /* Edit Mode */
                                <div className="space-y-3">
                                    <input
                                        type="text"
                                        value={editForm.title}
                                        onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500/50"
                                        placeholder="Tiêu đề"
                                    />
                                    <textarea
                                        value={editForm.content}
                                        onChange={(e) => setEditForm(f => ({ ...f, content: e.target.value }))}
                                        rows={6}
                                        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-cyan-500/50 resize-y"
                                        placeholder="Nội dung training data"
                                    />
                                    <div className="flex gap-2 justify-end">
                                        <button
                                            onClick={() => setEditingId(null)}
                                            className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 text-sm"
                                        >
                                            Huỷ
                                        </button>
                                        <button
                                            onClick={handleSaveEdit}
                                            className="px-3 py-1.5 rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 text-sm flex items-center gap-1.5"
                                        >
                                            <Save className="w-3.5 h-3.5" />
                                            Lưu
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* View Mode */
                                <div className="flex items-start gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${entry.type === 'file'
                                            ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20'
                                            : 'bg-gradient-to-br from-cyan-500/20 to-teal-500/20'
                                        }`}>
                                        <FileText className={`w-5 h-5 ${entry.type === 'file' ? 'text-amber-400' : 'text-cyan-400'
                                            }`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-white text-sm truncate">{entry.title}</h3>
                                            {entry.type === 'file' && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 flex-shrink-0">FILE</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                                            {entry.content?.substring(0, 150)}
                                            {entry.content?.length > 150 ? '...' : ''}
                                        </p>
                                        <p className="text-[10px] text-slate-600 mt-1">
                                            {entry.created_at} • {entry.content?.length || 0} ký tự
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <button
                                            onClick={() => handleToggleActive(entry)}
                                            className="p-1.5 rounded-lg hover:bg-white/5 transition-all"
                                            title={entry.is_active ? 'Tắt' : 'Bật'}
                                        >
                                            {entry.is_active ? (
                                                <ToggleRight className="w-5 h-5 text-emerald-400" />
                                            ) : (
                                                <ToggleLeft className="w-5 h-5 text-slate-500" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setShowPreview(entry)}
                                            className="p-1.5 rounded-lg text-slate-400 hover:bg-white/5 hover:text-cyan-400 transition-all"
                                            title="Xem"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleStartEdit(entry)}
                                            className="p-1.5 rounded-lg text-slate-400 hover:bg-white/5 hover:text-cyan-400 transition-all"
                                            title="Sửa"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(entry.id)}
                                            className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-all"
                                            title="Xoá"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Add Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-2xl overflow-hidden">
                        <div className="p-5 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">Thêm Training Data</h3>
                            <button
                                onClick={() => { setShowAddModal(false); setAddForm({ title: '', content: '' }) }}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="text-sm text-slate-400 mb-1.5 block">Tiêu đề</label>
                                <input
                                    type="text"
                                    value={addForm.title}
                                    onChange={(e) => setAddForm(f => ({ ...f, title: e.target.value }))}
                                    className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500/50"
                                    placeholder="VD: Quy trình mở tài khoản"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-sm text-slate-400 mb-1.5 block">Nội dung</label>
                                <textarea
                                    value={addForm.content}
                                    onChange={(e) => setAddForm(f => ({ ...f, content: e.target.value }))}
                                    rows={10}
                                    className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-cyan-500/50 resize-y"
                                    placeholder="Nhập nội dung kiến thức mà AI cần biết..."
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-white/10 flex justify-end gap-3">
                            <button
                                onClick={() => { setShowAddModal(false); setAddForm({ title: '', content: '' }) }}
                                className="px-4 py-2 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 text-sm"
                            >
                                Huỷ
                            </button>
                            <button
                                onClick={handleAdd}
                                className="px-4 py-2 rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 text-sm flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Thêm
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {showPreview && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-3xl max-h-[80vh] overflow-hidden">
                        <div className="p-5 border-b border-white/10 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white">{showPreview.title}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {showPreview.type === 'file' ? '📁 Uploaded file' : '📝 Manual entry'} • {showPreview.content?.length || 0} ký tự
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPreview(null)}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto max-h-[60vh]">
                            <pre className="text-sm text-slate-300 font-mono bg-black/30 p-4 rounded-lg whitespace-pre-wrap break-words">
                                {showPreview.content}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
