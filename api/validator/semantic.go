package validator

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"epaccdataunifier/models"
)

// Lab value reference ranges (approximate clinical ranges).
var labRanges = map[string][2]float64{
	"natrium":      {120, 160},
	"kalium":       {2.5, 6.5},
	"kreatinin":    {0.1, 15.0},
	"egfr":         {5, 200},
	"glukose":      {20, 600},
	"hb":           {3, 22},
	"leukozyten":   {0.5, 50},
	"thrombozyten": {10, 1000},
	"crp":          {0, 500},
	"alt":          {0, 2000},
	"ast":          {0, 2000},
	"bilirubin":    {0, 50},
	"albumin":      {1, 6},
	"inr":          {0.5, 10},
	"laktat":       {0, 30},
}

// Binary fields that should only contain 0 or 1.
var binaryFields = map[string]bool{
	"fall_event_0_1":       true,
	"bed_exit_detected_0_1": true,
	"bed_occupied_0_1":     true,
	"bed_exit_event_0_1":   true,
	"bed_return_event_0_1": true,
	"is_prn_0_1":           true,
}

// Valid medication admin statuses.
var validAdminStatuses = map[string]bool{
	"given":   true,
	"missed":  true,
	"held":    true,
	"refused": true,
}

// Valid record types for medication files.
var validRecordTypes = map[string]bool{
	"order":  true,
	"change": true,
	"admin":  true,
}

var icd10Pattern = regexp.MustCompile(`^[A-Z]\d{2}(\.\d{1,2})?$`)

// ValidateSemantic performs Stage 2 validation: value ranges, logic checks, format checks.
func ValidateSemantic(parsed *models.ParsedFile) []models.ValidationError {
	var errors []models.ValidationError

	// Build lowercase header set
	headerLower := make(map[string]string) // lowercase -> original
	for _, h := range parsed.Headers {
		headerLower[strings.ToLower(h)] = h
	}

	for _, row := range parsed.Rows {
		// Check lab value ranges
		for labName, rng := range labRanges {
			origCol, exists := headerLower[labName]
			if !exists {
				continue
			}
			val := row.Fields[origCol]
			if IsNullValue(val) || val == "" {
				continue
			}

			numVal, err := strconv.ParseFloat(strings.ReplaceAll(val, ",", "."), 64)
			if err != nil {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "invalid_type",
					Severity:       "error",
					OriginalValue:  val,
					SuggestedValue: "",
					Resolved:       "pending",
				})
				continue
			}

			if numVal < rng[0] || numVal > rng[1] {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "out_of_range",
					Severity:       "warning",
					OriginalValue:  val,
					SuggestedValue: fmt.Sprintf("Expected %.1f–%.1f", rng[0], rng[1]),
					Resolved:       "pending",
				})
			}
		}

		// Check binary fields
		for field := range binaryFields {
			origCol, exists := headerLower[field]
			if !exists {
				continue
			}
			val := row.Fields[origCol]
			if IsNullValue(val) || val == "" {
				continue
			}
			if val != "0" && val != "1" {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "out_of_range",
					Severity:       "error",
					OriginalValue:  val,
					SuggestedValue: "0 or 1",
					Resolved:       "pending",
				})
			}
		}

		// Check record_type for medication files
		if origCol, exists := headerLower["record_type"]; exists {
			val := strings.ToLower(strings.TrimSpace(row.Fields[origCol]))
			if val != "" && !validRecordTypes[val] {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "format",
					Severity:       "error",
					OriginalValue:  row.Fields[origCol],
					SuggestedValue: "ORDER, CHANGE, or ADMIN",
					Resolved:       "pending",
				})
			}
		}

		// Check admin status
		if origCol, exists := headerLower["administration_status"]; exists {
			val := strings.ToLower(strings.TrimSpace(row.Fields[origCol]))
			if val != "" && !IsNullValue(val) && !validAdminStatuses[val] {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "format",
					Severity:       "warning",
					OriginalValue:  row.Fields[origCol],
					SuggestedValue: "given, missed, held, or refused",
					Resolved:       "pending",
				})
			}
		}

		// Check ICD-10 format
		if origCol, exists := headerLower["primary_icd10_code"]; exists {
			val := strings.TrimSpace(row.Fields[origCol])
			if val != "" && !IsNullValue(val) && !icd10Pattern.MatchString(val) {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "format",
					Severity:       "warning",
					OriginalValue:  val,
					SuggestedValue: "Format: A00.0",
					Resolved:       "pending",
				})
			}
		}

		// Check datetime fields are parseable
		for _, dtField := range []string{"admission_datetime", "discharge_datetime", "specimen_datetime", "timestamp", "order_start_datetime", "order_stop_datetime", "administration_datetime"} {
			origCol, exists := headerLower[dtField]
			if !exists {
				continue
			}
			val := strings.TrimSpace(row.Fields[origCol])
			if val == "" || IsNullValue(val) {
				continue
			}
			if !isValidDatetime(val) {
				errors = append(errors, models.ValidationError{
					RowNumber:      row.RowNumber,
					ColumnName:     origCol,
					ErrorType:      "format",
					Severity:       "error",
					OriginalValue:  val,
					SuggestedValue: "ISO 8601 format",
					Resolved:       "pending",
				})
			}
		}

		// Check admission < discharge
		admCol, admExists := headerLower["admission_datetime"]
		disCol, disExists := headerLower["discharge_datetime"]
		if admExists && disExists {
			admVal := strings.TrimSpace(row.Fields[admCol])
			disVal := strings.TrimSpace(row.Fields[disCol])
			if admVal != "" && disVal != "" && !IsNullValue(admVal) && !IsNullValue(disVal) {
				admTime := parseTime(admVal)
				disTime := parseTime(disVal)
				if !admTime.IsZero() && !disTime.IsZero() && admTime.After(disTime) {
					errors = append(errors, models.ValidationError{
						RowNumber:      row.RowNumber,
						ColumnName:     "discharge_datetime",
						ErrorType:      "out_of_range",
						Severity:       "error",
						OriginalValue:  fmt.Sprintf("admission=%s > discharge=%s", admVal, disVal),
						SuggestedValue: "discharge must be after admission",
						Resolved:       "pending",
					})
				}
			}
		}
	}

	return errors
}

var dateFormats = []string{
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02",
	"02.01.2006",
	"02.01.2006 15:04:05",
	"01/02/2006",
	"2006/01/02",
}

func isValidDatetime(val string) bool {
	for _, fmt := range dateFormats {
		if _, err := time.Parse(fmt, val); err == nil {
			return true
		}
	}
	return false
}

func parseTime(val string) time.Time {
	for _, fmt := range dateFormats {
		if t, err := time.Parse(fmt, val); err == nil {
			return t
		}
	}
	return time.Time{}
}
