package handlers

import (
	"log"
	"net/http"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

// GetStats handles GET /api/stats
func GetStats(c *gin.Context) {
	var stats models.StatsResponse

	err := database.DB.QueryRow(`SELECT COUNT(*) FROM file_uploads`).Scan(&stats.TotalFiles)
	if err != nil {
		log.Printf("[stats] Error: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to query stats"})
		return
	}

	database.DB.QueryRow(`SELECT COUNT(*) FROM file_uploads WHERE status = 'valid'`).Scan(&stats.ValidFiles)
	database.DB.QueryRow(`SELECT COUNT(*) FROM file_uploads WHERE status IN ('error', 'warning')`).Scan(&stats.ErrorFiles)
	database.DB.QueryRow(`SELECT COALESCE(SUM(row_count), 0) FROM file_uploads`).Scan(&stats.TotalRows)
	database.DB.QueryRow(`SELECT COUNT(*) FROM validation_errors WHERE resolved = 'pending'`).Scan(&stats.TotalErrors)

	c.JSON(http.StatusOK, stats)
}
