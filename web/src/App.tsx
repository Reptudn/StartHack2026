import { useState, useCallback } from 'react'
import './App.css'
import FileUpload from './components/FileUpload'
import StatsCards from './components/StatsCards'
import DataQualityTable from './components/DataQualityTable'
import ErrorCorrectionPanel from './components/ErrorCorrectionPanel'
import type { UploadedFile, FileError } from './components/FileUpload'

// Simulate validation of uploaded files with realistic healthcare data errors
function simulateValidation(file: File): UploadedFile {
  const id = crypto.randomUUID()
  const ext = file.name.split('.').pop()?.toLowerCase() || ''

  // Simulate different validation outcomes
  const rand = Math.random()
  let status: UploadedFile['status']
  let errorCount: number
  let completeness: number
  let errors: FileError[] = []
  let columnsMapped: string[] = []

  if (ext === 'csv' || ext === 'xlsx') {
    columnsMapped = ['patient_id', 'case_id', 'timestamp', 'value'].slice(0, 2 + Math.floor(Math.random() * 3))
  } else if (ext === 'pdf') {
    columnsMapped = ['extracted_text']
  } else {
    columnsMapped = ['raw_data']
  }

  if (rand < 0.3) {
    status = 'valid'
    errorCount = 0
    completeness = 85 + Math.floor(Math.random() * 16)
  } else if (rand < 0.7) {
    status = 'error'
    errorCount = 1 + Math.floor(Math.random() * 4)
    completeness = 50 + Math.floor(Math.random() * 35)

    const errorTypes = [
      { column: 'patient_id', original: 'NULL', suggested: 'P-00142', row: 12 },
      { column: 'case_id', original: 'CASE-0135', suggested: '135', row: 24 },
      { column: 'Natrium', original: 'unknow', suggested: '141 mmol/L', row: 7 },
      { column: 'eGFR', original: 'N/A', suggested: '85.2 ml/min', row: 31 },
      { column: 'CRP', original: 'Missing', suggested: '3.2 mg/L', row: 45 },
      { column: 'timestamp', original: '2024-13-42', suggested: '2024-01-15', row: 8 },
      { column: 'medication_name', original: '', suggested: 'Ibuprofen 400mg', row: 19 },
      { column: 'fall_event_0_1', original: '2', suggested: '1', row: 102 },
    ]

    for (let i = 0; i < errorCount; i++) {
      const template = errorTypes[Math.floor(Math.random() * errorTypes.length)]
      errors.push({
        id: crypto.randomUUID(),
        column: template.column,
        row: template.row + i * 10,
        originalValue: template.original,
        suggestedValue: template.suggested,
        resolved: 'pending',
      })
    }
  } else {
    status = 'warning'
    errorCount = 1
    completeness = 70 + Math.floor(Math.random() * 20)
    errors.push({
      id: crypto.randomUUID(),
      column: 'case_id',
      row: 3,
      originalValue: '  0135  ',
      suggestedValue: '135',
      resolved: 'pending',
    })
  }

  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type || ext,
    status,
    errorCount,
    completeness,
    columnsMapped,
    errors,
  }
}

type NavPage = 'dashboard' | 'upload' | 'quality' | 'settings'

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [activePage, setActivePage] = useState<NavPage>('dashboard')

  const handleFilesUploaded = useCallback((newFiles: File[]) => {
    const validated = newFiles.map(simulateValidation)
    setFiles((prev) => [...prev, ...validated])
  }, [])

  const handleFixClick = useCallback((fileId: string) => {
    setSelectedFileId((prev) => (prev === fileId ? null : fileId))
  }, [])

  const handleResolveError = useCallback(
    (fileId: string, errorId: string, action: 'accepted' | 'rejected') => {
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
            <span className="nav-icon">💡</span>
            <span>v1.0.0</span>
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
