package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ListFiles handles GET /api/files
func ListFiles(c *gin.Context) {
	var files []models.FileUpload
	if err := database.DB.Order("uploaded_at DESC").Find(&files).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to query files"})
		return
	}
	c.JSON(http.StatusOK, files)
}

// GetFile handles GET /api/files/:id
func GetFile(c *gin.Context) {
	id := c.Param("id")
	var f models.FileUpload
	if err := database.DB.First(&f, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}
	c.JSON(http.StatusOK, f)
}

// GetFileProgress handles GET /api/files/:id/progress
func GetFileProgress(c *gin.Context) {
	id := c.Param("id")
	var f models.FileUpload
	if err := database.DB.First(&f, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":              f.ID,
		"status":          f.Status,
		"processing_step": f.ProcessingStep,
	})
}

// DeleteFile handles DELETE /api/files/:id
func DeleteFile(c *gin.Context) {
	id := c.Param("id")
	result := database.DB.Delete(&models.FileUpload{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to delete file"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "File deleted", "id": id})
}

// GetFileValidation handles GET /api/files/:id/validation
func GetFileValidation(c *gin.Context) {
	id := c.Param("id")
	var f models.FileUpload
	if err := database.DB.First(&f, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}

	var errors []models.ValidationError
	database.DB.Where("file_id = ?", id).Find(&errors)

	c.JSON(http.StatusOK, gin.H{
		"file":   f,
		"errors": errors,
	})
}

// ResolveValidationError handles POST /api/validation/:id/resolve
func ResolveValidationError(c *gin.Context) {
	id := c.Param("id")
	var validationErr models.ValidationError
	if err := database.DB.First(&validationErr, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "Validation error not found"})
		return
	}

	var req struct {
		Status      string `json:"status"`
		ManualValue string `json:"manual_value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	validationErr.Resolved = req.Status
	if req.ManualValue != "" {
		validationErr.ManualValue = req.ManualValue
	}

	if err := database.DB.Save(&validationErr).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to update validation error"})
		return
	}

	c.JSON(http.StatusOK, validationErr)
}

// MappingDiagnostic represents a mapping/schema issue for a file.
type MappingDiagnostic struct {
	Type        string `json:"type"`
	Severity    string `json:"severity"`
	Message     string `json:"message"`
	FileColumn  string `json:"file_column,omitempty"`
	DBColumn    string `json:"db_column,omitempty"`
	TargetTable string `json:"target_table,omitempty"`
}

// GetMappingDiagnostics handles GET /api/files/:id/mapping-diagnostics
// It inspects file columns, mapping result, and schema to surface mapping errors.
func GetMappingDiagnostics(c *gin.Context) {
	id := c.Param("id")
	var fileRecord models.FileUpload
	if err := database.DB.First(&fileRecord, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}

	if fileRecord.SavedPath == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "File content is missing from disk"})
		return
	}

	// Parse file to get headers
	f, err := os.Open(fileRecord.SavedPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not open uploaded file from disk"})
		return
	}
	defer f.Close()

	parsed, err := parser.ParseFile(f, fileRecord.Filename)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not parse file: " + err.Error()})
		return
	}

	fileColumns := make([]string, 0, len(parsed.Headers))
	fileColumnSet := make(map[string]struct{}, len(parsed.Headers))
	for _, h := range parsed.Headers {
		col := strings.TrimSpace(strings.TrimPrefix(h, "\ufeff"))
		fileColumns = append(fileColumns, col)
		fileColumnSet[strings.ToLower(col)] = struct{}{}
	}

	// Parse mapping result (if any)
	var mapping models.MLProcessResponse
	if fileRecord.MappingResult != "" && fileRecord.MappingResult != "{}" {
		_ = json.Unmarshal([]byte(fileRecord.MappingResult), &mapping)
	}

	// Load schema tables and columns
	schemaTables, err := loadSchemaTables()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not read database schema file"})
		return
	}
	columnsByTable := make(map[string]map[string]struct{}, len(schemaTables))
	for _, t := range schemaTables {
		colSet := make(map[string]struct{}, len(t.Columns))
		for _, col := range t.Columns {
			colSet[strings.ToLower(col)] = struct{}{}
		}
		columnsByTable[t.Name] = colSet
	}

	var diagnostics []MappingDiagnostic

	// If mapping is missing or table unknown
	if mapping.TargetTable == "" || mapping.TargetTable == "UNKNOWN" {
		diagnostics = append(diagnostics, MappingDiagnostic{
			Type:     "missing_target_table",
			Severity: "error",
			Message:  "Target table is missing or unknown",
		})
	}

	targetCols := columnsByTable[mapping.TargetTable]
	if mapping.TargetTable != "" && targetCols == nil {
		diagnostics = append(diagnostics, MappingDiagnostic{
			Type:        "unknown_target_table",
			Severity:    "error",
			Message:     "Target table does not exist in schema",
			TargetTable: mapping.TargetTable,
		})
	}

	// Track mappings and detect duplicates
	usedDBCols := make(map[string][]string)
	mappedFileCols := make(map[string]struct{})
	for _, cm := range mapping.ColumnMappings {
		fileCol := strings.TrimSpace(strings.TrimPrefix(cm.FileColumn, "\ufeff"))
		dbCol := strings.TrimSpace(cm.DBColumn)
		if fileCol != "" {
			mappedFileCols[strings.ToLower(fileCol)] = struct{}{}
		}

		if dbCol == "" || strings.EqualFold(dbCol, "unknown") {
			continue
		}

		usedDBCols[strings.ToLower(dbCol)] = append(usedDBCols[strings.ToLower(dbCol)], fileCol)

		// Unknown DB column
		if targetCols != nil {
			if _, ok := targetCols[strings.ToLower(dbCol)]; !ok {
				diagnostics = append(diagnostics, MappingDiagnostic{
					Type:        "unknown_db_column",
					Severity:    "error",
					Message:     "Mapped DB column does not exist in target table",
					FileColumn:  fileCol,
					DBColumn:    dbCol,
					TargetTable: mapping.TargetTable,
				})
			}
		}

		// Low confidence mapping
		if strings.EqualFold(cm.Confidence, "low") {
			diagnostics = append(diagnostics, MappingDiagnostic{
				Type:       "low_confidence_mapping",
				Severity:   "warning",
				Message:    "Low confidence mapping",
				FileColumn: fileCol,
				DBColumn:   dbCol,
			})
		}
	}

	// Duplicate DB targets
	for dbCol, fileCols := range usedDBCols {
		if len(fileCols) > 1 {
			diagnostics = append(diagnostics, MappingDiagnostic{
				Type:     "duplicate_db_target",
				Severity: "error",
				Message:  "Multiple file columns map to the same DB column",
				DBColumn: dbCol,
			})
		}
	}

	// Unmapped file columns
	for _, col := range fileColumns {
		if _, ok := mappedFileCols[strings.ToLower(col)]; !ok {
			diagnostics = append(diagnostics, MappingDiagnostic{
				Type:       "unmapped_file_column",
				Severity:   "warning",
				Message:    "File column is not mapped",
				FileColumn: col,
			})
		}
	}

	// Missing key mapping (coCaseId)
	if mapping.TargetTable != "" && mapping.TargetTable != "UNKNOWN" {
		if targetCols != nil {
			if _, ok := usedDBCols[strings.ToLower("coCaseId")]; !ok {
				diagnostics = append(diagnostics, MappingDiagnostic{
					Type:        "missing_key_mapping",
					Severity:    "warning",
					Message:     "coCaseId is not mapped",
					DBColumn:    "coCaseId",
					TargetTable: mapping.TargetTable,
				})
			}
		}
	}

	// Respond
	c.JSON(http.StatusOK, gin.H{
		"file":           fileRecord,
		"file_columns":   fileColumns,
		"target_table":   mapping.TargetTable,
		"column_mappings": mapping.ColumnMappings,
		"errors":         diagnostics,
	})
}

// ReprocessFile handles POST /api/files/:id/reprocess — re-runs ML pipeline on an existing file.
func ReprocessFile(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var fileRecord models.FileUpload
		if err := database.DB.First(&fileRecord, id).Error; err != nil {
			c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
			return
		}

		if fileRecord.SavedPath == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "File content is missing from disk"})
			return
		}

		// Generate new job ID
		jobID := uuid.New().String()

		// Update file record to "processing" with new job_id
		database.DB.Model(&fileRecord).Updates(models.FileUpload{
			Status:        "processing",
			RowCount:      0,
			MappingResult: "{}",
			JobID:         jobID,
		})

		// Build the handler to reuse processMLAsync
		handler := NewUploadHandler(cfg)
		go handler.ProcessMLAsync(fileRecord, fileRecord.SavedPath, fileRecord.Filename, jobID)

		c.JSON(http.StatusOK, gin.H{
			"message": "Reprocessing started",
			"job_id":  jobID,
			"file_id": fileRecord.ID,
		})
	}
}
