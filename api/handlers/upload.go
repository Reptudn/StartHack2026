package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "No files provided"})
			return
		}
		files = append(files, file)
	}

	var results []models.UploadResponse

	for _, fileHeader := range files {
		if fileHeader.Size > h.Config.MaxUploadMB*1024*1024 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: fmt.Sprintf("File %s exceeds max size of %d MB", fileHeader.Filename, h.Config.MaxUploadMB),
			})
			return
		}

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

		// Generate a job ID for progress tracking
		jobID := uuid.New().String()

		// Create file record in DB immediately with "processing" status
		fileUpload := models.FileUpload{
			Filename:      fileHeader.Filename,
			FileType:      fileType,
			FileSizeBytes: fileHeader.Size,
			Status:        "processing",
			RowCount:      0,
			MappingResult: "{}",
			SavedPath:     savedPath,
			JobID:         jobID,
		}

		if err := database.DB.Create(&fileUpload).Error; err != nil {
			log.Printf("[upload] Failed to insert file record: %v", err)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to store file record"})
			return
		}

		// Launch ML processing in background
		go h.ProcessMLAsync(fileUpload, savedPath, fileHeader.Filename, jobID)

		results = append(results, models.UploadResponse{
			File:  fileUpload,
			JobID: jobID,
		})

		log.Printf("[upload] Started processing %s: jobId=%s fileId=%d", fileHeader.Filename, jobID, fileUpload.ID)
	}

	c.JSON(http.StatusOK, results)
}

// ProcessMLAsync runs the ML pipeline in a background goroutine.
func (h *UploadHandler) ProcessMLAsync(
	fileUpload models.FileUpload,
	savedPath string,
	filename string,
	jobID string,
) {
	// Report: starting
	reportProgress(jobID, "extract", "Parsing file...", 5)

	// Build multipart form with the file + job_id + callback_url
	mlReqBody := &bytes.Buffer{}
	writer := multipart.NewWriter(mlReqBody)

	// Add file
	part, partErr := writer.CreateFormFile("file", filename)
	if partErr != nil {
		log.Printf("[upload] Failed to create multipart file part: %v", partErr)
		reportProgress(jobID, "error", "Failed to build upload payload", 0)
		database.DB.Model(&fileUpload).Updates(models.FileUpload{Status: "error"})
		return
	}
	mlFile, openErr := os.Open(savedPath)
	if openErr != nil {
		log.Printf("[upload] Failed to open saved file for ML: %v", openErr)
		reportProgress(jobID, "error", "Saved file not found for ML processing", 0)
		database.DB.Model(&fileUpload).Updates(models.FileUpload{Status: "error"})
		return
	}
	if _, copyErr := io.Copy(part, mlFile); copyErr != nil {
		mlFile.Close()
		log.Printf("[upload] Failed to copy file into multipart payload: %v", copyErr)
		reportProgress(jobID, "error", "Failed to stream file to ML service", 0)
		database.DB.Model(&fileUpload).Updates(models.FileUpload{Status: "error"})
		return
	}
	mlFile.Close()

	// Add job_id so ML can report back
	if err := writer.WriteField("job_id", jobID); err != nil {
		log.Printf("[upload] Failed to add job_id to multipart payload: %v", err)
		reportProgress(jobID, "error", "Failed to finalize ML request", 0)
		database.DB.Model(&fileUpload).Updates(models.FileUpload{Status: "error"})
		return
	}

	if err := writer.Close(); err != nil {
		log.Printf("[upload] Failed to close multipart payload: %v", err)
		reportProgress(jobID, "error", "Failed to finalize upload body", 0)
		database.DB.Model(&fileUpload).Updates(models.FileUpload{Status: "error"})
		return
	}

	// Call ML service
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Post(
		h.Config.MLServiceURL+"/api/process",
		writer.FormDataContentType(),
		mlReqBody,
	)

	var mapping *models.MLProcessResponse
	mappingJSON := "{}"
	status := "error"
	rowCount := 0

	if err != nil {
		log.Printf("[upload] ML service call failed: %v", err)
		reportProgress(jobID, "error", "ML service unavailable: "+err.Error(), 0)
	} else {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode != http.StatusOK {
			log.Printf("[upload] ML service returned %d: %s", resp.StatusCode, string(body))
			reportProgress(jobID, "error", fmt.Sprintf("ML service error (HTTP %d)", resp.StatusCode), 0)
		} else {
			var mlResp models.MLProcessResponse
			if err := json.Unmarshal(body, &mlResp); err == nil {
				mapping = &mlResp
				mappingJSON = string(body)
				rowCount = mlResp.RowCount
				switch {
				case mlResp.LowConfidence || mlResp.TargetTable == "UNKNOWN" || mlResp.TargetTable == "":
					status = "review"
				default:
					status = "mapped"
				}
			} else {
				log.Printf("[upload] Failed to parse ML response: %v\nBody: %s", err, string(body))
				reportProgress(jobID, "error", "Failed to parse ML response", 0)
			}
		}
	}

	// Update DB record with final result
	updates := models.FileUpload{
		Status:        status,
		RowCount:      rowCount,
		MappingResult: mappingJSON,
	}
	database.DB.Model(&fileUpload).Updates(updates)

	// Report final state
	if status == "error" {
		reportProgress(jobID, "error", "Mapping failed", 0)
	} else {
		reportProgress(jobID, "done", fmt.Sprintf("Mapped %d rows to %s", rowCount, mapping.TargetTable), 100)
	}

	log.Printf("[upload] Async processing complete %s: jobId=%s status=%s rows=%d", filename, jobID, status, rowCount)
}

// reportProgress updates the in-memory job store (which notifies SSE subscribers).
func reportProgress(jobID, stage, message string, percent int) {
	js := getOrCreateJob(jobID)
	p := models.JobProgress{
		JobID:     jobID,
		Stage:     stage,
		Message:   message,
		Percent:   percent,
		Timestamp: time.Now().UnixMilli(),
	}
	js.mu.Lock()
	js.progress = p
	for ch := range js.subscribers {
		select {
		case ch <- p:
		default:
		}
	}
	js.mu.Unlock()

	// Persist minimal progress for resiliency when failures occur before ML callbacks.
	state := models.JobState{
		JobID:     jobID,
		Stage:     stage,
		Message:   message,
		Percent:   percent,
		Data:      "{}",
		UpdatedAt: time.Now(),
	}
	database.DB.Save(&state)
}
