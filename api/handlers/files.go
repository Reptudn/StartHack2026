package handlers

import (
	"net/http"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
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
	var file models.FileUpload
	if err := database.DB.First(&file, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}

	var errors []models.ValidationError
	if err := database.DB.Where("file_id = ?", id).Order("row_number ASC, column_name ASC").Find(&errors).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to query validation errors"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"file":   file,
		"errors": errors,
	})
}

type ResolveErrorRequest struct {
	Status      string `json:"status" binding:"required"` // accepted, rejected
	ManualValue string `json:"manual_value"`
}

// ResolveValidationError handles POST /api/validation/:id/resolve
func ResolveValidationError(c *gin.Context) {
	id := c.Param("id")
	var req ResolveErrorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Invalid request"})
		return
	}

	var validationErr models.ValidationError
	if err := database.DB.First(&validationErr, id).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "Validation error not found"})
		return
	}

	validationErr.Resolved = req.Status
	validationErr.ManualValue = req.ManualValue
	
	if err := database.DB.Save(&validationErr).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to update validation error"})
		return
	}

	c.JSON(http.StatusOK, validationErr)
}
