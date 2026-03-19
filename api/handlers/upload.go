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

		// Send raw file to ML service /api/process
		// savedPath is the on-disk path set above
		var mapping *models.MLProcessResponse
		mappingJSON := "{}"
		status := "error"
		rowCount := 0

		mlReqBody := &bytes.Buffer{}
		writer := multipart.NewWriter(mlReqBody)
		part, partErr := writer.CreateFormFile("file", fileHeader.Filename)
		if partErr == nil {
			mlFile, err2 := os.Open(savedPath)
			if err2 == nil {
				io.Copy(part, mlFile)
				mlFile.Close()
			}
		}
		writer.Close()

		resp, err := http.Post(
			h.Config.MLServiceURL+"/api/process",
			writer.FormDataContentType(),
			mlReqBody,
		)
		if err != nil {
			log.Printf("[upload] ML service call failed: %v", err)
		} else {
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
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
				log.Printf("[upload] Failed to parse ML response: %v", err)
			}
		}

		fileUpload := models.FileUpload{
			Filename:      fileHeader.Filename,
			FileType:      fileType,
			FileSizeBytes: fileHeader.Size,
			Status:        status,
			RowCount:      rowCount,
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

		log.Printf("[upload] Processed %s: status=%s rows=%d", fileHeader.Filename, status, rowCount)
	}

	c.JSON(http.StatusOK, results)
}
