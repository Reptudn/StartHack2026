let API_URL = '__VITE_API_URL_PLACEHOLDER__';
if (API_URL.includes('PLACEHOLDER')) {
  API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
}

// ========== Types ==========

export interface ColumnMapping {
  file_column: string
  db_column: string
  confidence: 'manual' | 'high' | 'medium' | 'low'
}

export interface MLMapping {
  target_table: string
  confidence: number
  reasoning: string
  column_mappings: ColumnMapping[]
  unmapped_columns: string[]
  row_count: number
  low_confidence: boolean
  cache_hit: boolean
}

export interface ApiFile {
  id: number
  filename: string
  file_type: string
  file_size_bytes: number
  uploaded_at: string
  status: string
  processing_step: 'extracting' | 'inspecting' | 'classifying' | 'mapping' | 'completed' | 'failed'
  row_count: number
  mapping_result: string
  saved_path?: string
  job_id?: string
  
  // Quality Metrics (optional, populated by validation)
  quality_score?: number
  completeness?: number
  accuracy?: number
  consistency?: number
  timeliness?: number
  error_count?: number
}

export interface ValidationError {
  id: number
  file_id: number
  row_number: number
  column_name: string
  error_type: string
  severity: 'error' | 'warning' | 'info'
  original_value: string
  suggested_value: string
  manual_value: string
  resolved: string
}

export interface ValidationResponse {
  file: ApiFile
  errors: ValidationError[]
}

export interface MappingDiagnosticError {
  type: string
  severity: 'error' | 'warning' | 'info'
  message: string
  file_column?: string
  db_column?: string
  target_table?: string
}

export interface MappingDiagnosticsResponse {
  file: ApiFile
  file_columns: string[]
  target_table: string
  column_mappings: ColumnMapping[]
  errors: MappingDiagnosticError[]
}

export interface ApiUploadResponse {
  file: ApiFile
  mapping?: MLMapping
  job_id?: string
}

export interface JobProgress {
  job_id: string
  stage: string      // extract | inspect | classify | map | done | error
  message: string
  percent: number    // 0-100
  timestamp?: number
  data?: Record<string, unknown>  // rich stage-specific detail
}

// ========== API Functions ==========

export async function uploadFiles(files: File[], sample20: boolean = true): Promise<ApiUploadResponse[]> {
  const formData = new FormData()
  files.forEach((f) => formData.append('files', f))
  formData.append('sample20', sample20.toString())

  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Upload failed')
  }

  return res.json()
}

export function subscribeToProgress(
  jobId: string,
  onUpdate: (progress: JobProgress) => void,
  onDone: () => void,
): () => void {
  let closed = false
  let retries = 0
  const maxRetries = 30 // up to ~60s of retries

  const connect = () => {
    if (closed) return
    const es = new EventSource(`${API_URL}/api/jobs/${jobId}/stream`)

    es.addEventListener('progress', (event: MessageEvent) => {
      try {
        const data: JobProgress = JSON.parse(event.data)
        retries = 0 // reset retry counter on successful event
        onUpdate(data)
        // ONLY call onDone when the server explicitly says done/error
        if (data.stage === 'done' || data.stage === 'error') {
          closed = true
          es.close()
          onDone()
        }
      } catch {
        // ignore parse errors from keepalive comments
      }
    })

    es.onerror = () => {
      es.close()
      if (!closed) {
        // Connection lost but job may still be running — reconnect
        retries++
        if (retries <= maxRetries) {
          setTimeout(connect, 2000) // retry after 2s
        } else {
          // Too many retries — give up
          closed = true
          onDone()
        }
      }
    }
  }

  connect()
  return () => { closed = true }
}

export async function getFiles(): Promise<ApiFile[]> {
  const res = await fetch(`${API_URL}/api/files`)
  if (!res.ok) throw new Error('Failed to fetch files')
  return res.json()
}

export interface FileProgress {
  id: number
  status: string
  processing_step: 'extracting' | 'inspecting' | 'classifying' | 'mapping' | 'completed' | 'failed'
}

export async function getFileProgress(fileId: number): Promise<FileProgress> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/progress`)
  if (!res.ok) throw new Error('Failed to fetch file progress')
  return res.json()
}

export async function deleteFile(fileId: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/${fileId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete file')
}

export async function getFileValidation(fileId: number): Promise<ValidationResponse> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/validation`)
  if (!res.ok) throw new Error('Failed to fetch validation data')
  return res.json()
}

export async function getMappingDiagnostics(fileId: number): Promise<MappingDiagnosticsResponse> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/mapping-diagnostics`)
  if (!res.ok) throw new Error('Failed to fetch mapping diagnostics')
  return res.json()
}

export async function resolveValidationError(errorId: number, status: string, manualValue?: string): Promise<ValidationError> {
  const res = await fetch(`${API_URL}/api/validation/${errorId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, manual_value: manualValue })
  })
  if (!res.ok) throw new Error('Failed to resolve validation error')
  return res.json()
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

export interface SchemaTable {
  name: string
  columns: string[]
}

export async function getSchema(): Promise<SchemaTable[]> {
  const res = await fetch(`${API_URL}/api/schema`)
  if (!res.ok) {
    throw new Error('Failed to fetch schema')
  }
  const data = await res.json()
  return data.tables
}

export async function importFile(fileId: number, mapping: MLMapping): Promise<{ message: string; rows_inserted: number }> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mapping),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to import data')
  }
  return res.json()
}

export async function getJobProgress(jobId: string): Promise<JobProgress | null> {
  try {
    const res = await fetch(`${API_URL}/api/jobs/${jobId}`)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function reprocessFile(fileId: number): Promise<{ job_id: string }> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/reprocess`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to reprocess file')
  }
  return res.json()
}

export interface TableRow {
  id: number
  [key: string]: unknown
}

export interface TableDataResponse {
  table: string
  rows: TableRow[]
  total: number
  page: number
  page_size: number
}

export async function getTableData(
  tableName: string,
  options?: { page?: number; limit?: number }
): Promise<TableDataResponse> {
  const params = new URLSearchParams()
  if (options?.page) params.set('page', options.page.toString())
  if (options?.limit) params.set('limit', options.limit.toString())
  
  const res = await fetch(`${API_URL}/api/tables/${tableName}/data?${params}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to fetch table data')
  }
  return res.json()
}

export async function updateTableRow(
  tableName: string,
  rowId: number,
  data: Record<string, unknown>
): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/api/tables/${tableName}/rows/${rowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to update row')
  }
  return res.json()
}

export async function deleteTableRow(
  tableName: string,
  rowId: number
): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/api/tables/${tableName}/rows/${rowId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to delete row')
  }
  return res.json()
}
}
