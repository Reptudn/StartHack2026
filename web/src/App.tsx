import { useState, useCallback, useEffect } from 'react'
import './App.css'
import MappingResult from './components/MappingResult'
import {
  uploadFiles as apiUpload,
  getFiles,
  healthCheck,
} from './api'
import type { ApiFile, ApiUploadResponse, MLMapping } from './api'

interface UploadResult {
  file: ApiFile
  mapping?: MLMapping
}

interface Toast {
  message: string
  type: 'success' | 'error' | 'info'
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

export default function App() {
  const [results, setResults] = useState<UploadResult[]>([])
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [sample20, setSample20] = useState(true)
  const [uploadStage, setUploadStage] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = (message: string, type: Toast['type']) => {
    const id = Date.now()
    setToasts(prev => [...prev, { message, type, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }

  useEffect(() => {
    healthCheck().then((online) => {
      setIsBackendOnline(online)
      if (online) {
        loadFiles()
      }
    })
  }, [])

  const loadFiles = async () => {
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
  }

  const handleFilesUploaded = useCallback(async (newFiles: File[]) => {
    if (!isBackendOnline) {
      addToast('Backend is offline. Please start the services.', 'error')
      return
    }

    const fileNames = newFiles.map(f => f.name)
    setUploadingFiles(fileNames)
    setIsUploading(true)
    setUploadStage('Uploading files...')

    try {
      // Stage updates for user feedback
      setTimeout(() => setUploadStage('Parsing file contents...'), 800)
      setTimeout(() => setUploadStage('🧠 AI is analyzing columns...'), 1600)
      setTimeout(() => setUploadStage('Mapping to database schema...'), 3000)

      const uploadResults: ApiUploadResponse[] = await apiUpload(newFiles, sample20)
      const converted: UploadResult[] = uploadResults.map((r) => ({
        file: r.file,
        mapping: r.mapping,
      }))
      setResults((prev) => [...converted, ...prev])

      const mappedCount = converted.filter(r => r.mapping && !r.mapping.target_table.startsWith('unknown')).length
      if (mappedCount === converted.length) {
        addToast(`✅ Successfully mapped ${mappedCount} file${mappedCount > 1 ? 's' : ''} to the database schema!`, 'success')
      } else if (mappedCount > 0) {
        addToast(`Mapped ${mappedCount}/${converted.length} files. Some files could not be mapped.`, 'info')
      } else {
        addToast('Files uploaded but mapping failed. Check if Ollama is running.', 'error')
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
    <div className="app">
      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span>{toast.message}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>✕</button>
          </div>
        ))}
      </div>

      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">🏥</span>
            <h1>HealthMap</h1>
          </div>
          <p className="subtitle">AI-Powered Health Data Mapping</p>
          <div className="status-indicator">
            <span className={`status-dot ${isBackendOnline === true ? 'online' : isBackendOnline === false ? 'offline' : 'checking'}`} />
            <span>{isBackendOnline === true ? 'Connected' : isBackendOnline === false ? 'Offline' : 'Checking...'}</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="upload-section">
          <div className="upload-options" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <input 
                type="checkbox" 
                checked={sample20} 
                onChange={e => setSample20(e.target.checked)} 
                disabled={isUploading} 
                style={{ accentColor: 'var(--accent)', width: '16px', height: '16px', cursor: 'inherit' }} 
              />
              Sample 20% of rows for AI (Saves tokens & time)
            </label>
          </div>
          <div
            className={`upload-zone ${isDragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false) }}
            onDrop={handleDrop}
            onClick={() => !isUploading && document.getElementById('file-input')?.click()}
          >
            {isUploading ? (
              <div className="upload-progress">
                <div className="upload-spinner" />
                <p className="upload-stage">{uploadStage}</p>
                <div className="uploading-files">
                  {uploadingFiles.map((name, i) => (
                    <span key={i} className="uploading-file-chip">📄 {name}</span>
                  ))}
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" />
                </div>
              </div>
            ) : (
              <>
                <div className="upload-icon">📄</div>
                <p className="upload-text">
                  Drop your data file here or <strong>click to browse</strong>
                </p>
                <p className="upload-hint">AI will automatically map your columns to the database schema</p>
                <div className="upload-formats">
                  <span className="format-badge">CSV</span>
                  <span className="format-badge">TSV</span>
                  <span className="format-badge">TXT</span>
                  <span className="format-badge">XLSX</span>
                </div>
              </>
            )}
            <input
              id="file-input"
              type="file"
              className="upload-input"
              multiple
              accept=".csv,.xlsx,.xls,.tsv,.txt"
              onChange={handleFileInput}
            />
          </div>
        </section>

        {results.length > 0 && (
          <section className="results-section">
            <h2>📊 Mapping Results ({results.length})</h2>
            <div className="results-list">
              {results.map((r) => (
                <div key={r.file.id} className="result-card">
                  {/* File metadata bar */}
                  <div className="file-meta-bar">
                    <div className="file-meta-item">
                      <span className="meta-label">Type</span>
                      <span className="meta-value">{r.file.file_type.toUpperCase()}</span>
                    </div>
                    <div className="file-meta-item">
                      <span className="meta-label">Size</span>
                      <span className="meta-value">{formatFileSize(r.file.file_size_bytes)}</span>
                    </div>
                    <div className="file-meta-item">
                      <span className="meta-label">Rows</span>
                      <span className="meta-value">{r.file.row_count.toLocaleString()}</span>
                    </div>
                    <div className="file-meta-item">
                      <span className="meta-label">Uploaded</span>
                      <span className="meta-value">{formatDate(r.file.uploaded_at)}</span>
                    </div>
                    <div className="file-meta-item">
                      <span className="meta-label">Status</span>
                      <span className={`meta-status ${r.file.status}`}>{r.file.status}</span>
                    </div>
                  </div>

                  {r.mapping && !r.mapping.target_table.startsWith('unknown') ? (
                    <MappingResult mapping={r.mapping} filename={r.file.filename} fileId={r.file.id} />
                  ) : (
                    <div className="mapping-result error">
                      <div className="mapping-header">
                        <div className="mapping-title">
                          <span className="mapping-icon">⚠️</span>
                          <div>
                            <h3>Mapping Failed</h3>
                            <p className="mapping-filename">{r.file.filename}</p>
                          </div>
                        </div>
                      </div>
                      <p style={{ padding: '1rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        The AI could not determine a mapping. Make sure Ollama is running with the correct model.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
