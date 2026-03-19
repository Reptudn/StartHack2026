package handlers

import (
	"net/http"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

type LogRequest struct {
	FileID       int64  `json:"file_id" binding:"required"`
	Stage        string `json:"stage" binding:"required"`
	Severity     string `json:"severity" binding:"required"`
	Message      string `json:"message" binding:"required"`
	AffectedRows int    `json:"affected_rows"`
}

func CreateLog(c *gin.Context) {
	var req LogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}
	entry := models.ValidationLog{
		FileID:       req.FileID,
		Stage:        req.Stage,
		Severity:     req.Severity,
		Message:      req.Message,
		AffectedRows: req.AffectedRows,
	}
	if err := database.DB.Create(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to write log"})
		return
	}
	c.JSON(http.StatusCreated, entry)
}
