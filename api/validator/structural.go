package validator

import (
	"regexp"
	"strings"

	"epaccdataunifier/models"
)

// NullValues are strings treated as NULL per the hackathon spec.
var NullValues = map[string]bool{
	"null":    true,
	"missing": true,
	"unknow":  true,
	"nan":     true,
	"n/a":     true,
	"":        true,
}

// RequiredFields that must be present (non-null) in every row.
var RequiredFields = []string{"case_id", "patient_id"}

// caseIDPattern matches CASE-0135, 0135, 135 formats.
var caseIDPattern = regexp.MustCompile(`^(?:CASE-)?0*(\d+)$`)

// IsNullValue checks if a value should be treated as NULL.
func IsNullValue(val string) bool {
	trimmed := strings.TrimSpace(val)
	return NullValues[strings.ToLower(trimmed)]
}

// NormalizeCaseID converts "CASE-0135", "0135", "135" all to "135".
func NormalizeCaseID(val string) string {
	trimmed := strings.TrimSpace(val)
	matches := caseIDPattern.FindStringSubmatch(trimmed)
	if len(matches) >= 2 {
		return matches[1]
	}
	return trimmed
}

// ValidateStructural performs Stage 1 validation on a parsed file.
// Returns a list of validation errors.
func ValidateStructural(parsed *models.ParsedFile) []models.ValidationError {
	var errors []models.ValidationError

	// Build a set of available headers (lowercase)
	headerSet := make(map[string]bool)
	for _, h := range parsed.Headers {
		headerSet[strings.ToLower(h)] = true
	}

	for _, row := range parsed.Rows {
		// Check required fields
		for _, req := range RequiredFields {
			// Find the field (case-insensitive)
			val := findField(row.Fields, req)
			if val == "" || IsNullValue(val) {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     req,
					ErrorType:      "missing",
					Severity:       "error",
					OriginalValue:  val,
					SuggestedValue: "",
					Resolved:       "pending",
				})
			}
		}

		// Check case_id format and suggest normalization
		caseVal := findField(row.Fields, "case_id")
		if caseVal != "" && !IsNullValue(caseVal) {
			normalized := NormalizeCaseID(caseVal)
			if normalized != caseVal {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     "case_id",
					ErrorType:      "format",
					Severity:       "warning",
					OriginalValue:  caseVal,
					SuggestedValue: normalized,
					Resolved:       "pending",
				})
			}
		}

		// Check all fields for null-like values
		for col, val := range row.Fields {
			colLower := strings.ToLower(col)
			// Skip required fields (already checked above)
			if colLower == "case_id" || colLower == "patient_id" {
				continue
			}
			if IsNullValue(val) && val != "" {
				// It's a null-like string (not just empty)
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     col,
					ErrorType:      "missing",
					Severity:       "info",
					OriginalValue:  val,
					SuggestedValue: "",
					Resolved:       "pending",
				})
			}
		}
	}

	return errors
}

// findField does a case-insensitive field lookup.
func findField(fields map[string]string, key string) string {
	keyLower := strings.ToLower(key)
	for k, v := range fields {
		if strings.ToLower(k) == keyLower {
			return v
		}
	}
	return ""
}
