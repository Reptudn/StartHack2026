const API_URL = import.meta.env.VITE_API_URL || '__VITE_API_URL_PLACEHOLDER__'

// ========== Types ==========

export interface ColumnMapping {
  file_column: string
  db_column: string
  confidence: string
}

export interface MLMapping {
  target_table: string
  column_mappings: ColumnMapping[]
  unmapped_columns: string[]
}

export interface ApiFile {
  id: number
  filename: string
  file_type: string
  file_size_bytes: number
  uploaded_at: string
  status: string
  row_count: number
  columns_mapped: string[]
  mapping_result: string
}

export interface ApiUploadResponse {
  file: ApiFile
  mapping?: MLMapping
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

export async function getFiles(): Promise<ApiFile[]> {
  const res = await fetch(`${API_URL}/api/files`)
  if (!res.ok) throw new Error('Failed to fetch files')
  return res.json()
}

export async function deleteFile(fileId: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/${fileId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete file')
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
