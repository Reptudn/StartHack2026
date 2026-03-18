import { useRef, useState, useCallback } from 'react'

export interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  status: 'processing' | 'valid' | 'error' | 'warning'
  errorCount: number
  completeness: number
  columnsMapped: string[]
  errors: FileError[]
}

export interface FileError {
  id: string
  column: string
  row: number
  originalValue: string
  suggestedValue: string
  resolved: 'pending' | 'accepted' | 'rejected'
}

interface FileUploadProps {
  files: UploadedFile[]
  onFilesUploaded: (files: File[]) => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function getStatusIcon(status: UploadedFile['status']): string {
  switch (status) {
    case 'valid': return '✓'
    case 'error': return '✗'
    case 'warning': return '⚠'
    case 'processing': return '⟳'
  }
}

function getStatusLabel(status: UploadedFile['status']): string {
  switch (status) {
    case 'valid': return 'Valid'
    case 'error': return 'Errors'
    case 'warning': return 'Warning'
    case 'processing': return 'Processing'
  }
}

export default function FileUpload({ files, onFilesUploaded }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length > 0) {
      onFilesUploaded(droppedFiles)
    }
  }, [onFilesUploaded])

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length > 0) {
      onFilesUploaded(selectedFiles)
    }
    e.target.value = ''
  }

  return (
    <div className="upload-section">
      <div className="upload-section-header">
        <h2>📤 File Upload</h2>
      </div>

      <div
        className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label="Upload files by dropping or clicking"
      >
        <div className="upload-icon">☁️</div>
        <p className="upload-text">
          Drop your files here or <strong>click to browse</strong>
        </p>
        <div className="upload-formats">
          <span className="format-badge">CSV</span>
          <span className="format-badge">XLSX</span>
          <span className="format-badge">PDF</span>
          <span className="format-badge">TXT</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="upload-input"
          multiple
          accept=".csv,.xlsx,.xls,.pdf,.txt"
          onChange={handleFileInput}
        />
      </div>

      {files.length > 0 && (
        <div className="file-list">
          <div className="file-list-header">
            <h3>Uploaded Files ({files.length})</h3>
          </div>
          {files.map((file) => (
            <div key={file.id} className="file-item">
              <span className="file-icon">📄</span>
              <div className="file-details">
                <div className="file-name">{file.name}</div>
                <div className="file-size">{formatFileSize(file.size)}</div>
              </div>
              <span className={`file-status ${file.status}`}>
                {getStatusIcon(file.status)} {getStatusLabel(file.status)}
                {file.status === 'error' && ` (${file.errorCount})`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
