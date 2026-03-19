package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"

	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"

	"github.com/gin-gonic/gin"
)

var caseIdPrefixRe = regexp.MustCompile(`^[A-Za-z]+-0*`)

// normalizeCaseId strips prefixes like "CASE-" and leading zeros, returning just the numeric part.
func normalizeCaseId(val string) string {
	val = strings.TrimSpace(val)
	cleaned := caseIdPrefixRe.ReplaceAllString(val, "")
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

	// Read and parse the uploaded file (CSV, XLSX, etc.)
	f, err := os.Open(fileRecord.SavedPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not open uploaded file from disk"})
		return
	}
	defer f.Close()

	parsed, err := parser.ParseFile(f, fileRecord.Filename)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not parse file: " + err.Error()})
		return
	}

	// Prepare dynamic maps for GORM batch insert
	var batch []map[string]interface{}

	// Build a case-insensitive lookup from parsed file headers to handle
	// case mismatches between ML column names and actual file headers.
	fileHeadersLower := make(map[string]string, len(parsed.Headers))
	for _, h := range parsed.Headers {
		norm := strings.TrimSpace(strings.TrimPrefix(h, "\ufeff"))
		fileHeadersLower[strings.ToLower(norm)] = h
	}

	mappedCount := 0
	for _, row := range parsed.Rows {
		rowMap := make(map[string]interface{})
		for _, colMap := range mapping.ColumnMappings {
			// Do not map unknown columns or unmapped columns
			if colMap.DBColumn != "" && colMap.DBColumn != "unknown" {
				// Try exact match first, then case-insensitive
				val, exists := row.Fields[colMap.FileColumn]
				if !exists {
					// Case-insensitive fallback
					normCol := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(colMap.FileColumn, "\ufeff")))
					if actualHeader, ok := fileHeadersLower[normCol]; ok {
						val = row.Fields[actualHeader]
						exists = true
					}
				}
				if exists && val != "" {
					// Normalize case_id values: strip "CASE-" prefix and leading zeros
					if strings.EqualFold(colMap.DBColumn, "coCaseId") {
						val = normalizeCaseId(val)
					}
					rowMap[colMap.DBColumn] = val
				}
			}
		}

		if len(rowMap) > 0 {
			batch = append(batch, rowMap)
			mappedCount++
		}
	}

	if len(batch) == 0 {
		// Diagnostic: log what columns the ML mapped vs what the file actually has
		log.Printf("[import] No valid rows. File headers: %v", parsed.Headers)
		for _, cm := range mapping.ColumnMappings {
			_, found := fileHeadersLower[strings.ToLower(cm.FileColumn)]
			log.Printf("[import] Mapping: %q → %q (header found: %v)", cm.FileColumn, cm.DBColumn, found)
		}
		log.Printf("[import] Total rows parsed: %d, rows with data: %d", len(parsed.Rows), mappedCount)
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "No valid data found to insert based on mapping"})
		return
	}

	// Insert in chunks of 500 to avoid Postgres parameter limits.
	// On chunk failure, fall back to row-by-row to skip bad rows.
	chunkSize := 500
	inserted := 0
	skipped := 0
	for i := 0; i < len(batch); i += chunkSize {
		end := i + chunkSize
		if end > len(batch) {
			end = len(batch)
		}

		chunk := batch[i:end]
		if err := database.DB.Table(mapping.TargetTable).Create(&chunk).Error; err != nil {
			log.Printf("[import] Chunk insert failed, falling back to row-by-row: %v", err)
			for _, row := range chunk {
				if err2 := database.DB.Table(mapping.TargetTable).Create(&row).Error; err2 != nil {
					log.Printf("[import] Skipping bad row: %v", err2)
					skipped++
				} else {
					inserted++
				}
			}
			continue
		}
		inserted += len(chunk)
	}

	if inserted == 0 {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "No rows could be inserted into database"})
		return
	}

	// Update the mapping result to the user-approved one and set status
	mappingBytes, _ := json.Marshal(mapping)
	fileRecord.MappingResult = string(mappingBytes)
	fileRecord.Status = "imported"
	database.DB.Save(&fileRecord)

	log.Printf("[import] Successfully inserted %d rows to %s (%d skipped)", inserted, mapping.TargetTable, skipped)
	c.JSON(http.StatusOK, gin.H{"message": "Data imported successfully", "rows_inserted": inserted, "rows_skipped": skipped})
}
