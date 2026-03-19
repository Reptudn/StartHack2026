package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

// caseIdPrefixRe matches prefixes like "CASE-" with leading zeros.
var caseIdPrefixRe = regexp.MustCompile(`^[A-Za-z]+-0*`)

// caseIdSuffixRe matches trailing sub-IDs like "-01", "-02" appended after the numeric part.
var caseIdSuffixRe = regexp.MustCompile(`-\d+$`)

// normalizeCaseId strips prefixes like "CASE-", leading zeros, and trailing
// sub-IDs like "-01", returning just the core numeric ID.
// Examples: "CASE-0095-01" → "95", "CASE-0001" → "1", "42" → "42"
func normalizeCaseId(val string) string {
	val = strings.TrimSpace(val)
	cleaned := caseIdPrefixRe.ReplaceAllString(val, "")
	if cleaned == "" {
		return val
	}
	cleaned = caseIdSuffixRe.ReplaceAllString(cleaned, "")
	if cleaned == "" {
		return val
	}
	return cleaned
}

// Import handles POST /api/files/:id/import
// Takes the finalized MLMapping and executes bulk insert into Postgres
func Import(c *gin.Context) {
	fileID := c.Param("id")

	var mapping models.MLProcessResponse
	if err := c.ShouldBindJSON(&mapping); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Invalid mapping JSON format"})
		return
	}

	var fileRecord models.FileUpload
	if err := database.DB.First(&fileRecord, fileID).Error; err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "File record not found"})
		return
	}

	if fileRecord.SavedPath == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "File content is missing from disk record"})
		return
	}

	result, err := BulkImport(fileRecord, mapping)
	if err != nil && result.Inserted == 0 {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Import failed: " + err.Error()})
		return
	}

	// Update the mapping result to the user-approved one and set status
	mappingBytes, _ := json.Marshal(mapping)
	fileRecord.MappingResult = string(mappingBytes)
	fileRecord.Status = "imported"
	database.DB.Save(&fileRecord)

	log.Printf("[import] Successfully inserted %d rows to %s (%d skipped)", result.Inserted, mapping.TargetTable, result.Skipped)
	c.JSON(http.StatusOK, gin.H{"message": "Data imported successfully", "rows_inserted": result.Inserted, "rows_skipped": result.Skipped})
}
