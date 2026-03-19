package models

import "time"

// ========== Database Models ==========

type FileUpload struct {
	ID            int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Filename      string    `json:"filename" gorm:"not null;type:varchar(500)"`
	FileType      string    `json:"file_type" gorm:"not null;type:varchar(10)"`
	FileSizeBytes int64     `json:"file_size_bytes" gorm:"not null"`
	UploadedAt    time.Time `json:"uploaded_at" gorm:"default:now()"`
	Status        string    `json:"status" gorm:"default:'processing';type:varchar(20)"`
	RowCount      int       `json:"row_count" gorm:"default:0"`
	MappingResult string    `json:"mapping_result" gorm:"type:jsonb"`
	SavedPath     string    `json:"saved_path" gorm:"type:varchar(500)"`
	JobID         string    `json:"job_id" gorm:"type:varchar(64)"`
}

func (FileUpload) TableName() string {
	return "file_uploads"
}

type ValidationError struct {
	ID             int64      `json:"id" gorm:"primaryKey;autoIncrement"`
	FileID         int64      `json:"file_id" gorm:"not null"`
	RowNumber      int        `json:"row_number" gorm:"not null"`
	ColumnName     string     `json:"column_name" gorm:"not null;type:varchar(100)"`
	ErrorType      string     `json:"error_type" gorm:"not null;type:varchar(50)"`
	Severity       string     `json:"severity" gorm:"default:'error';type:varchar(10)"`
	OriginalValue  string     `json:"original_value" gorm:"type:text"`
	SuggestedValue string     `json:"suggested_value" gorm:"type:text"`
	Resolved       string     `json:"resolved" gorm:"default:'pending';type:varchar(10)"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}

// MappingCache stores LLM results keyed by column hash to avoid repeat LLM calls.
type MappingCache struct {
	ColumnHash    string    `json:"column_hash" gorm:"primaryKey;type:varchar(64)"`
	TargetTable   string    `json:"target_table" gorm:"type:varchar(100)"`
	ColumnMapping string    `json:"column_mapping" gorm:"type:jsonb"`
	Confidence    float64   `json:"confidence"`
	TimesUsed     int       `json:"times_used" gorm:"default:0"`
	CreatedAt     time.Time `json:"created_at" gorm:"default:now()"`
}

func (MappingCache) TableName() string { return "tbMappingCache" }

// ValidationLog records pipeline stage outcomes for provenance.
type ValidationLog struct {
	ID           int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	FileID       int64     `json:"file_id" gorm:"not null"`
	Stage        string    `json:"stage" gorm:"type:varchar(20)"`
	Severity     string    `json:"severity" gorm:"type:varchar(10)"`
	Message      string    `json:"message" gorm:"type:text"`
	AffectedRows int       `json:"affected_rows"`
	CreatedAt    time.Time `json:"created_at" gorm:"default:now()"`
}

func (ValidationLog) TableName() string { return "tbValidationLog" }

// ========== API Response ==========

type UploadResponse struct {
	File    FileUpload         `json:"file"`
	Mapping *MLProcessResponse `json:"mapping,omitempty"`
	JobID   string             `json:"job_id,omitempty"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type HealthResponse struct {
	Status  string `json:"status"`
	Env     string `json:"env"`
	Version string `json:"version"`
}

// ========== ML Service Types ==========

type MLColumnMapping struct {
	FileColumn string `json:"file_column"`
	DBColumn   string `json:"db_column"`
	Confidence string `json:"confidence"`
}

// MLProcessResponse is the response from POST /api/process on the ML service.
type MLProcessResponse struct {
	TargetTable     string            `json:"target_table"`
	Confidence      float64           `json:"confidence"`
	Reasoning       string            `json:"reasoning"`
	ColumnMappings  []MLColumnMapping `json:"column_mappings"`
	UnmappedColumns []string          `json:"unmapped_columns"`
	RowCount        int               `json:"row_count"`
	LowConfidence   bool              `json:"low_confidence"`
	CacheHit        bool              `json:"cache_hit"`
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

// ========== Job Progress (SSE) ==========

// JobProgress tracks the real-time state of an ML pipeline job.
type JobProgress struct {
	JobID     string                 `json:"job_id"`
	Stage     string                 `json:"stage"` // extract|inspect|classify|map|done|error
	Message   string                 `json:"message"`
	Percent   int                    `json:"percent"` // 0-100
	Timestamp int64                  `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"` // stage-specific detail
}

// JobState persists job progress in the DB so users can check status later.
type JobState struct {
	JobID     string    `json:"job_id" gorm:"primaryKey;type:varchar(64)"`
	FileID    int64     `json:"file_id"`
	Stage     string    `json:"stage" gorm:"type:varchar(20)"`
	Message   string    `json:"message" gorm:"type:text"`
	Percent   int       `json:"percent"`
	Data      string    `json:"data" gorm:"type:jsonb"`
	UpdatedAt time.Time `json:"updated_at" gorm:"default:now()"`
}

func (JobState) TableName() string { return "tbJobState" }
