# ML Pipeline Stages 1–4 Enhancement

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Implement a proper 4-stage ML pipeline (Extract → Inspect → Classify → Map) with two specialized LLM agents, upgrade the Ollama model, and add lean system tables to support caching and validation logging.

---

## Context

The overnight minimal solution wired a single combined LLM call (classify + map) directly inside the upload handler. This works end-to-end but collapses all intelligence into one prompt, has no caching, no XLSX/PDF support, and inserts data with no provenance trail.

This spec defines the next iteration: stages 1–4 of the pipeline, keeping the existing architecture (Go API + Python FastAPI ML service + Postgres + Ollama) unchanged.

---

## 1. Architecture (unchanged)

```
Next.js → Go (Gin) API → Python FastAPI ML Service → Ollama
                     ↓
                 Postgres
```

Go remains the orchestrator. The ML service gains full file extraction capability. No Redis/job queue introduced in this iteration (marked as future work).

---

## 2. ML Service — Single Enriched Endpoint

The ML service exposes **one endpoint**: `POST /api/process` (replaces `/api/map`).

Go sends the raw file as multipart form data. The ML service runs 4 internal stages and returns a single enriched response.

### Request

```
POST /api/process
Content-Type: multipart/form-data

file: <raw file bytes>
filename: "synth_labs_1000_cases.csv"
```

### Response

```json
{
  "target_table": "tbImportLabsData",
  "confidence": 0.91,
  "reasoning": "Column names match lab parameter pattern with flags and reference ranges",
  "column_mappings": [
    {"file_column": "Natrium", "db_column": "coSodium_mmol_L", "confidence": "high"},
    {"file_column": "Natrium_flag", "db_column": "coSodium_flag", "confidence": "high"}
  ],
  "unmapped_columns": ["some_unknown_col"],
  "row_count": 1000,
  "low_confidence": false,
  "cache_hit": false
}
```

`low_confidence: true` when classifier confidence < 0.8. Go stores the file with status `"review"` in this case rather than `"mapped"`.

---

## 3. Pipeline Stages (internal to ML service)

```
/api/process
  ├── Stage 1: extract(file, filename) → DataFrame + metadata
  ├── Stage 2: inspect(dataframe, metadata) → FileProfile
  ├── Stage 3: classify(profile) → ClassifyResult        [Agent 1]
  └── Stage 4: map(profile, target_table) → MapResult    [Agent 2]
```

### Stage 1: Extract

Converts raw file bytes into a pandas DataFrame.

| Format | Library |
|---|---|
| CSV / TSV | `pandas.read_csv` with delimiter auto-detection |
| XLSX / XLS | `openpyxl` via `pandas.read_excel` |
| PDF | `pdfplumber` — extract text, attempt tabular parse; fall back to raw text rows |
| TXT | Read lines, infer delimiter |

Output: `(DataFrame, metadata)` where metadata = `{filename, format, encoding, row_count, column_names}`.

If extraction fails entirely, the endpoint returns a 200 with `target_table: "UNKNOWN"` and `low_confidence: true` — never a 500 that breaks the Go upload flow.

### Stage 2: Inspect

Builds a compact **FileProfile** from the DataFrame. This is the only thing sent to the LLM — never raw data.

```json
{
  "filename": "synth_labs_1000_cases.csv",
  "format": "csv",
  "row_count": 1000,
  "columns": [
    {
      "name": "Natrium",
      "dtype": "float64",
      "null_pct": 0.02,
      "sample_values": ["138.2", "141.5", "136.0", "139.8", "142.1"]
    }
  ]
}
```

Target token count: < 600 tokens for any file, regardless of row count.

### Stage 3: Classify (Agent 1)

**LLM call 1.** Receives the FileProfile. Returns target table + confidence.

Cache check first: hash the sorted column name set → query `tbMappingCache` where `column_hash = ? AND target_table IS NOT NULL`. On hit, skip LLM.

System prompt includes the 8 target table names with one-line descriptions of their data shape. The model is instructed to return only JSON.

```json
{ "target_table": "tbImportLabsData", "confidence": 0.91, "reasoning": "..." }
```

