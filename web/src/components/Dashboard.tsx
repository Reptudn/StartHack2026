import { useState, useCallback, useEffect } from 'react'
import MappingResult from './MappingResult'
import { uploadFiles as apiUpload, getFiles, healthCheck } from '../api'
import type { ApiFile, ApiUploadResponse, MLMapping } from '../api'
import './Dashboard.css'
import { Activity, LayoutDashboard, FolderOpen, UploadCloud, FileText, AlertCircle, Bell, Search, ChevronDown } from 'lucide-react';

interface UploadResult {
  file: ApiFile
  mapping?: MLMapping
}

interface Toast {
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  id: number
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

// Subcomponent for Stages
function FileStages({ file, mapping }: { file: ApiFile, mapping?: MLMapping }) {
  const isMapped = mapping && !mapping.target_table.startsWith('unknown');
  const isFailed = file.status === 'failed' || (mapping && mapping.target_table.startsWith('unknown'));
  
  const stages = [
    { name: 'Extract', active: true, error: false },
    { name: 'Inspect', active: true, error: false },
    { name: 'Classify', active: isMapped, error: isFailed },
    { name: 'Map', active: isMapped, error: isFailed },
    { name: 'Import', active: isMapped, error: isFailed },
  ];

  return (
    <div className="file-stages">
      {stages.map((st, i) => (
        <span 
          key={i} 
          className={`stage-pill ${st.active ? 'active' : ''} ${st.error ? 'error' : ''}`}
          title={st.name}
        >
          {st.name}
        </span>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [results, setResults] = useState<UploadResult[]>([])
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [sample20, setSample20] = useState(true)
  const [uploadStage, setUploadStage] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

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
    } catch (err) {
      console.error('Failed to load files:', err)
    }
  }, [])

  useEffect(() => {
    healthCheck().then((online) => {
      setIsBackendOnline(online)
      if (online) loadFiles()
    })
  }, [loadFiles])

  const handleFilesUploaded = useCallback(async (newFiles: File[]) => {
    if (!isBackendOnline) {
      addToast('Backend is offline. Please check services.', 'error')
      return
    }

    const fileNames = newFiles.map(f => f.name)
    setUploadingFiles(fileNames)
    setIsUploading(true)
    setUploadStage('Initiating upload...')

    try {
      setTimeout(() => setUploadStage('Parsing contents...'), 800)
      setTimeout(() => setUploadStage('AI analyzing columns...'), 1600)
      setTimeout(() => setUploadStage('Mapping to schema...'), 3000)

      const uploadResults: ApiUploadResponse[] = await apiUpload(newFiles, sample20)

      const converted: UploadResult[] = uploadResults.map((r) => ({
        file: r.file,
        mapping: r.mapping,
      }))
      setResults((prev) => [...converted, ...prev])

      const mappedCount = converted.filter(r => r.mapping && !r.mapping.target_table.startsWith('unknown')).length
      if (mappedCount === converted.length) {
        addToast(`Successfully mapped ${mappedCount} file(s)!`, 'success')
      } else if (mappedCount > 0) {
        addToast(`Mapped ${mappedCount}/${converted.length} files.`, 'info')
      } else {
        addToast('Upload complete, mapping failed.', 'error')
      }
    } catch (err) {
      console.error('Upload failed:', err)
      addToast('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error')
    } finally {
      setIsUploading(false)
      setUploadStage('')
      setUploadingFiles([])
    }
  }, [isBackendOnline, sample20])

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
                    <p className="stat-value">{results.filter(r => r.mapping && !r.mapping.target_table.startsWith('unknown')).length}</p>
                    <div className="stat-accent bg-indigo" />
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
                            <FileStages file={r.file} mapping={r.mapping} />
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
                      <p className="upload-stage">{uploadStage}</p>
                      <div className="file-chips">
                        {uploadingFiles.map((name, i) => (
                          <span key={i} className="chip">{name}</span>
                        ))}
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill animated-gradient" />
                      </div>
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
                          </div>
                          
                          <FileStages file={r.file} mapping={r.mapping} />

                        </div>

                        {r.mapping && !r.mapping.target_table.startsWith('unknown') ? (
                          <MappingResult mapping={r.mapping} filename={r.file.filename} fileId={r.file.id} />
                        ) : (
                          <div className="mapping-failed mt-3">
                            <AlertCircle className="text-error" size={20} />
                            <div>
                              <h4>Mapping Failed ({r.file.filename})</h4>
                              <p>AI could not determine schema structure for this file.</p>
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
