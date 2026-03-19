import { useState, useCallback, useEffect } from 'react'
import MappingResult from './MappingResult'
import { uploadFiles as apiUpload, getFiles, healthCheck } from '../api'
import type { ApiFile, ApiUploadResponse, MLMapping } from '../api'
import './Dashboard.css'
import { Activity, LayoutDashboard, FolderOpen, UploadCloud, Settings, Users, UserPlus, FileText, AlertCircle, Bell, Search, ChevronDown } from 'lucide-react';

interface UploadResult {
  file: ApiFile
  mapping?: MLMapping
}

interface Toast {
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  id: number
}

interface Patient {
  id: string;
  name: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
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

  // --- External State ---
  const [patients, setPatients] = useState<Patient[]>([])
  const [activePatientId, setActivePatientId] = useState<string | null>(null)
  const [isAddingPatient, setIsAddingPatient] = useState(false)
  const [newPatientName, setNewPatientName] = useState('')

  // --- Tab State ---
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'upload'>('overview')

  useEffect(() => {
    // Load patients from local storage
    const stored = localStorage.getItem('healthmap_patients')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setPatients(parsed)
        if (parsed.length > 0) setActivePatientId(parsed[0].id)
      } catch { console.error('Failed to parse patients') }
    }
  }, [])

  const addPatient = () => {
    if (!newPatientName.trim()) return
    const newPatient = { id: Date.now().toString(), name: newPatientName.trim() }
    const updated = [...patients, newPatient]
    setPatients(updated)
    localStorage.setItem('healthmap_patients', JSON.stringify(updated))
    setActivePatientId(newPatient.id)
    setIsAddingPatient(false)
    setNewPatientName('')
  }

  const getPatientFiles = () => {
    const stored = localStorage.getItem('healthmap_patient_files')
    return stored ? JSON.parse(stored) : {} // { [fileId]: patientId }
  }

  const assignFilesToPatient = useCallback((fileIds: number[], patientId: string) => {
    const map = getPatientFiles()
    fileIds.forEach(id => map[id] = patientId)
    localStorage.setItem('healthmap_patient_files', JSON.stringify(map))
  }, [])

  const addToast = (message: string, type: Toast['type']) => {
    const id = Date.now()
    setToasts(prev => [...prev, { message, type, id }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  const loadFiles = useCallback(async () => {
    try {
      const apiFiles = await getFiles()
      const patientFilesMap = getPatientFiles()
      const filteredFiles = apiFiles.filter(f => patientFilesMap[f.id] === activePatientId)

      const converted: UploadResult[] = filteredFiles.map((f) => {
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
  }, [activePatientId])

  useEffect(() => {
    healthCheck().then((online) => {
      setIsBackendOnline(online)
      if (online) loadFiles()
    })
  }, [activePatientId, loadFiles])

  const handleFilesUploaded = useCallback(async (newFiles: File[]) => {
    if (!isBackendOnline) {
      addToast('Backend is offline. Please check services.', 'error')
      return
    }
    if (!activePatientId) {
      addToast('Please select a patient first.', 'warning')
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
      assignFilesToPatient(uploadResults.map(r => r.file.id), activePatientId)

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
  }, [isBackendOnline, sample20, activePatientId, assignFilesToPatient])

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

  const activePatientName = patients.find(p => p.id === activePatientId)?.name || 'Guest'

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
            <button className="nav-item">
              <Settings size={18} />
              <span>Settings</span>
            </button>
          </div>

          <div className="nav-divider" />

          {/* Patients Menu in Sidebar */}
          <div className="patient-menu">
            <div className="patient-menu-title">
              <Users size={16} /> Patients
            </div>
            
            <ul className="patient-list">
              {patients.map(p => (
                <li 
                  key={p.id} 
                  className={`patient-item ${activePatientId === p.id ? 'active' : ''}`}
                  onClick={() => setActivePatientId(p.id)}
                >
                  {p.name}
                </li>
              ))}
            </ul>
            
            {isAddingPatient ? (
              <div className="add-patient-form">
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Patient Name" 
                  value={newPatientName}
                  onChange={e => setNewPatientName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPatient()}
                />
                <div className="add-actions">
                  <button className="btn-save" onClick={addPatient}>Save</button>
                  <button className="btn-cancel" onClick={() => setIsAddingPatient(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn-add-patient" onClick={() => setIsAddingPatient(true)}>
                <UserPlus size={16} /> Add Person
              </button>
            )}
          </div>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="dashboard-main">
        {/* Top Header Bar */}
        <header className="dashboard-topbar">
          <div className="topbar-greeting">
             <h2>Good Morning, Dr. Staff</h2>
             <p>Viewing records for {activePatientName}</p>
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

        {activePatientId ? (
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
                             <span className={`status-badge ${r.mapping && !r.mapping.target_table.startsWith('unknown') ? 'success' : 'error'}`}>
                               {r.mapping && !r.mapping.target_table.startsWith('unknown') ? 'Mapped' : 'Failed'}
                             </span>
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
                          <div className="record-meta">
                            <span className="badge badge-dark">{r.file.file_type.toUpperCase()}</span>
                            <span className="meta-text">{formatFileSize(r.file.file_size_bytes)}</span>
                            <span className="meta-text">{r.file.row_count.toLocaleString()} rows</span>
                            <span className="meta-text">{formatDate(r.file.uploaded_at)}</span>
                          </div>

                          {r.mapping && !r.mapping.target_table.startsWith('unknown') ? (
                            <MappingResult mapping={r.mapping} filename={r.file.filename} fileId={r.file.id} />
                          ) : (
                            <div className="mapping-failed">
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
        ) : (
          <div className="dashboard-content fade-in">
             <div className="empty-state large">
               <Users size={64} className="text-muted" />
               <h2>Guest Mode</h2>
               <p>Please select a patient from the sidebar or add a new one to begin managing records.</p>
             </div>
          </div>
        )}
      </main>
    </div>
  )
}
