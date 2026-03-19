package models

import "time"

// Processing step constants
const (
	StepExtracting  = "extracting"
	StepInspecting  = "inspecting"
	StepClassifying = "classifying"
	StepMapping     = "mapping"
	StepCompleted   = "completed"
	StepFailed      = "failed"
)

// ========== Database Models ==========

type FileUpload struct {
	ID             int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Filename       string    `json:"filename" gorm:"not null;type:varchar(500)"`
	FileType       string    `json:"file_type" gorm:"not null;type:varchar(10)"`
	FileSizeBytes  int64     `json:"file_size_bytes" gorm:"not null"`
	UploadedAt     time.Time `json:"uploaded_at" gorm:"default:now()"`
	Status         string    `json:"status" gorm:"default:'processing';type:varchar(20)"`
	ProcessingStep string    `json:"processing_step" gorm:"default:'extracting';type:varchar(20)"`
	RowCount       int       `json:"row_count" gorm:"default:0"`
	ColumnsMapped  []string  `json:"columns_mapped" gorm:"type:jsonb;serializer:json"`
	MappingResult  string    `json:"mapping_result" gorm:"type:jsonb"`
	SavedPath      string    `json:"saved_path" gorm:"type:varchar(500)"`
	
	// Quality Metrics
	QualityScore  float64   `json:"quality_score" gorm:"default:0"`
	Completeness  float64   `json:"completeness" gorm:"default:0"`
	Accuracy      float64   `json:"accuracy" gorm:"default:0"`
	Consistency   float64   `json:"consistency" gorm:"default:0"`
	Timeliness    float64   `json:"timeliness" gorm:"default:0"`
	ErrorCount    int       `json:"error_count" gorm:"default:0"`
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
	ManualValue    string     `json:"manual_value" gorm:"type:text"`
	Resolved       string     `json:"resolved" gorm:"default:'pending';type:varchar(20)"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}

// ========== API Response ==========

type UploadResponse struct {
	File    FileUpload `json:"file"`
	Mapping *MLMapping `json:"mapping,omitempty"`
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

type MLMappingRequest struct {
	Headers    []string   `json:"headers"`
	SampleRows [][]string `json:"sample_rows"`
	Filename   string     `json:"filename"`
}

type MLColumnMapping struct {
	FileColumn string `json:"file_column"`
	DBColumn   string `json:"db_column"`
	Confidence string `json:"confidence"`
}

type MLMapping struct {
	TargetTable     string            `json:"target_table"`
	ColumnMappings  []MLColumnMapping `json:"column_mappings"`
	UnmappedColumns []string          `json:"unmapped_columns"`
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
