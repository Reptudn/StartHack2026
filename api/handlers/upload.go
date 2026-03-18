package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"
	"epaccdataunifier/validator"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

type UploadHandler struct {
	Config *config.Config
}

func NewUploadHandler(cfg *config.Config) *UploadHandler {
	return &UploadHandler{Config: cfg}
}

// Upload handles POST /api/upload
func (h *UploadHandler) Upload(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Invalid multipart form: " + err.Error()})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		// Try single file field
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "No files provided"})
			return
		}
		files = append(files, file)
	}

	var results []models.UploadResponse

	for _, fileHeader := range files {
		// Check file size
		if fileHeader.Size > h.Config.MaxUploadMB*1024*1024 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: fmt.Sprintf("File %s exceeds max size of %d MB", fileHeader.Filename, h.Config.MaxUploadMB),
			})
			return
		}

		// Detect file type
		fileType := parser.DetectFileType(fileHeader.Filename)
		if fileType == "unknown" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: fmt.Sprintf("Unsupported file type: %s", fileHeader.Filename),
			})
			return
		}

		// Save file to disk
		savedPath := filepath.Join(h.Config.UploadDir, uuid.New().String()+"_"+fileHeader.Filename)
		src, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to open uploaded file"})
			return
		}
		defer src.Close()

		dst, err := os.Create(savedPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to save file"})
			return
		}
		defer dst.Close()

		if _, err = io.Copy(dst, src); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to write file"})
			return
		}

		// Parse the file
		var parsed *models.ParsedFile
		if fileType == "csv" || fileType == "tsv" || fileType == "txt" {
			f, err := os.Open(savedPath)
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to read saved file"})
				return
			}
			defer f.Close()

			parsed, err = parser.ParseCSV(f)
			if err != nil {
				c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Failed to parse CSV: " + err.Error()})
				return
			}
		} else {
			// For xlsx/pdf, create a stub parsed file (parsing not yet implemented)
			parsed = &models.ParsedFile{
				Headers: []string{"raw_content"},
				Rows:    []models.ParsedRow{},
			}
		}

		// Run validation
		structuralErrors := validator.ValidateStructural(parsed)
		semanticErrors := validator.ValidateSemantic(parsed)

		allErrors := append(structuralErrors, semanticErrors...)

		// Calculate quality score
		score := validator.CalculateQualityScore(parsed, allErrors)
		status := validator.DetermineStatus(allErrors, score)

		// Count only error/warning severity
		errorCount := 0
		for _, e := range allErrors {
			if e.Severity == "error" || e.Severity == "warning" {
				errorCount++
			}
		}

		// Store in database
		var fileID int64
		columnsMapped := parsed.Headers
		err = database.DB.QueryRow(`
			INSERT INTO file_uploads (filename, file_type, file_size_bytes, quality_score, completeness, accuracy, consistency, timeliness, status, row_count, error_count, columns_mapped)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING id`,
			fileHeader.Filename, fileType, fileHeader.Size,
			score.Overall, score.Completeness, score.Accuracy, score.Consistency, score.Timeliness,
			status, len(parsed.Rows), errorCount, pq.Array(columnsMapped),
		).Scan(&fileID)
		if err != nil {
			log.Printf("[upload] Failed to insert file record: %v", err)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to store file record"})
			return
		}

		// Store validation errors
		for i := range allErrors {
			allErrors[i].FileID = fileID
			_, err := database.DB.Exec(`
				INSERT INTO validation_errors (file_id, row_number, column_name, error_type, severity, original_value, suggested_value, resolved)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				fileID, allErrors[i].RowNumber, allErrors[i].ColumnName,
				allErrors[i].ErrorType, allErrors[i].Severity,
				allErrors[i].OriginalValue, allErrors[i].SuggestedValue, "pending",
			)
			if err != nil {
				log.Printf("[upload] Failed to insert validation error: %v", err)
			}
		}

		// Build response
		fileUpload := models.FileUpload{
			ID:            fileID,
			Filename:      fileHeader.Filename,
			FileType:      fileType,
			FileSizeBytes: fileHeader.Size,
			QualityScore:  score.Overall,
			Completeness:  score.Completeness,
			Accuracy:      score.Accuracy,
			Consistency:   score.Consistency,
			Timeliness:    score.Timeliness,
			Status:        status,
			RowCount:      len(parsed.Rows),
			ErrorCount:    errorCount,
			ColumnsMapped: columnsMapped,
		}

		// Fetch stored errors with IDs
		storedErrors := fetchErrorsForFile(fileID)

		results = append(results, models.UploadResponse{
			File:   fileUpload,
			Errors: storedErrors,
		})

		log.Printf("[upload] Processed %s: score=%.1f status=%s rows=%d errors=%d",
			fileHeader.Filename, score.Overall, status, len(parsed.Rows), errorCount)
	}

	c.JSON(http.StatusOK, results)
}

func fetchErrorsForFile(fileID int64) []models.ValidationError {
	rows, err := database.DB.Query(`
		SELECT id, file_id, row_number, column_name, error_type, severity, original_value, suggested_value, resolved, resolved_at
		FROM validation_errors WHERE file_id = $1 ORDER BY row_number`, fileID)
	if err != nil {
		log.Printf("[upload] Failed to fetch errors: %v", err)
		return nil
	}
	defer rows.Close()

	var errors []models.ValidationError
	for rows.Next() {
		var e models.ValidationError
		var resolvedAt *string
		if err := rows.Scan(&e.ID, &e.FileID, &e.RowNumber, &e.ColumnName, &e.ErrorType, &e.Severity, &e.OriginalValue, &e.SuggestedValue, &e.Resolved, &resolvedAt); err != nil {
			continue
		}
		errors = append(errors, e)
	}
	return errors
}
