import React, { useState, useEffect } from 'react'
import type { MLMapping, SchemaTable } from '../api'
import { getSchema, importFile } from '../api'
import { BrainCircuit, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

interface MappingResultProps {
  mapping: MLMapping
  filename: string
  fileId: number
}

export default function MappingResult({ mapping, filename, fileId }: MappingResultProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedMapping, setEditedMapping] = useState<MLMapping>(mapping)
  const [schemas, setSchemas] = useState<SchemaTable[]>([])
  
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [importMessage, setImportMessage] = useState('')

  useEffect(() => {
    if (isEditing && schemas.length === 0) {
      getSchema().then(setSchemas).catch((err: Error | unknown) => {
        console.error("Failed to load schema:", err)
      })
    }
  }, [isEditing, schemas.length])

  const columnMappings = editedMapping.column_mappings ?? []
  const unmappedColumns = editedMapping.unmapped_columns ?? []
  const highCount = columnMappings.filter(m => m.confidence === 'high').length
  const totalMapped = columnMappings.length
  const totalUnmapped = unmappedColumns.length

  const handleTableChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setEditedMapping(prev => ({ ...prev, target_table: e.target.value }))
  }

  const handleColumnChange = (fileCol: string, newDbCol: string) => {
    setEditedMapping(prev => ({
      ...prev,
      column_mappings: (prev.column_mappings ?? []).map(cm =>
        cm.file_column === fileCol ? { ...cm, db_column: newDbCol, confidence: 'manual' } : cm
      )
    }))
  }

  const handleApprove = async () => {
    setIsImporting(true)
    setImportStatus('idle')
    try {
      const res = await importFile(fileId, editedMapping)
      setImportStatus('success')
      setImportMessage(`Successfully imported ${res.rows_inserted} rows!`)
      setIsEditing(false)
    } catch (err) {
      setImportStatus('error')
      setImportMessage(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsImporting(false)
    }
  }

  const currentSchema = schemas.find(s => s.name === editedMapping.target_table)

  return (
    <div className="mapping-result">
      <div className="mapping-header" style={{ alignItems: 'flex-start' }}>
        <div className="mapping-title">
          <div className="mapping-icon-bg" style={{ background: 'rgba(139, 92, 246, 0.1)', padding: '0.5rem', borderRadius: '8px', display: 'flex' }}>
            <BrainCircuit size={20} color="#8b5cf6" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#e5e5e5' }}>AI Mapping Result</h3>
            <p className="mapping-filename" style={{ color: '#a1a1aa' }}>{filename}</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          {isEditing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Target Table:</span>
              <select 
                value={editedMapping.target_table} 
                onChange={handleTableChange}
                style={{ padding: '0.3rem', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                <option value="unknown">Select a table...</option>
                {schemas.map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="mapping-badge">
              <span className="target-table">{editedMapping.target_table}</span>
            </div>
          )}
          
          {importStatus !== 'success' && (
            <button 
              onClick={() => setIsEditing(!isEditing)} 
              className="btn-secondary"
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
            >
              {isEditing ? 'Cancel Edit' : '✎ Edit Mapping'}
            </button>
          )}
        </div>
      </div>

      <div className="mapping-stats">
        <div className="stat-pill mapped">
          <span className="stat-number">{totalMapped}</span>
          <span className="stat-label">Mapped</span>
        </div>
        <div className="stat-pill high-conf">
          <span className="stat-number">{highCount}</span>
          <span className="stat-label">High/Manual Conf.</span>
        </div>
        <div className="stat-pill unmapped">
          <span className="stat-number">{totalUnmapped}</span>
          <span className="stat-label">Unmapped</span>
        </div>
      </div>

      {totalMapped > 0 && (
        <div className="mapping-table-container">
          <table className="mapping-table">
            <thead>
              <tr>
                <th>File Column</th>
                <th>→</th>
                <th>Database Column</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {columnMappings.map((cm, i) => (
                <tr key={i}>
                  <td className="col-file">{cm.file_column}</td>
                  <td className="col-arrow">→</td>
                  <td className="col-db">
                    {isEditing ? (
                      <select 
                        value={cm.db_column} 
                        onChange={(e) => handleColumnChange(cm.file_column, e.target.value)}
                        style={{ padding: '0.2rem', width: '100%', background: 'transparent', color: 'inherit', border: '1px solid var(--border)' }}
                      >
                        <option value="unknown">-- Ignore --</option>
                        {currentSchema?.columns.map((col: string) => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                        {/* If the current db_column is not in the schema (e.g. AI hallucinated it), still show it so it doesn't break */}
                        {cm.db_column !== 'unknown' && !currentSchema?.columns.includes(cm.db_column) && (
                           <option value={cm.db_column}>{cm.db_column} (Unknown)</option>
                        )}
                      </select>
                    ) : (
                      cm.db_column
                    )}
                  </td>
                  <td>
                    <span className={`confidence-badge ${cm.confidence}`}>
                      {cm.confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalUnmapped > 0 && (
        <div className="unmapped-section">
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#e5e5e5' }}>
            <AlertTriangle size={16} color="#f97316" /> Unmapped Columns 
            {isEditing && <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#a1a1aa' }}>(Cannot be edited currently)</span>}
          </h4>
          <div className="unmapped-chips">
            {unmappedColumns.map((col, i) => (
              <span key={i} className="unmapped-chip" style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', color: '#a1a1aa' }}>{col}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {importMessage && (
          <div style={{ padding: '0.75rem', borderRadius: '6px', background: importStatus === 'success' ? 'rgba(45, 212, 191, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: importStatus === 'success' ? '#2dd4bf' : '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            {importStatus === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {importMessage}
          </div>
        )}
        
        {importStatus !== 'success' && totalMapped > 0 && (
          <button
            onClick={handleApprove}
            disabled={isImporting}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #38bdf8, #2dd4bf)',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              cursor: isImporting ? 'wait' : 'pointer',
              fontWeight: 700,
              fontSize: '1rem',
              alignSelf: 'flex-end',
              opacity: isImporting ? 0.7 : 1,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            {isImporting ? 'Importing Data...' : <><CheckCircle size={18} /> Approve & Import Data</>}
          </button>
        )}
      </div>
    </div>
  )
}
