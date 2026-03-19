package handlers

import (
	"net/http"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/models"

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
