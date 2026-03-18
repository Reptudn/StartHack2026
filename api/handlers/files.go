package handlers

import (
	"log"
	"net/http"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// ListFiles handles GET /api/files
func ListFiles(c *gin.Context) {
	rows, err := database.DB.Query(`
		SELECT id, filename, file_type, file_size_bytes, uploaded_at, quality_score,
		       completeness, accuracy, consistency, timeliness, status, row_count, error_count, columns_mapped
		FROM file_uploads ORDER BY uploaded_at DESC`)
	if err != nil {
		log.Printf("[files] Query error: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to query files"})
		return
	}
	defer rows.Close()

	var files []models.FileUpload
	for rows.Next() {
		var f models.FileUpload
		err := rows.Scan(&f.ID, &f.Filename, &f.FileType, &f.FileSizeBytes, &f.UploadedAt,
			&f.QualityScore, &f.Completeness, &f.Accuracy, &f.Consistency, &f.Timeliness,
			&f.Status, &f.RowCount, &f.ErrorCount, pq.Array(&f.ColumnsMapped))
		if err != nil {
			log.Printf("[files] Scan error: %v", err)
			continue
		}
		files = append(files, f)
	}

	if files == nil {
		files = []models.FileUpload{}
	}

	c.JSON(http.StatusOK, files)
}

// GetFile handles GET /api/files/:id
func GetFile(c *gin.Context) {
	id := c.Param("id")

	var f models.FileUpload
	err := database.DB.QueryRow(`
		SELECT id, filename, file_type, file_size_bytes, uploaded_at, quality_score,
		       completeness, accuracy, consistency, timeliness, status, row_count, error_count, columns_mapped
		FROM file_uploads WHERE id = $1`, id).Scan(
		&f.ID, &f.Filename, &f.FileType, &f.FileSizeBytes, &f.UploadedAt,
		&f.QualityScore, &f.Completeness, &f.Accuracy, &f.Consistency, &f.Timeliness,
		&f.Status, &f.RowCount, &f.ErrorCount, pq.Array(&f.ColumnsMapped))
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}

	c.JSON(http.StatusOK, f)
}

// DeleteFile handles DELETE /api/files/:id
func DeleteFile(c *gin.Context) {
	id := c.Param("id")

	result, err := database.DB.Exec("DELETE FROM file_uploads WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to delete file"})
		return
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "File deleted", "id": id})
}