Known target tables:
- `tbCaseData`
- `tbImportAcData`
- `tbImportLabsData`
- `tbImportIcd10Data`
- `tbImportDeviceMotionData`
- `tbImportDevice1HzMotionData`
- `tbImportMedicationInpatientData`
- `tbImportNursingDailyReportsData`

If the model returns `UNKNOWN` or confidence < 0.8 → set `low_confidence: true`, skip Stage 4, return early.

### Stage 4: Map (Agent 2)

**LLM call 2.** Receives FileProfile + the target table's column list. Returns column mappings.

Cache check: hash of (sorted column name set + target_table) → query `tbMappingCache`. On hit, skip LLM.

System prompt includes only the columns of the identified target table (not all 8). Model returns JSON only.

```json
{
  "mappings": {"Natrium": "coSodium_mmol_L", "Natrium_flag": "coSodium_flag"},
  "unmapped_columns": ["some_unknown_col"],
  "confidence": 0.92
}
```

On cache miss, write result to `tbMappingCache` after a successful LLM response.

---

## 4. LLM Configuration

| Setting | Value |
|---|---|
| Model | `qwen2.5:3b` (default, configurable via `OLLAMA_MODEL` env var) |
| Temperature | `0.1` |
| Max tokens | `1024` |
| Format enforcement | Prompt-level JSON instruction + markdown fence stripping on parse |
| Fallback | On parse failure or Ollama error → `target_table: "UNKNOWN"`, `low_confidence: true` |

The `OLLAMA_MODEL` env var in docker-compose is updated from `qwen3.5:0.8b` to `qwen2.5:3b`.

---

## 5. Go API Changes

**`POST /api/upload`:**
- Instead of parsing file + sending headers/sample to `/api/map`, send raw file bytes to `/api/process` (multipart)
- Remove the inline CSV parse for ML profiling (keep Go CSV parser only for the import step)
- Map ML response fields to `FileUpload` record: `status = "mapped" | "review" | "error"`, `MappingResult = full JSON response`

**`POST /api/files/:id/import`:** Unchanged. Go's CSV parser reads the saved file, applies the approved mapping, bulk-inserts into Postgres in 500-row chunks.

**No new Go endpoints.** No new Go dependencies.

---

## 6. Database Changes

Two new tables added via GORM AutoMigrate in `database/migrations.go`.

### `tbMappingCache`

```sql
column_hash   VARCHAR(64) PRIMARY KEY   -- SHA256 of sorted column names [+ target_table for mapper]
target_table  VARCHAR(100)              -- NULL for classifier-only cache entries
column_mapping JSONB                    -- {file_col: db_col} map; NULL for classifier entries
confidence    FLOAT
times_used    INT DEFAULT 0
created_at    TIMESTAMP DEFAULT now()
```

### `tbValidationLog`

```sql
id            SERIAL PRIMARY KEY
file_id       INT REFERENCES file_uploads(id)
stage         VARCHAR(20)    -- "extract", "inspect", "classify", "map"
severity      VARCHAR(10)    -- "info", "warning", "error"
message       TEXT
affected_rows INT
created_at    TIMESTAMP DEFAULT now()
```

The ML service writes validation log entries via a `POST /api/log` internal endpoint on the Go API (or directly via DB connection — TBD at implementation time based on what's simpler).

### TODO (next iteration)

```
TODO: Add tbJobs (async job queue support — requires Redis + worker)
TODO: Add tbFlaggedRecords (manual review/correction UI — requires correction endpoints)
```

---

## 7. What Is NOT Changing

- Main Docker Compose service topology (api, ml, postgres, ollama, web)
- Go API surface (same endpoints, same request/response shapes from frontend perspective)
- Frontend — no changes required; `MappingResult` JSON shape is backward-compatible
- Stage 5 (Transform) and Stage 6 (Validate & Load) — next iteration
- epaAC multi-format handling, device motion aggregation, nursing free-text extraction — future work

---

## 8. Dependencies to Add

**ML service (`ml/requirements.txt` or equivalent):**
- `openpyxl` — XLSX extraction
- `pdfplumber` — PDF extraction
- `pandas` — already present
- `httpx` — already present
