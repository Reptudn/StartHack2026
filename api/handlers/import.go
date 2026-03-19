package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"

	"github.com/gin-gonic/gin"
)

// Import handles POST /api/files/:id/import
// Takes the finalized MLMapping and executes bulk insert into Postgres
func Import(c *gin.Context) {
	fileID := c.Param("id")

	var mapping models.MLMapping
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

	// Read and parse the raw CSV file
	f, err := os.Open(fileRecord.SavedPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not open uploaded file from disk"})
		return
	}
	defer f.Close()

	parsed, err := parser.ParseCSV(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Could not parse CSV file"})
		return
	}

	// Prepare dynamic maps for GORM batch insert
	var batch []map[string]interface{}

	for _, row := range parsed.Rows {
		rowMap := make(map[string]interface{})
		for _, colMap := range mapping.ColumnMappings {
			// Do not map unknown columns or unmapped columns
			if colMap.DBColumn != "" && colMap.DBColumn != "unknown" {
				val, exists := row.Fields[colMap.FileColumn]
				if exists && val != "" {
					rowMap[colMap.DBColumn] = val
				}
			}
		}
		
		if len(rowMap) > 0 {
			batch = append(batch, rowMap)
		}
	}

	if len(batch) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "No valid data found to insert based on mapping"})
		return
	}

	// Insert in chunks of 500 to avoid Postgres parameter limits
	chunkSize := 500
	for i := 0; i < len(batch); i += chunkSize {
		end := i + chunkSize
		if end > len(batch) {
			end = len(batch)
		}
		
		chunk := batch[i:end]
		if err := database.DB.Table(mapping.TargetTable).Create(&chunk).Error; err != nil {
			log.Printf("[import] Error inserting chunk: %v", err)
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to insert data into database: " + err.Error()})
			return
		}
	}

	// Update the mapping result to the user-approved one and set status
	mappingBytes, _ := json.Marshal(mapping)
	fileRecord.MappingResult = string(mappingBytes)
	fileRecord.Status = "imported"
	database.DB.Save(&fileRecord)

	log.Printf("[import] Successfully inserted %d rows to %s", len(batch), mapping.TargetTable)
	c.JSON(http.StatusOK, gin.H{"message": "Data imported successfully", "rows_inserted": len(batch)})
}
