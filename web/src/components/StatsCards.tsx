interface StatsCardsProps {
  totalFiles: number
  validFiles: number
  errorFiles: number
}

export default function StatsCards({ totalFiles, validFiles, errorFiles }: StatsCardsProps) {
  return (
    <div className="stats-row">
      <div className="stat-card">
        <div className="stat-info">
          <span className="stat-label">Total Files</span>
          <span className="stat-value">{totalFiles}</span>
        </div>
        <div className="stat-icon blue">📁</div>
      </div>

      <div className="stat-card">
        <div className="stat-info">
          <span className="stat-label">Valid Files</span>
          <span className="stat-value">{validFiles}</span>
        </div>
        <div className="stat-icon green">✓</div>
      </div>

      <div className="stat-card">
        <div className="stat-info">
          <span className="stat-label">Errors Found</span>
          <span className="stat-value">{errorFiles}</span>
        </div>
        <div className="stat-icon red">⚠</div>
      </div>
    </div>
  )
}
