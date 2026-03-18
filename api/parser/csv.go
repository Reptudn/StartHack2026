package parser

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"

	"epaccdataunifier/models"
)

// ParseCSV reads a CSV file and returns parsed rows with headers.
// It auto-detects semicolon vs comma delimiter.
func ParseCSV(reader io.Reader) (*models.ParsedFile, error) {
	// Read all content first to detect delimiter
	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	content := string(raw)
	if len(content) == 0 {
		return nil, fmt.Errorf("file is empty")
	}

	// Auto-detect delimiter: check first line for semicolons vs commas
	firstLine := strings.SplitN(content, "\n", 2)[0]
	delimiter := ','
	if strings.Count(firstLine, ";") > strings.Count(firstLine, ",") {
		delimiter = ';'
	}

	csvReader := csv.NewReader(strings.NewReader(content))
	csvReader.Comma = delimiter
	csvReader.LazyQuotes = true
	csvReader.TrimLeadingSpace = true
	csvReader.FieldsPerRecord = -1 // Allow variable field count

	// Read header
	headers, err := csvReader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read CSV header: %w", err)
	}

	// Trim whitespace from headers
	for i := range headers {
		headers[i] = strings.TrimSpace(headers[i])
	}

	parsed := &models.ParsedFile{
		Headers: headers,
		Rows:    make([]models.ParsedRow, 0),
	}

	rowNum := 1 // 1-indexed, header is row 0
	for {
		record, err := csvReader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			// Skip malformed rows but continue
			rowNum++
			continue
		}

		fields := make(map[string]string)
		for i, header := range headers {
			if i < len(record) {
				fields[header] = strings.TrimSpace(record[i])
			} else {
				fields[header] = ""
			}
		}

		parsed.Rows = append(parsed.Rows, models.ParsedRow{
			RowNumber: rowNum,
			Fields:    fields,
		})
		rowNum++
	}

	return parsed, nil
}

// DetectFileType returns the type of file based on extension.
func DetectFileType(filename string) string {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".csv"):
		return "csv"
	case strings.HasSuffix(lower, ".tsv"):
		return "tsv"
	case strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls"):
		return "xlsx"
	case strings.HasSuffix(lower, ".pdf"):
		return "pdf"
	case strings.HasSuffix(lower, ".txt"):
		return "txt"
	default:
		return "unknown"
	}
}
