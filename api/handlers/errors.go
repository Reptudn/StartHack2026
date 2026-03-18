package handlers

import (
	"log"
	"net/http"
	"time"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

// GetFileErrors handles GET /api/files/:id/errors
func GetFileErrors(c *gin.Context) {
	fileID := c.Param("id")

	rows, err := database.DB.Query(`
		SELECT id, file_id, row_number, column_name, error_type, severity, original_value, suggested_value, resolved, resolved_at
		FROM validation_errors WHERE file_id = $1 ORDER BY row_number`, fileID)
	if err != nil {
		log.Printf("[errors] Query error: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to query errors"})
		return
	}
	defer rows.Close()

	var errors []models.ValidationError
	for rows.Next() {
		var e models.ValidationError
		if err := rows.Scan(&e.ID, &e.FileID, &e.RowNumber, &e.ColumnName, &e.ErrorType, &e.Severity, &e.OriginalValue, &e.SuggestedValue, &e.Resolved, &e.ResolvedAt); err != nil {
			log.Printf("[errors] Scan error: %v", err)
			continue
		}
		errors = append(errors, e)
	}

	if errors == nil {
		errors = []models.ValidationError{}
	}

	c.JSON(http.StatusOK, errors)
}

// ResolveError handles PATCH /api/files/:id/errors/:errorId
func ResolveError(c *gin.Context) {
	fileID := c.Param("id")
	errorID := c.Param("errorId")

	var req models.ResolveErrorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if req.Action != "accepted" && req.Action != "rejected" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Action must be 'accepted' or 'rejected'"})
		return
	}

	now := time.Now()
	result, err := database.DB.Exec(`
		UPDATE validation_errors SET resolved = $1, resolved_at = $2
		WHERE id = $3 AND file_id = $4`,
		req.Action, now, errorID, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to update error"})
		return
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "Error not found"})
		return
	}

	// Update file error count and status
	updateFileAfterResolve(fileID)

	c.JSON(http.StatusOK, gin.H{"message": "Error resolved", "action": req.Action})
}

func updateFileAfterResolve(fileID string) {
	// Count remaining pending errors (error + warning severity)
	var pendingCount int
	err := database.DB.QueryRow(`
		SELECT COUNT(*) FROM validation_errors
		WHERE file_id = $1 AND resolved = 'pending' AND severity IN ('error', 'warning')`, fileID).Scan(&pendingCount)
	if err != nil {
		log.Printf("[errors] Failed to count pending errors: %v", err)
		return
	}

	status := "valid"
	if pendingCount > 0 {
		// Check if any are errors vs just warnings
		var errorCount int
		database.DB.QueryRow(`
			SELECT COUNT(*) FROM validation_errors
			WHERE file_id = $1 AND resolved = 'pending' AND severity = 'error'`, fileID).Scan(&errorCount)
		if errorCount > 0 {
			status = "error"
		} else {
			status = "warning"
		}
	}

	database.DB.Exec(`
		UPDATE file_uploads SET error_count = $1, status = $2 WHERE id = $3`,
		pendingCount, status, fileID)
}
