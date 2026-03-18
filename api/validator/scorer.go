package validator

import (
	"strconv"
	"strings"

	"epaccdataunifier/models"
)

// CalculateQualityScore computes a weighted quality score for a parsed file.
//
// Quality Score = (Completeness × 0.35) + (Accuracy × 0.30)
//              + (Consistency × 0.20) + (Timeliness × 0.15)
func CalculateQualityScore(parsed *models.ParsedFile, errors []models.ValidationError) models.QualityScore {
	if len(parsed.Rows) == 0 {
		return models.QualityScore{}
	}

	totalFields := 0
	nonNullFields := 0
	totalValues := 0
	validValues := 0
	totalTimestamps := 0
	validTimestamps := 0

	// Build error index by row+col for quick lookups
	errorIndex := make(map[string]bool)
	for _, e := range errors {
		key := strings.ToLower(e.ColumnName) + ":" + strconv.Itoa(e.RowNumber)
		errorIndex[key] = true
	}

	// Detect datetime columns
	dateColumns := make(map[string]bool)
	for _, h := range parsed.Headers {
		hl := strings.ToLower(h)
		if strings.Contains(hl, "datetime") || strings.Contains(hl, "timestamp") || strings.Contains(hl, "date") {
			dateColumns[hl] = true
		}
	}

	for _, row := range parsed.Rows {
		for _, header := range parsed.Headers {
			val := row.Fields[header]
			totalFields++

			if !IsNullValue(val) && strings.TrimSpace(val) != "" {
				nonNullFields++
			}

			hl := strings.ToLower(header)

			// Count accuracy: non-null values that don't have an error
			if !IsNullValue(val) && strings.TrimSpace(val) != "" {
				totalValues++
				key := hl + ":" + strconv.Itoa(row.RowNumber)
				if !errorIndex[key] {
					validValues++
				}
			}

			// Count timeliness for datetime columns
			if dateColumns[hl] {
				if !IsNullValue(val) && strings.TrimSpace(val) != "" {
					totalTimestamps++
					if isValidDatetime(val) {
						validTimestamps++
					}
				}
			}
		}
	}

	completeness := safePercent(nonNullFields, totalFields)
	accuracy := safePercent(validValues, totalValues)

	// Consistency: ratio of rows without errors to total rows
	rowsWithErrors := make(map[int]bool)
	for _, e := range errors {
		if e.Severity == "error" {
			rowsWithErrors[e.RowNumber] = true
		}
	}
	consistentRows := len(parsed.Rows) - len(rowsWithErrors)
	consistency := safePercent(consistentRows, len(parsed.Rows))

	timeliness := 100.0
	if totalTimestamps > 0 {
		timeliness = safePercent(validTimestamps, totalTimestamps)
	}

	overall := completeness*0.35 + accuracy*0.30 + consistency*0.20 + timeliness*0.15

	return models.QualityScore{
		Overall:      round2(overall),
		Completeness: round2(completeness),
		Accuracy:     round2(accuracy),
		Consistency:  round2(consistency),
		Timeliness:   round2(timeliness),
	}
}

func safePercent(part, total int) float64 {
	if total == 0 {
		return 100.0
	}
	return float64(part) / float64(total) * 100.0
}

func round2(v float64) float64 {
	return float64(int(v*100)) / 100.0
}

// DetermineStatus returns the file status based on errors and score.
func DetermineStatus(errors []models.ValidationError, score models.QualityScore) string {
	errorCount := 0
	warningCount := 0
	for _, e := range errors {
		switch e.Severity {
		case "error":
			errorCount++
		case "warning":
			warningCount++
		}
	}

	if errorCount > 0 {
		return "error"
	}
	if warningCount > 0 || score.Overall < 80 {
		return "warning"
	}
	return "valid"
}
