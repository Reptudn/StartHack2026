package handlers

import (
	"net/http"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

type CacheWriteRequest struct {
	ColumnHash    string  `json:"column_hash" binding:"required"`
	TargetTable   string  `json:"target_table"`
	ColumnMapping string  `json:"column_mapping"`
	Confidence    float64 `json:"confidence"`
}

// GetCache handles GET /api/cache?hash=xxx
func GetCache(c *gin.Context) {
	hash := c.Query("hash")
	if hash == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "hash query param required"})
		return
	}
	var entry models.MappingCache
	if err := database.DB.First(&entry, "column_hash = ?", hash).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "cache miss"})
		return
	}
	c.JSON(http.StatusOK, entry)
}

// PostCache handles POST /api/cache — upsert a cache entry
func PostCache(c *gin.Context) {
	var req CacheWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
		return
	}
	result := database.DB.Exec(`
		INSERT INTO "tbMappingCache" (column_hash, target_table, column_mapping, confidence, times_used, created_at)
		VALUES (?, ?, ?, ?, 1, now())
		ON CONFLICT (column_hash) DO UPDATE
		SET times_used = "tbMappingCache".times_used + 1,
		    confidence = EXCLUDED.confidence,
		    column_mapping = EXCLUDED.column_mapping
	`, req.ColumnHash, req.TargetTable, req.ColumnMapping, req.Confidence)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "cache write failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
