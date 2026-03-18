package models

import "time"

// ========== Database Models ==========

type FileUpload struct {
	ID           int64     `json:"id"`
	Filename     string    `json:"filename"`
	FileType     string    `json:"file_type"`
	FileSizeBytes int64    `json:"file_size_bytes"`
	UploadedAt   time.Time `json:"uploaded_at"`
	QualityScore float64   `json:"quality_score"`
	Completeness float64   `json:"completeness"`
	Accuracy     float64   `json:"accuracy"`
	Consistency  float64   `json:"consistency"`
	Timeliness   float64   `json:"timeliness"`
	Status       string    `json:"status"` // processing, valid, warning, error
	RowCount     int       `json:"row_count"`
	ErrorCount   int       `json:"error_count"`
	ColumnsMapped []string `json:"columns_mapped"`
}

type ValidationError struct {
	ID             int64      `json:"id"`
	FileID         int64      `json:"file_id"`
	RowNumber      int        `json:"row_number"`
	ColumnName     string     `json:"column_name"`
	ErrorType      string     `json:"error_type"` // missing, out_of_range, format, reference, invalid_type
	Severity       string     `json:"severity"`   // error, warning, info
	OriginalValue  string     `json:"original_value"`
	SuggestedValue string     `json:"suggested_value"`
	Resolved       string     `json:"resolved"` // pending, accepted, rejected
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}

// ========== API Request/Response Models ==========

type StatsResponse struct {
	TotalFiles int `json:"total_files"`
	ValidFiles int `json:"valid_files"`
	ErrorFiles int `json:"error_files"`
	TotalRows  int `json:"total_rows"`
	TotalErrors int `json:"total_errors"`
}

type UploadResponse struct {
	File   FileUpload        `json:"file"`
	Errors []ValidationError `json:"errors"`
}

type ResolveErrorRequest struct {
	Action string `json:"action"` // "accepted" or "rejected"
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type HealthResponse struct {
	Status  string `json:"status"`
	Env     string `json:"env"`
	Version string `json:"version"`
}

// ========== Parsed Data Models ==========

type ParsedRow struct {
	RowNumber int
	Fields    map[string]string
}

type ParsedFile struct {
	Headers []string
	Rows    []ParsedRow
}

type QualityScore struct {
	Overall      float64 `json:"overall"`
	Completeness float64 `json:"completeness"`
	Accuracy     float64 `json:"accuracy"`
	Consistency  float64 `json:"consistency"`
	Timeliness   float64 `json:"timeliness"`
}
