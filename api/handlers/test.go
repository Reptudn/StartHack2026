// Package handlers — test.go
//
// POST /api/test — E2E pipeline smoke test.
//
// WHAT IT TESTS: file parsing → LLM table classification → LLM column mapping → DB import.
// Verifies the plumbing works end-to-end with real Ollama against real test fixtures.
//
// WHAT IT DOES NOT TEST (yet):
//   - Column mapping correctness (sodium_mmol_L → coSodium_mmol_L?)
//   - Case assignment / patient_id linking across files
//   - Provenance tracking (where each value came from)
//   - Conflict detection (duplicates, contradictions)
//   - Anomaly / data quality handling
//   - PDF and free-text ingestion
//   - Cleanup of imported test data

package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/models"
	"epaccdataunifier/parser"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// TestFixture defines a single test file and its expected outcome.
type TestFixture struct {
	File          string `json:"file"`
	ExpectedTable string `json:"expected_table"`
}

// TestManifest is the top-level structure of testdata/manifest.json.
type TestManifest struct {
	Fixtures []TestFixture `json:"fixtures"`
}

// TestFileResult holds the outcome for a single fixture file.
type TestFileResult struct {
	File          string  `json:"file"`
	Status        string  `json:"status"` // "pass" or "fail"
	ExpectedTable string  `json:"expected_table"`
	GotTable      string  `json:"got_table"`
	Confidence    float64 `json:"confidence"`
	ColumnsMapped int     `json:"columns_mapped"`
	RowsImported  int     `json:"rows_imported"`
	DurationMs    int64   `json:"duration_ms"`
	Error         string  `json:"error,omitempty"`
}

// TestRunResponse is the top-level response from POST /api/test.
type TestRunResponse struct {
	Results []TestFileResult `json:"results"`
	Passed  int              `json:"passed"`
	Failed  int              `json:"failed"`
	Total   int              `json:"total"`
}

type TestHandler struct {
	Config *config.Config
}

func NewTestHandler(cfg *config.Config) *TestHandler {
	return &TestHandler{Config: cfg}
}

// RunTests handles POST /api/test
func (h *TestHandler) RunTests(c *gin.Context) {
	testdataDir := filepath.Join(".", "testdata")

	// Read manifest
	manifestPath := filepath.Join(testdataDir, "manifest.json")
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "Could not read manifest.json: " + err.Error(),
		})
		return
	}

	var manifest TestManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "Invalid manifest.json: " + err.Error(),
		})
		return
	}

	response := TestRunResponse{}

	for _, fixture := range manifest.Fixtures {
		result := h.runFixture(testdataDir, fixture)
		response.Results = append(response.Results, result)
		if result.Status == "pass" {
			response.Passed++
		} else {
			response.Failed++
		}
	}
	response.Total = len(manifest.Fixtures)

	c.JSON(http.StatusOK, response)
}

