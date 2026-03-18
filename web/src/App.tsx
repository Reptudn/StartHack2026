import { useState, useCallback, useEffect } from 'react'
import './App.css'
import FileUpload from './components/FileUpload'
import StatsCards from './components/StatsCards'
import DataQualityTable from './components/DataQualityTable'
import ErrorCorrectionPanel from './components/ErrorCorrectionPanel'
import type { UploadedFile, FileError } from './components/FileUpload'
import {
  uploadFiles as apiUpload,
  getFiles,
  getFileErrors,
  resolveError as apiResolve,
  healthCheck,
} from './api'
import type { ApiFile, ApiError } from './api'

// Convert API types to UI types
function toUploadedFile(f: ApiFile, errors: ApiError[] = []): UploadedFile {
  return {
    id: String(f.id),
    name: f.filename,
    size: f.file_size_bytes,
    type: f.file_type,
    status: f.status as UploadedFile['status'],
    errorCount: f.error_count,
    completeness: f.completeness,
    columnsMapped: f.columns_mapped || [],
    errors: errors.map(toFileError),
  }
}

function toFileError(e: ApiError): FileError {
  return {
    id: String(e.id),
    column: e.column_name,
    row: e.row_number,
    originalValue: e.original_value,
    suggestedValue: e.suggested_value,
    resolved: e.resolved as FileError['resolved'],
  }
}

type NavPage = 'dashboard' | 'upload' | 'quality' | 'settings'

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [activePage, setActivePage] = useState<NavPage>('dashboard')
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  // Check backend health and load files on mount
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
      const converted = apiFiles.map((f) => toUploadedFile(f))
      setFiles(converted)
    } catch (err) {
      console.error('Failed to load files:', err)
    }
  }

  const handleFilesUploaded = useCallback(async (newFiles: File[]) => {
    if (!isBackendOnline) {
      // Fallback: simulate if backend is offline
      console.warn('Backend offline, using simulated data')
      return
    }

    setIsUploading(true)
    try {
      const results = await apiUpload(newFiles)
      const converted = results.map((r) => toUploadedFile(r.file, r.errors))
      setFiles((prev) => [...converted, ...prev])
    } catch (err) {
      console.error('Upload failed:', err)
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setIsUploading(false)
    }
  }, [isBackendOnline])

  const handleFixClick = useCallback(async (fileId: string) => {
    if (selectedFileId === fileId) {
      setSelectedFileId(null)
      return
    }

    // Load errors for this file from the API
    try {
      const errors = await getFileErrors(Number(fileId))
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, errors: errors.map(toFileError) } : f
        )
      )
      setSelectedFileId(fileId)
    } catch (err) {
      console.error('Failed to load errors:', err)
      setSelectedFileId(fileId)
    }
  }, [selectedFileId])

  const handleResolveError = useCallback(
    async (fileId: string, errorId: string, action: 'accepted' | 'rejected') => {
      // Optimistic UI update
      setFiles((prev) =>
        prev.map((file) => {
          if (file.id !== fileId) return file
          const updatedErrors = file.errors.map((err) =>
            err.id === errorId ? { ...err, resolved: action } : err
          )
          const pendingCount = updatedErrors.filter((e) => e.resolved === 'pending').length
          const newStatus: UploadedFile['status'] = pendingCount === 0 ? 'valid' : file.status
          return {
            ...file,
            errors: updatedErrors,
            errorCount: pendingCount,
            status: newStatus,
            completeness: pendingCount === 0 ? Math.min(file.completeness + 10, 100) : file.completeness,
          }
        })
      )

      // Send to API
      try {
        await apiResolve(Number(fileId), Number(errorId), action)
      } catch (err) {
        console.error('Failed to resolve error:', err)
        // Reload files to sync state
        loadFiles()
      }
    },
    []
  )

  const totalFiles = files.length
  const validFiles = files.filter((f) => f.status === 'valid').length
  const errorFiles = files.filter((f) => f.status === 'error' || f.status === 'warning').length

  const selectedFile = files.find((f) => f.id === selectedFileId) || null

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">🏥</div>
          <span className="sidebar-brand">HealthMap</span>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActivePage('dashboard')}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </button>
          <button
            className={`nav-item ${activePage === 'upload' ? 'active' : ''}`}
            onClick={() => setActivePage('upload')}
          >
            <span className="nav-icon">📤</span>
            <span>Upload</span>
          </button>
          <button
            className={`nav-item ${activePage === 'quality' ? 'active' : ''}`}
            onClick={() => setActivePage('quality')}
          >
            <span className="nav-icon">🔍</span>
            <span>Data Quality</span>
          </button>
          <button
            className={`nav-item ${activePage === 'settings' ? 'active' : ''}`}
            onClick={() => setActivePage('settings')}
          >
            <span className="nav-icon">⚙️</span>
            <span>Settings</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="nav-item" style={{ cursor: 'default', opacity: 0.5 }}>
            <span className="nav-icon">{isBackendOnline === false ? '🔴' : isBackendOnline === true ? '🟢' : '⏳'}</span>
            <span>{isBackendOnline === false ? 'Offline' : isBackendOnline === true ? 'Connected' : 'Checking...'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="main-header">
          <div>
            <h1>
              {activePage === 'dashboard' && 'Dashboard'}
              {activePage === 'upload' && 'File Upload'}
              {activePage === 'quality' && 'Data Quality'}
              {activePage === 'settings' && 'Settings'}
            </h1>
            <p className="header-subtitle">Smart Health Data Mapping</p>
          </div>
          {isUploading && (
            <span style={{ color: 'var(--accent-light)', fontSize: '0.9rem' }}>⏳ Uploading...</span>
          )}
        </header>

        <div className="main-body">
          {/* Dashboard View */}
          {activePage === 'dashboard' && (
            <>
              <StatsCards
                totalFiles={totalFiles}
                validFiles={validFiles}
                errorFiles={errorFiles}
              />
              <FileUpload files={files} onFilesUploaded={handleFilesUploaded} />
              <DataQualityTable
                files={files}
                onFixClick={handleFixClick}
                selectedFileId={selectedFileId}
              />
              {selectedFile && (
                <ErrorCorrectionPanel
                  file={selectedFile}
                  onClose={() => setSelectedFileId(null)}
                  onResolve={handleResolveError}
                />
              )}
            </>
          )}

          {/* Upload View */}
          {activePage === 'upload' && (
            <FileUpload files={files} onFilesUploaded={handleFilesUploaded} />
          )}

          {/* Quality View */}
          {activePage === 'quality' && (
            <>
              <DataQualityTable
                files={files}
                onFixClick={handleFixClick}
                selectedFileId={selectedFileId}
              />
              {selectedFile && (
                <ErrorCorrectionPanel
                  file={selectedFile}
                  onClose={() => setSelectedFileId(null)}
                  onResolve={handleResolveError}
                />
              )}
            </>
          )}

          {/* Settings View */}
          {activePage === 'settings' && (
            <div className="quality-section">
              <div className="quality-section-header">
                <h2>⚙️ Settings</h2>
              </div>
              <div className="empty-state">
                <div className="empty-state-icon">🔧</div>
                <p>Settings will be available in a future version</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
