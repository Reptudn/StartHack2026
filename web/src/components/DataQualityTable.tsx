import type { UploadedFile } from './FileUpload'

interface DataQualityTableProps {
  files: UploadedFile[]
  onFixClick: (fileId: string) => void
  selectedFileId: string | null
}

function getCompletenessLevel(value: number): string {
  if (value >= 80) return 'high'
  if (value >= 50) return 'medium'
  return 'low'
}

export default function DataQualityTable({ files, onFixClick, selectedFileId }: DataQualityTableProps) {
  if (files.length === 0) {
    return (
      <div className="quality-section">
        <div className="quality-section-header">
          <h2>📊 Data Quality</h2>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>Upload files to see data quality analysis</p>
        </div>
      </div>
    )
  }

  return (
    <div className="quality-section">
      <div className="quality-section-header">
        <h2>📊 Data Quality</h2>
      </div>

      <table className="quality-table">
        <thead>
          <tr>
            <th>File Name</th>
            <th>Columns Mapped</th>
            <th>Data Completeness</th>
            <th>Anomalies</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id}>
              <td>{file.name}</td>
              <td>{file.columnsMapped.join(', ')}</td>
              <td>
                <div className="completeness-bar">
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${getCompletenessLevel(file.completeness)}`}
                      style={{ width: `${file.completeness}%` }}
                    />
                  </div>
                  <span className="completeness-value">{file.completeness}%</span>
                </div>
              </td>
              <td>
                <span className={`anomaly-badge ${file.errorCount > 0 ? 'has-anomalies' : 'no-anomalies'}`}>
                  {file.errorCount}
                </span>
              </td>
              <td>
                <button
                  className="btn btn-fix"
                  onClick={() => onFixClick(file.id)}
                  disabled={file.errorCount === 0}
                >
                  {selectedFileId === file.id ? '▼ Close' : '🔧 Fix'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
