import { useState, useCallback, useEffect, useRef } from 'react'
import MappingResult from './MappingResult'
import { uploadFiles as apiUpload, getFiles, healthCheck, subscribeToProgress, getJobProgress, reprocessFile } from '../api'
import type { ApiFile, ApiUploadResponse, MLMapping, JobProgress } from '../api'
import './Dashboard.css'
import { Activity, LayoutDashboard, FolderOpen, UploadCloud, FileText, AlertCircle, Bell, Search, ChevronDown, RefreshCw, Loader } from 'lucide-react';

interface UploadResult {
  file: ApiFile
  mapping?: MLMapping
}

interface Toast {
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  id: number
}

// Per-file live progress state
interface FileProgress {
  [fileId: number]: JobProgress
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function confidenceLabel(conf: number): 'high' | 'medium' | 'low' {
  if (conf >= 0.8) return 'high'
  if (conf >= 0.5) return 'medium'
  return 'low'
}

function confidenceColor(level: 'high' | 'medium' | 'low'): string {
  if (level === 'high') return '#22c55e'
  if (level === 'medium') return '#f59e0b'
  return '#ef4444'
}

// Subcomponent for Stages
function FileStages({ file, mapping, progress }: { file: ApiFile, mapping?: MLMapping, progress?: JobProgress }) {
  const stageOrder = ['extract', 'inspect', 'classify', 'map', 'done']
  const currentIdx = progress ? stageOrder.indexOf(progress.stage) : -1
  const isMapped = mapping && !mapping.target_table.toLowerCase().startsWith('unknown');
  const isFailed = file.status === 'error' || (mapping && mapping.target_table.toLowerCase().startsWith('unknown'));
  const isProcessing = file.status === 'processing'
  const isDone = file.status === 'mapped' || file.status === 'imported' || file.status === 'review'

  const stages = [
    { name: 'Extract' },
    { name: 'Inspect' },
    { name: 'Classify' },
    { name: 'Map' },
    { name: 'Import' },
  ];

  return (
    <div className="file-stages">
      {stages.map((st, i) => {
        let cls = ''
        if (isProcessing && currentIdx >= 0) {
          if (i < currentIdx) cls = 'active'
          else if (i === currentIdx) cls = 'processing'
        } else if (isDone || isMapped) {
          cls = i <= 3 ? 'active' : (file.status === 'imported' ? 'active' : '')
        } else if (isFailed) {
          cls = 'error'
        }
        return (
          <span key={i} className={`stage-pill ${cls}`} title={st.name}>
            {st.name}
          </span>
        )
      })}
    </div>
  )
}

// Inline progress bar for files still being processed
function ProcessingOverlay({ progress }: { progress: JobProgress }) {
  const data = progress.data
  const isCacheHit = data?.cache_hit === true
  const s = (v: unknown): string => String(v ?? '')
  const confidenceRaw = data?.mapping_confidence ?? data?.confidence
  const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : Number(confidenceRaw)
  const hasConfidence = Number.isFinite(confidence)
  const level = hasConfidence ? confidenceLabel(confidence) : null

  return (
    <div style={{
      marginTop: '0.75rem',
      padding: '0.75rem',
      borderRadius: '8px',
      background: 'rgba(45, 212, 191, 0.06)',
      border: '1px solid rgba(45, 212, 191, 0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <Loader size={14} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{progress.message}</span>
        {hasConfidence && level && (
          <span style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.4rem',
            borderRadius: '4px',
            background: 'rgba(255,255,255,0.08)',
            color: confidenceColor(level),
            border: `1px solid ${confidenceColor(level)}33`,
          }}>
            confidence {Math.round(confidence * 100)}% ({level})
          </span>
        )}
        {isCacheHit && (
          <span style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.4rem',
            borderRadius: '4px',
            background: 'rgba(139, 92, 246, 0.15)',
            color: '#a78bfa',
          }}>
            cache hit
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', marginBottom: '0.5rem' }}>
        <div style={{
          height: '100%',
          borderRadius: '2px',
          width: `${progress.percent}%`,
          transition: 'width 0.4s ease',
          background: progress.stage === 'error'
            ? '#ef4444'
            : 'linear-gradient(90deg, #2dd4bf, #38bdf8)',
        }} />
      </div>

      {/* Rich details */}
      {data && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {progress.stage === 'extract' && String(data.format || '') !== '' && (
            <span>Format: <strong>{s(data.format).toUpperCase()}</strong>, {s(data.row_count)} rows, {s(data.column_count)} columns</span>
          )}
          {progress.stage === 'inspect' && Array.isArray(data.column_profiles) && (
            <span>Analyzed {String(data.column_profiles.length)} columns for types, nulls, and patterns</span>
          )}
          {progress.stage === 'classify' && String(data.target_table || '') !== '' && (
            <div>
              <span>Table: <strong style={{ color: '#2dd4bf' }}>{s(data.target_table)}</strong></span>
              {data.confidence !== undefined && (
                <span style={{ marginLeft: '0.75rem' }}>Confidence: {Math.round(Number(data.confidence) * 100)}%</span>
              )}
              {String(data.reasoning || '') !== '' && (
                <div style={{ marginTop: '0.25rem', fontStyle: 'italic', opacity: 0.8 }}>&ldquo;{s(data.reasoning)}&rdquo;</div>
              )}
            </div>
          )}
          {progress.stage === 'map' && data.columns_mapped !== undefined && (
            <span>
              {s(data.columns_mapped)} columns mapped
              {data.columns_unmapped !== undefined && Number(data.columns_unmapped) > 0 && (
                <span>, {s(data.columns_unmapped)} unmapped</span>
              )}
              {data.mapping_confidence !== undefined && (
                <span> (overall confidence {Math.round(Number(data.mapping_confidence) * 100)}%)</span>
              )}
            </span>
          )}
          {progress.stage === 'done' && (
            <span style={{ color: '#2dd4bf' }}>
              Done: {s(data.columns_mapped)} columns mapped to {s(data.target_table)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [results, setResults] = useState<UploadResult[]>([])
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [sample20, setSample20] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<JobProgress | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [fileProgress, setFileProgress] = useState<FileProgress>({})
  const [reprocessing, setReprocessing] = useState<Set<number>>(new Set())

  // --- Tab State ---
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'upload'>('overview')

  const addToast = (message: string, type: Toast['type']) => {
    const id = Date.now()
    setToasts(prev => [...prev, { message, type, id }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  const loadFiles = useCallback(async () => {
    try {
      const apiFiles = await getFiles()
      const converted: UploadResult[] = apiFiles.map((f) => {
        let mapping: MLMapping | undefined
        if (f.mapping_result && f.mapping_result !== '{}') {
          try {
            mapping = JSON.parse(f.mapping_result)
          } catch { /* ignore */ }
        }
        return { file: f, mapping }
      })
      setResults(converted)

      // Check for any "processing" files and start polling their progress
      for (const f of apiFiles) {
        if (f.status === 'processing' && f.job_id) {
          startPollingFile(f.id, f.job_id)
        }
      }
    } catch (err) {
      console.error('Failed to load files:', err)
    }
  }, [])

  const activeSubscriptions = useRef<Map<number, () => void>>(new Map())

  const startPollingFile = (fileId: number, jobId: string) => {
    // Don't double-subscribe
    if (activeSubscriptions.current.has(fileId)) return

    // First check current state
    getJobProgress(jobId).then(p => {
      if (p && (p.stage === 'done' || p.stage === 'error')) {
        setFileProgress(prev => ({ ...prev, [fileId]: p }))
        loadFiles()
        return
      }
      // If still processing, subscribe to SSE
      if (p) {
        setFileProgress(prev => ({ ...prev, [fileId]: p }))
      }
      const unsub = subscribeToProgress(
        jobId,
        (progress) => {
          setFileProgress(prev => ({ ...prev, [fileId]: progress }))
        },
        () => {
          activeSubscriptions.current.delete(fileId)
          loadFiles()
        },
      )
      activeSubscriptions.current.set(fileId, unsub)
    })
  }

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      activeSubscriptions.current.forEach(unsub => unsub())
      activeSubscriptions.current.clear()
    }
  }, [])

  useEffect(() => {
    healthCheck().then((online) => {
      setIsBackendOnline(online)
      if (online) loadFiles()
    })
  }, [loadFiles])

  const handleRetry = async (fileId: number) => {
    setReprocessing(prev => new Set(prev).add(fileId))
    try {
      const res = await reprocessFile(fileId)
      addToast('Reprocessing file...', 'info')
      startPollingFile(fileId, res.job_id)
      // Update the file status immediately in UI
      setResults(prev => prev.map(r =>
        r.file.id === fileId ? { ...r, file: { ...r.file, status: 'processing' }, mapping: undefined } : r
      ))
    } catch (err) {
      addToast('Retry failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error')
    } finally {
      setReprocessing(prev => {
        const next = new Set(prev)
        next.delete(fileId)
        return next
      })
    }
  }

  const handleFilesUploaded = useCallback(async (newFiles: File[]) => {
    if (!isBackendOnline) {
      addToast('Backend is offline. Please check services.', 'error')
      return
    }

    const fileNames = newFiles.map(f => f.name)
    setUploadingFiles(fileNames)
    setIsUploading(true)
    setUploadProgress({ job_id: '', stage: 'uploading', message: 'Uploading files...', percent: 0 })

    try {
      const uploadResults: ApiUploadResponse[] = await apiUpload(newFiles, sample20)

      // Immediately show the file cards
      const converted: UploadResult[] = uploadResults.map((r) => ({
        file: r.file,
        mapping: r.mapping,
      }))
      setResults((prev) => [...converted, ...prev])

      // Subscribe to SSE progress for each file's job
      let completedJobs = 0
      const totalJobs = uploadResults.filter(r => r.job_id).length

      if (totalJobs === 0) {
        const mappedCount = converted.filter(r => r.mapping && !r.mapping.target_table.toLowerCase().startsWith('unknown')).length
        if (mappedCount > 0) {
          addToast(`Successfully mapped ${mappedCount} file(s)!`, 'success')
        }
        setIsUploading(false)
        setUploadProgress(null)
        setUploadingFiles([])
        loadFiles()
        return
      }

      for (const result of uploadResults) {
        if (!result.job_id) continue

        subscribeToProgress(
          result.job_id,
          (progress) => {
            setUploadProgress(progress)
            setFileProgress(prev => ({ ...prev, [result.file.id]: progress }))
            if (progress.stage === 'done') {
              loadFiles()
            }
          },
          () => {
            completedJobs++
            if (completedJobs >= totalJobs) {
              setIsUploading(false)
              setUploadProgress(null)
              setUploadingFiles([])
              loadFiles()
            }
          },
        )
      }
    } catch (err) {
      console.error('Upload failed:', err)
      addToast('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error')
      setIsUploading(false)
      setUploadProgress(null)
      setUploadingFiles([])
    }
  }, [isBackendOnline, sample20, loadFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) handleFilesUploaded(files)
  }, [handleFilesUploaded])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) handleFilesUploaded(files)
    e.target.value = ''
  }

  return (
    <div className="dashboard-layout">
      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span>{toast.message}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>✕</button>
          </div>
        ))}
      </div>

      {/* Left Sidebar Menu */}
      <aside className="dashboard-sidebar">
        <div className="sidebar-header">
          <Activity size={24} color="#2dd4bf" className="brand-icon" />
          <h2>HealthMap</h2>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-group">
            <button className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
              <LayoutDashboard size={18} />
              <span>Overview</span>
            </button>
            <button className={`nav-item ${activeTab === 'records' ? 'active' : ''}`} onClick={() => setActiveTab('records')}>
              <FolderOpen size={18} />
              <span>Health Records</span>
            </button>
            <button className={`nav-item ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}>
              <UploadCloud size={18} />
              <span>Upload Data</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="dashboard-main">
        {/* Top Header Bar */}
        <header className="dashboard-topbar">
          <div className="topbar-greeting">
             <h2>Global Records Dashboard</h2>
             <p>All structured systems</p>
          </div>

          <div className="topbar-actions">
            <div className={`status-indicator ${isBackendOnline ? 'online' : 'offline'}`}>
              <span className="status-dot" />
              <span>{isBackendOnline ? 'API Connected' : 'API Offline'}</span>
            </div>
            <button className="icon-btn"><Search size={20} /></button>
            <button className="icon-btn"><Bell size={20} /></button>
            
            <div className="user-profile">
               <div className="avatar">DS</div>
               <ChevronDown size={16} color="var(--text-muted)" />
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {activeTab === 'overview' && (
              <div className="overview-tab fade-in">
                <div className="stats-grid">
                  <div className="stat-card">
                    <p className="stat-label">Total Records</p>
                    <p className="stat-value">{results.length}</p>
                    <div className="stat-accent bg-blue" />
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Mapped Entries</p>
                    <p className="stat-value">{results.filter(r => r.mapping && !r.mapping.target_table.toLowerCase().startsWith('unknown')).length}</p>
                    <div className="stat-accent bg-indigo" />
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Processing</p>
                    <p className="stat-value">{results.filter(r => r.file.status === 'processing').length}</p>
                    <div className="stat-accent bg-teal" />
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Last Upload</p>
                    <p className="stat-value text-sm">{results.length > 0 ? formatDate(results[0].file.uploaded_at) : 'N/A'}</p>
                    <div className="stat-accent bg-teal" />
                  </div>
                </div>
                
                <div className="dashboard-row">
                  <div className="card recent-activity-card">
                    <div className="card-header">
                      <h3>Recent Uploads</h3>
                      <button className="btn-link" onClick={() => setActiveTab('records')}>View All</button>
                    </div>
                    {results.length === 0 ? (
                      <p className="empty-text">No recent records found.</p>
                    ) : (
                      <div className="activity-list">
                        {results.slice(0, 4).map(r => (
                          <div key={r.file.id} className="activity-item">
                            <div className="activity-icon-bg">
                              <FileText size={16} className="text-teal" />
                            </div>
                            <div className="activity-details">
                              <p className="activity-filename">{r.file.filename}</p>
                              <p className="activity-time">{formatDate(r.file.uploaded_at)}</p>
                            </div>
                            <FileStages file={r.file} mapping={r.mapping} progress={fileProgress[r.file.id]} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
          )}

          {activeTab === 'upload' && (
            <div className="upload-tab fade-in">
              <div className="card upload-card">
                <div className="card-header">
                  <h3>Upload Medical Data</h3>
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={sample20} 
                      onChange={e => setSample20(e.target.checked)} 
                      disabled={isUploading} 
                    />
                      AI Sample 20%
                  </label>
                </div>
                
                <div
                  className={`dropzone ${isDragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false) }}
                  onDrop={handleDrop}
                  onClick={() => !isUploading && document.getElementById('file-input')?.click()}
                >
                  {isUploading ? (
                    <div className="upload-progress">
                      <div className="spinner" />
                      <p className="upload-stage">
                        {uploadProgress ? uploadProgress.message : 'Uploading...'}
                      </p>
                      <div className="file-chips">
                        {uploadingFiles.map((name, i) => (
                          <span key={i} className="chip">{name}</span>
                        ))}
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${uploadProgress?.percent ?? 0}%`,
                            transition: 'width 0.4s ease',
                            background: uploadProgress?.stage === 'error'
                              ? 'linear-gradient(90deg, #f44336, #ef5350)'
                              : 'linear-gradient(90deg, var(--accent), var(--accent-hover))',
                          }}
                        />
                      </div>
                      {uploadProgress && (
                        <div style={{ marginTop: '0.75rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <span style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: '6px',
                              background: uploadProgress.stage === 'extract' ? 'rgba(45,212,191,0.15)' : 'transparent',
                              color: uploadProgress.stage === 'extract' ? '#2dd4bf' : undefined,
                            }}>Extract</span>
                            <span style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: '6px',
                              background: uploadProgress.stage === 'inspect' ? 'rgba(45,212,191,0.15)' : 'transparent',
                              color: uploadProgress.stage === 'inspect' ? '#2dd4bf' : undefined,
                            }}>Inspect</span>
                            <span style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: '6px',
                              background: uploadProgress.stage === 'classify' ? 'rgba(45,212,191,0.15)' : 'transparent',
                              color: uploadProgress.stage === 'classify' ? '#2dd4bf' : undefined,
                            }}>Classify</span>
                            <span style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: '6px',
                              background: uploadProgress.stage === 'map' ? 'rgba(45,212,191,0.15)' : 'transparent',
                              color: uploadProgress.stage === 'map' ? '#2dd4bf' : undefined,
                            }}>Map</span>
                          </div>
                          {uploadProgress.data && (() => {
                            const d = uploadProgress.data
                            const cRaw = d.mapping_confidence ?? d.confidence
                            const cNum = typeof cRaw === 'number' ? cRaw : Number(cRaw)
                            const hasC = Number.isFinite(cNum)
                            const lvl = hasC ? confidenceLabel(cNum) : null
                            return (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
                              {String(d.target_table || '') !== '' && (
                                <div>Table: <strong>{String(d.target_table)}</strong></div>
                              )}
                              {hasC && lvl && (
                                <div>
                                  Confidence: <strong style={{ color: confidenceColor(lvl) }}>{Math.round(cNum * 100)}% ({lvl})</strong>
                                </div>
                              )}
                              {d.columns_mapped !== undefined && (
                                <div>Columns: {String(d.columns_mapped)} mapped, {String(d.columns_unmapped)} unmapped</div>
                              )}
                              {String(d.reasoning || '') !== '' && (
                                <div style={{ fontStyle: 'italic', opacity: 0.8, marginTop: '0.25rem' }}>&ldquo;{String(d.reasoning)}&rdquo;</div>
                              )}
                            </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="dropzone-content">
                      <div className="dropzone-icon">
                        <UploadCloud size={48} />
                      </div>
                      <h3>Drag & Drop Files</h3>
                      <p>or <strong className="text-accent">browse your computer</strong></p>
                      <p className="supported-formats">Supported: CSV, XLSX, TSV, TXT</p>
                    </div>
                  )}
                  <input id="file-input" type="file" multiple accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={handleFileInput} className="hidden-input" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'records' && (
            <div className="records-tab fade-in">
              <div className="card">
                <div className="card-header mb-4">
                  <h3>Health Records</h3>
                </div>
                
                {results.length === 0 ? (
                  <div className="empty-state">
                    <FolderOpen size={48} className="text-muted" />
                    <h3>No records available</h3>
                    <p>Upload files to see them structured here.</p>
                    <button className="btn-primary mt-4" onClick={() => setActiveTab('upload')}>Upload Data</button>
                  </div>
                ) : (
                  <div className="records-list">
                    {results.map((r) => (
                      <div key={r.file.id} className="record-container mb-4">
                        <div className="record-meta flex-wrap gap-4 items-center justify-between">
                          <div className="record-meta-info flex gap-3">
                            <span className="badge badge-dark">{r.file.file_type.toUpperCase()}</span>
                            <span className="meta-text">{formatFileSize(r.file.file_size_bytes)}</span>
                            <span className="meta-text">{r.file.row_count.toLocaleString()} rows</span>
                            <span className="meta-text">{formatDate(r.file.uploaded_at)}</span>
                            {r.mapping && Number.isFinite(r.mapping.confidence) && (
                              <span className="badge" style={{
                                background: 'rgba(255,255,255,0.08)',
                                color: confidenceColor(confidenceLabel(r.mapping.confidence)),
                                border: `1px solid ${confidenceColor(confidenceLabel(r.mapping.confidence))}33`,
                              }}>
                                AI {Math.round(r.mapping.confidence * 100)}%
                              </span>
                            )}
                            {r.file.status === 'processing' && (
                              <span className="badge" style={{ background: 'rgba(45,212,191,0.15)', color: '#2dd4bf' }}>
                                Processing
                              </span>
                            )}
                            {r.file.status === 'error' && (
                              <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                                Error
                              </span>
                            )}
                          </div>
                          
                          <FileStages file={r.file} mapping={r.mapping} progress={fileProgress[r.file.id]} />
                        </div>

                        {/* Processing — show live progress */}
                        {r.file.status === 'processing' && fileProgress[r.file.id] && (
                          <ProcessingOverlay progress={fileProgress[r.file.id]} />
                        )}

                        {/* Mapped / Review — show mapping editor */}
                        {r.mapping && !r.mapping.target_table.toLowerCase().startsWith('unknown') && r.file.status !== 'processing' && (
                          <MappingResult mapping={r.mapping} filename={r.file.filename} fileId={r.file.id} />
                        )}

                        {/* Error — show error + retry button */}
                        {r.file.status === 'error' && (
                          <div className="mapping-failed mt-3" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                              <AlertCircle className="text-error" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                              <div>
                                <h4>Mapping Failed ({r.file.filename})</h4>
                                <p>AI could not determine schema structure for this file.</p>
                                {String(fileProgress[r.file.id]?.data?.reasoning || '') !== '' && (
                                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                                    &ldquo;{String(fileProgress[r.file.id].data?.reasoning)}&rdquo;</p>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleRetry(r.file.id)}
                              disabled={reprocessing.has(r.file.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.5rem 1rem',
                                borderRadius: '6px',
                                border: '1px solid rgba(45, 212, 191, 0.3)',
                                background: 'rgba(45, 212, 191, 0.1)',
                                color: '#2dd4bf',
                                cursor: reprocessing.has(r.file.id) ? 'wait' : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <RefreshCw size={14} className={reprocessing.has(r.file.id) ? 'spinner' : ''} />
                              {reprocessing.has(r.file.id) ? 'Retrying...' : 'Retry'}
                            </button>
                          </div>
                        )}

                        {/* No mapping found but not processing or error — stale state */}
                        {(!r.mapping || r.mapping.target_table.toLowerCase().startsWith('unknown')) && r.file.status !== 'processing' && r.file.status !== 'error' && r.file.status !== 'imported' && (
                          <div className="mapping-failed mt-3">
                            <AlertCircle className="text-error" size={20} />
                            <div>
                              <h4>Awaiting Mapping ({r.file.filename})</h4>
                              <p>File uploaded but mapping result is not available.</p>
                              <button
                                onClick={() => handleRetry(r.file.id)}
                                disabled={reprocessing.has(r.file.id)}
                                style={{
                                  marginTop: '0.5rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  padding: '0.4rem 0.8rem',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(45, 212, 191, 0.3)',
                                  background: 'rgba(45, 212, 191, 0.1)',
                                  color: '#2dd4bf',
                                  cursor: 'pointer',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                }}
                              >
                                <RefreshCw size={12} /> Process Now
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