func (h *TestHandler) runFixture(testdataDir string, fixture TestFixture) TestFileResult {
	start := time.Now()
	result := TestFileResult{
		File:          fixture.File,
		ExpectedTable: fixture.ExpectedTable,
	}

	filePath := filepath.Join(testdataDir, fixture.File)

	// Check file exists
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		result.Status = "fail"
		result.Error = "File not found: " + fixture.File
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}

	// Save a copy to the upload dir (same as upload handler)
	savedPath := filepath.Join(h.Config.UploadDir, uuid.New().String()+"_"+fixture.File)
	srcFile, err := os.Open(filePath)
	if err != nil {
		result.Status = "fail"
		result.Error = "Could not open file: " + err.Error()
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}
	defer srcFile.Close()

	dstFile, err := os.Create(savedPath)
	if err != nil {
		result.Status = "fail"
		result.Error = "Could not save file copy: " + err.Error()
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}
	io.Copy(dstFile, srcFile)
	dstFile.Close()

	// Send to ML service
	mlFile, _ := os.Open(savedPath)
	defer mlFile.Close()

	mlReqBody := &bytes.Buffer{}
	writer := multipart.NewWriter(mlReqBody)
	part, err := writer.CreateFormFile("file", fixture.File)
	if err != nil {
		result.Status = "fail"
		result.Error = "Could not create multipart form: " + err.Error()
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}
	io.Copy(part, mlFile)
	writer.Close()

	resp, err := http.Post(
		h.Config.MLServiceURL+"/api/process",
		writer.FormDataContentType(),
		mlReqBody,
	)
	if err != nil {
		result.Status = "fail"
		result.Error = "ML service call failed: " + err.Error()
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var mlResp models.MLProcessResponse
	if err := json.Unmarshal(body, &mlResp); err != nil {
		result.Status = "fail"
		result.Error = "Could not parse ML response: " + err.Error()
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}

	result.GotTable = mlResp.TargetTable
	result.Confidence = mlResp.Confidence
	result.ColumnsMapped = len(mlResp.ColumnMappings)

	// Check table classification
	if fixture.ExpectedTable != "" && mlResp.TargetTable != fixture.ExpectedTable {
		result.Status = "fail"
		result.Error = fmt.Sprintf("Table mismatch: expected %s, got %s", fixture.ExpectedTable, mlResp.TargetTable)
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}

	// Determine if mapping is valid enough to import
	mlStatus := "mapped"
	if mlResp.LowConfidence || mlResp.TargetTable == "UNKNOWN" || mlResp.TargetTable == "" {
		mlStatus = "review"
	}

	// Save file record to DB
	fileType := parser.DetectFileType(fixture.File)
	fileUpload := models.FileUpload{
		Filename:      fixture.File,
		FileType:      fileType,
		FileSizeBytes: fileInfo.Size(),
		Status:        mlStatus,
		RowCount:      mlResp.RowCount,
		MappingResult: string(body),
		SavedPath:     savedPath,
	}
	database.DB.Create(&fileUpload)

	// If mapped, attempt import
	if mlStatus == "mapped" {
		rowsImported, importErr := h.attemptImport(fileUpload, mlResp)
		if importErr != nil {
			result.Status = "fail"
			result.Error = "Import failed: " + importErr.Error()
			result.DurationMs = time.Since(start).Milliseconds()
			return result
		}
		result.RowsImported = rowsImported
	}

	result.Status = "pass"
	result.DurationMs = time.Since(start).Milliseconds()
	log.Printf("[test] %s: pass (table=%s, confidence=%.2f, rows=%d, %dms)",
		fixture.File, mlResp.TargetTable, mlResp.Confidence, result.RowsImported, result.DurationMs)
	return result
}

// attemptImport mirrors the import handler logic: parse CSV, map columns, bulk insert.
func (h *TestHandler) attemptImport(fileRecord models.FileUpload, mapping models.MLProcessResponse) (int, error) {
	f, err := os.Open(fileRecord.SavedPath)
	if err != nil {
		return 0, fmt.Errorf("could not open file: %w", err)
	}
	defer f.Close()

	parsed, err := parser.ParseFile(f, fileRecord.Filename)
	if err != nil {
		return 0, fmt.Errorf("could not parse file: %w", err)
	}

	var batch []map[string]interface{}
	for _, row := range parsed.Rows {
		rowMap := make(map[string]interface{})
		for _, colMap := range mapping.ColumnMappings {
			if colMap.DBColumn != "" && colMap.DBColumn != "unknown" {
				val, exists := row.Fields[colMap.FileColumn]
				if exists && val != "" {
					if strings.EqualFold(colMap.DBColumn, "coCaseId") {
						val = normalizeCaseId(val)
					}
					rowMap[colMap.DBColumn] = val
				}
			}
		}
		if len(rowMap) > 0 {
			batch = append(batch, rowMap)
		}
	}

	if len(batch) == 0 {
		return 0, fmt.Errorf("no valid rows to import")
	}

	chunkSize := 500
	inserted := 0
	for i := 0; i < len(batch); i += chunkSize {
		end := i + chunkSize
		if end > len(batch) {
			end = len(batch)
		}
		chunk := batch[i:end]
		if err := database.DB.Table(mapping.TargetTable).Create(&chunk).Error; err != nil {
			// Try row-by-row on chunk failure to skip bad rows
			for _, row := range chunk {
				if err2 := database.DB.Table(mapping.TargetTable).Create(&row).Error; err2 == nil {
					inserted++
				}
			}
			continue
		}
		inserted += len(chunk)
	}

	if inserted > 0 {
		fileRecord.Status = "imported"
		database.DB.Save(&fileRecord)
	}

	return inserted, nil
}
