const API_URL = import.meta.env.VITE_API_URL || '__VITE_API_URL_PLACEHOLDER__'

// ========== Types ==========

export interface ApiFile {
  id: number
  filename: string
  file_type: string
  file_size_bytes: number
  uploaded_at: string
  quality_score: number
  completeness: number
  accuracy: number
  consistency: number
  timeliness: number
  status: string
  row_count: number
  error_count: number
  columns_mapped: string[]
}

export interface ApiError {
  id: number
  file_id: number
  row_number: number
  column_name: string
  error_type: string
  severity: string
  original_value: string
  suggested_value: string
  resolved: string
  resolved_at: string | null
}

export interface ApiUploadResponse {
  file: ApiFile
  errors: ApiError[]
}

export interface ApiStats {
  total_files: number
  valid_files: number
  error_files: number
  total_rows: number
  total_errors: number
}

// ========== API Functions ==========

export async function uploadFiles(files: File[]): Promise<ApiUploadResponse[]> {
  const formData = new FormData()
  files.forEach((f) => formData.append('files', f))

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

export async function getFileErrors(fileId: number): Promise<ApiError[]> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/errors`)
  if (!res.ok) throw new Error('Failed to fetch errors')
  return res.json()
}

export async function resolveError(
  fileId: number,
  errorId: number,
  action: 'accepted' | 'rejected'
): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/errors/${errorId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error('Failed to resolve error')
}

export async function deleteFile(fileId: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/${fileId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete file')
}

export async function getStats(): Promise<ApiStats> {
  const res = await fetch(`${API_URL}/api/stats`)
  if (!res.ok) throw new Error('Failed to fetch stats')
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
