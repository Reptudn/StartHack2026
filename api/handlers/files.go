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
