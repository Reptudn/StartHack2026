package handlers

import (
	"fmt"
	"log"
	"os"
	"strings"

	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"
)

// ImportResult holds the outcome of a bulk import operation.
type ImportResult struct {
	Inserted int
	Skipped  int
}

// isNullString returns true for values that represent null/missing data
// but aren't empty strings (which are already handled).
// Matches the spec from Hack2026_README.md: NULL, Missing, unknow, NaN, N/A, whitespace.
func isNullString(val string) bool {
	v := strings.ToLower(strings.TrimSpace(val))
	return v == "null" || v == "n/a" || v == "na" || v == "none" ||
		v == "#n/a" || v == "nan" || v == "missing" || v == "unknow"
}

// BulkImport parses a file, applies column mappings, and inserts rows into the target table.
// It enforces required fields (coCaseId), handles NULL strings, normalizes case IDs,
// and uses chunked inserts with row-level error recovery.
func BulkImport(fileRecord models.FileUpload, mapping models.MLProcessResponse) (ImportResult, error) {
	f, err := os.Open(fileRecord.SavedPath)
	if err != nil {
		return ImportResult{}, fmt.Errorf("could not open file: %w", err)
	}
	defer f.Close()

	parsed, err := parser.ParseFile(f, fileRecord.Filename)
	if err != nil {
		return ImportResult{}, fmt.Errorf("could not parse file: %w", err)
	}

	// Check if the mapping includes coCaseId — only enforce it as required if it was mapped
	hasCaseIdMapping := false
	for _, colMap := range mapping.ColumnMappings {
		if strings.EqualFold(colMap.DBColumn, "coCaseId") && colMap.DBColumn != "unknown" {
			hasCaseIdMapping = true
			break
		}
	}

	var batch []map[string]interface{}
	skippedMissing := 0

	for _, row := range parsed.Rows {
		rowMap := make(map[string]interface{})
		for _, colMap := range mapping.ColumnMappings {
			if colMap.DBColumn != "" && colMap.DBColumn != "unknown" {
				val, exists := row.Fields[colMap.FileColumn]
				if exists && val != "" && !isNullString(val) {
					if strings.EqualFold(colMap.DBColumn, "coCaseId") {
						val = normalizeCaseId(val)
					}
					rowMap[colMap.DBColumn] = val
				}
			}
		}

		// Only enforce coCaseId as required if the mapping actually included it
		if hasCaseIdMapping {
			if _, hasCaseId := rowMap["coCaseId"]; !hasCaseId {
				skippedMissing++
				continue
			}
		}

		if len(rowMap) > 0 {
			batch = append(batch, rowMap)
		}
	}

	if len(batch) == 0 {
		return ImportResult{Skipped: skippedMissing}, fmt.Errorf("no valid rows to import")
	}

	chunkSize := 500
	result := ImportResult{Skipped: skippedMissing}

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
					result.Skipped++
				} else {
					result.Inserted++
				}
			}
			continue
		}
		result.Inserted += len(chunk)
	}

	return result, nil
}
