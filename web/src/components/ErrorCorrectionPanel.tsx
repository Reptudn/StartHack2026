import type { UploadedFile, FileError } from './FileUpload'

interface ErrorCorrectionPanelProps {
  file: UploadedFile
  onClose: () => void
  onResolve: (fileId: string, errorId: string, action: 'accepted' | 'rejected') => void
}

export default function ErrorCorrectionPanel({ file, onClose, onResolve }: ErrorCorrectionPanelProps) {
  const pendingErrors = file.errors.filter(e => e.resolved === 'pending')
  const resolvedErrors = file.errors.filter(e => e.resolved !== 'pending')

  return (
    <div className="error-panel">
      <div className="error-panel-header">
        <div className="error-panel-title">
          <h2>🔧 Error Correction</h2>
          <span className="error-panel-filename">{file.name}</span>
        </div>
        <button className="btn-close-panel" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      {file.errors.length === 0 ? (
        <div className="empty-state">
          <p>No errors found in this file</p>
        </div>
      ) : (
        <table className="error-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Column</th>
              <th>Original Value</th>
              <th>Suggested Correction</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pendingErrors.map((error) => (
              <ErrorRow
                key={error.id}
                error={error}
                fileId={file.id}
                onResolve={onResolve}
              />
            ))}
            {resolvedErrors.map((error) => (
              <ErrorRow
                key={error.id}
                error={error}
                fileId={file.id}
                onResolve={onResolve}
              />
            ))}
          </tbody>
        </table>
      )}

      {pendingErrors.length === 0 && resolvedErrors.length > 0 && (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--success)', fontWeight: 600 }}>
          ✓ All errors have been reviewed
        </div>
      )}
    </div>
  )
}

function ErrorRow({
  error,
  fileId,
  onResolve,
}: {
  error: FileError
  fileId: string
  onResolve: (fileId: string, errorId: string, action: 'accepted' | 'rejected') => void
}) {
  return (
    <tr className={error.resolved !== 'pending' ? 'resolved' : ''}>
      <td>#{error.row}</td>
      <td>{error.column}</td>
      <td>
        <span className="original-value">{error.originalValue}</span>
      </td>
      <td>
        <span className="suggested-value">{error.suggestedValue}</span>
      </td>
      <td>
        {error.resolved === 'pending' ? (
          <div className="error-actions">
            <button
              className="btn-accept"
              onClick={() => onResolve(fileId, error.id, 'accepted')}
            >
              ✓ Accept
            </button>
            <button
              className="btn-reject"
              onClick={() => onResolve(fileId, error.id, 'rejected')}
            >
              ✗ Reject
            </button>
          </div>
        ) : error.resolved === 'accepted' ? (
          <span className="btn-accepted">✓ Accepted</span>
        ) : (
          <span className="btn-rejected">✗ Rejected</span>
        )}
      </td>
    </tr>
  )
}
