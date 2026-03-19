package parser

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"

	"epaccdataunifier/models"

	"github.com/xuri/excelize/v2"
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

// ParseXLSX reads an XLSX file and returns parsed rows with headers.
func ParseXLSX(reader io.Reader) (*models.ParsedFile, error) {
	f, err := excelize.OpenReader(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to open XLSX: %w", err)
	}
	defer f.Close()

	// Use the first sheet
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("XLSX has no sheets")
	}

	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, fmt.Errorf("failed to read XLSX rows: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("XLSX sheet is empty")
	}

	// First row is headers
	headers := make([]string, len(rows[0]))
	for i, h := range rows[0] {
		headers[i] = strings.TrimSpace(h)
	}

	parsed := &models.ParsedFile{
		Headers: headers,
		Rows:    make([]models.ParsedRow, 0, len(rows)-1),
	}

	for rowIdx := 1; rowIdx < len(rows); rowIdx++ {
		fields := make(map[string]string)
		for i, header := range headers {
			if i < len(rows[rowIdx]) {
				fields[header] = strings.TrimSpace(rows[rowIdx][i])
			} else {
				fields[header] = ""
			}
		}
		parsed.Rows = append(parsed.Rows, models.ParsedRow{
			RowNumber: rowIdx,
			Fields:    fields,
		})
	}

	return parsed, nil
}

// ParseFile auto-detects file type and parses accordingly.
// Supports CSV/TSV/TXT (delimited) and XLSX. Returns error for PDF.
func ParseFile(reader io.ReadSeeker, filename string) (*models.ParsedFile, error) {
	fileType := DetectFileType(filename)
	switch fileType {
	case "csv", "tsv", "txt":
		return ParseCSV(reader)
	case "xlsx":
		return ParseXLSX(reader)
	case "pdf":
		return nil, fmt.Errorf("PDF files cannot be re-parsed for import; convert to CSV or XLSX first")
	default:
		return nil, fmt.Errorf("unsupported file type: %s", fileType)
	}
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

// IsDirectlyParseable returns true for formats Go's CSV parser handles.
// XLSX and PDF are forwarded to the ML service for extraction.
func IsDirectlyParseable(fileType string) bool {
	return fileType == "csv" || fileType == "tsv" || fileType == "txt"
}
