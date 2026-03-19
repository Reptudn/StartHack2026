package handlers

import (
	"bytes"
	"encoding/json"
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

		// Parse headers + sample rows
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
				c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Failed to parse file: " + err.Error()})
				return
			}
		} else {
			parsed = &models.ParsedFile{
				Headers: []string{"raw_content"},
				Rows:    []models.ParsedRow{},
			}
		}

		sample20 := c.PostForm("sample20") == "true"
		
		limit := len(parsed.Rows)
		if sample20 {
			limit = len(parsed.Rows) / 5
			if limit < 3 && len(parsed.Rows) >= 3 {
				limit = 3 // Give at least 3 rows to be useful
			} else if len(parsed.Rows) < 3 {
				limit = len(parsed.Rows)
			}
		}

		// Build sample rows for ML service
		sampleRows := make([][]string, 0, limit)
		for i, row := range parsed.Rows {
			if i >= limit {
				break
			}
			rowValues := make([]string, len(parsed.Headers))
			for j, h := range parsed.Headers {
				rowValues[j] = row.Fields[h]
			}
			sampleRows = append(sampleRows, rowValues)
		}

		var mapping *models.MLMapping
		mappingJSON := "{}"
		status := "error"

		mlReq := models.MLMappingRequest{
			Headers:    parsed.Headers,
			SampleRows: sampleRows,
			Filename:   fileHeader.Filename,
		}

		mlBody, _ := json.Marshal(mlReq)
		resp, err := http.Post(
			h.Config.MLServiceURL+"/api/map",
			"application/json",
			bytes.NewReader(mlBody),
		)
		if err != nil {
			log.Printf("[upload] ML service call failed: %v", err)
		} else {
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			var mlResp models.MLMapping
			if err := json.Unmarshal(body, &mlResp); err == nil {
				mapping = &mlResp
				mappingJSON = string(body)
				if mlResp.TargetTable == "unknown" || mlResp.TargetTable == "" {
					status = "error"
				} else {
					status = "mapped"
				}
			} else {
				log.Printf("[upload] Failed to parse ML response: %v", err)
			}
		}

		fileUpload := models.FileUpload{
			Filename:      fileHeader.Filename,
			FileType:      fileType,
			FileSizeBytes: fileHeader.Size,
			Status:        status,
			RowCount:      len(parsed.Rows),
			ColumnsMapped: parsed.Headers,
			MappingResult: mappingJSON,
			SavedPath:     savedPath,
		}

		if err := database.DB.Create(&fileUpload).Error; err != nil {
			log.Printf("[upload] Failed to insert file record: %v", err)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to store file record"})
			return
		}

		results = append(results, models.UploadResponse{
			File:    fileUpload,
			Mapping: mapping,
		})

		log.Printf("[upload] Processed %s: status=%s rows=%d sample20=%v",
			fileHeader.Filename, status, len(parsed.Rows), sample20)
	}

	c.JSON(http.StatusOK, results)
}
