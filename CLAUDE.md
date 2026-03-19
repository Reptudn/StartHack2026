# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HealthMap — a healthcare data harmonization platform that uses an LLM-powered pipeline to automatically map heterogeneous healthcare files (CSV, XLSX, PDF, TSV) to a unified database schema. Built at StartHack 2026.

## Architecture

Four services orchestrated via `docker-compose.yml`:

| Service | Tech | Port | Purpose |
|---------|------|------|---------|
| **api** | Go (Gin + GORM) | 8080 | REST API: file upload, schema, import, cache, logs |
| **ml** | Python (FastAPI) | 5001 | 4-stage AI pipeline: extract → inspect → classify → map |
| **web** | React 19 + TypeScript + Vite | 4242 | Upload UI with interactive mapping editor |
| **postgres** | PostgreSQL 16 | 5432 | Persistent storage |
| **ollama** | Ollama | 11434 | Local LLM runtime (qwen2.5:3b) |

### Data Flow

1. User uploads file via web UI → API saves to disk → API sends raw bytes to ML `/api/process`
2. ML pipeline: Extract (parse to DataFrame) → Inspect (build FileProfile) → Classify (LLM picks target table) → Map (LLM maps columns)
3. Results cached by SHA256 of column names, write-through to API `/api/cache`
4. User reviews/edits mapping in UI → clicks Import → API inserts rows into target table

### Key Design Decisions

- Confidence threshold: 0.8 required for auto-mapping; below that, flagged for manual review
- Cache keyed by SHA256(sorted column names) — avoids repeat LLM calls for same schema
- ML service never sends raw data to LLM — only column names, dtypes, null%, and up to 5 sample values (max 600 tokens)
- Target tables defined in `db/schema.sql` (8 tables, MS SQL Server dialect)

## Commands

### Full Stack (Docker)

```bash
docker-compose up                    # Start all services
docker-compose up --build            # Rebuild and start
docker-compose logs -f <service>     # Tail logs (api, ml, web, postgres, ollama)
```

### API (Go) — `api/`

```bash
cd api
go mod tidy                          # Sync dependencies
go build -o main .                   # Build
./main                               # Run (needs env vars or .env.dev)
go test ./...                        # Run all tests
```

Config: `api/.env.dev` (dev), `api/.env.prod` (prod). Key vars: `DB_HOST`, `ML_SERVICE_URL`, `CORS_ORIGINS`.

### ML (Python) — `ml/`

```bash
cd ml
pip install -r requirements.txt      # Install deps
python -m uvicorn main:app --host 0.0.0.0 --port 5001  # Run
python -m pytest                     # Run all tests
python -m pytest tests/test_extract.py -v               # Single test file
```

Config via env: `OLLAMA_URL`, `OLLAMA_MODEL`, `GO_API_URL`.

### Web (React/TS) — `web/`

```bash
cd web
npm install                          # Install deps
npm run dev                          # Dev server
npm run build                        # Production build → dist/
npm run lint                         # ESLint
```

API URL configured via `VITE_API_URL` in `web/.env`.

## Code Layout

### API (`api/`)
- `main.go` — Server entry, route registration
- `handlers/` — HTTP handlers (`upload.go`, `files.go`, `schema.go`, `import.go`, `cache.go`, `logs.go`)
- `models/` — GORM models (`FileUpload`, `MappingCache`, `ValidationLog`, `MLProcessResponse`)
- `database/` — PostgreSQL connection + auto-migration
- `config/` — Env-based config loading
- `parser/` — CSV format detection

### ML (`ml/`)
- `main.py` — FastAPI app, single `/api/process` endpoint
- `pipeline/extract.py` — Stage 1: file bytes → DataFrame (CSV, XLSX, PDF via pdfplumber)
- `pipeline/inspect.py` — Stage 2: DataFrame → FileProfile (lightweight LLM-ready summary)
- `pipeline/agents.py` — Stage 3 & 4: Classifier agent (pick table) + Mapper agent (map columns)
- `pipeline/schema.py` — Pydantic models (`FileProfile`, `MLColumnMapping`, `ProcessResponse`)
- `pipeline/cache.py` — In-memory + write-through cache
- `tests/` — Unit tests per pipeline stage

### Web (`web/src/`)
- `App.tsx` — Main dashboard (upload, file list, results)
- `api.ts` — API client + TypeScript interfaces
- `components/MappingResult.tsx` — Interactive mapping editor with manual correction
- `components/FileUpload.tsx` — Drag-and-drop upload
- `components/DataQualityTable.tsx`, `ErrorCorrectionPanel.tsx`, `StatsCards.tsx`

## Database

GORM auto-migrates on API startup all tables including the 8 target healthcare tables.
Models in `api/models/`: `FileUpload`, `MappingCache`, `ValidationLog`, `TBCaseData`, `TBImportAcData`, `TBImportLabsData`, `TBImportIcd10Data`, `TBImportDeviceMotionData`, `TBImportDevice1HzMotionData`, `TBImportMedicationInpatientData`, `TBImportNursingDailyReportsData`.
Target schema reference: `db/schema.sql` (MS SQL Server dialect — Go models are the source of truth for Postgres).
Default dev credentials: user `healthmap`, password `healthmap_dev`, database `healthmap`.

## E2E Test Pipeline

`POST /api/test` — runs 7 test fixtures through the full pipeline (upload → ML classify/map → DB import).

- Fixtures in `api/testdata/` with manifest at `api/testdata/manifest.json`
- Handler: `api/handlers/test.go`
- Run: `curl -X POST http://localhost:8080/api/test` (takes ~10min, LLM processes each file)

### Current Test Results (5/7 passing)

| File | Table | Status | Issue |
|------|-------|--------|-------|
| synth_labs_1000_cases.csv | tbImportLabsData | PASS (0 rows) | LLM maps to non-existent columns (coAgeYears, coSex) |
| synthetic_cases_icd10_ops.csv | tbImportIcd10Data | PASS (0 rows) | LLM adds `co` prefix to `ops_descriptions_en` |
| synthetic_device_motion_fall_data.csv | tbImportDeviceMotionData | PASS | 24k rows imported |
| synthetic_device_raw_1hz_motion_fall.csv | tbImportDevice1HzMotionData | PASS | 108k rows imported |
| synthetic_medication_raw_inpatient.csv | tbImportMedicationInpatientData | **FAIL** | LLM JSON response truncated (token limit) |
| synthetic_nursing_daily_reports_en.csv | tbImportNursingDailyReportsData | PASS | 181 rows imported |
| epaAC-Data-1.csv | tbImportAcData | **FAIL** | LLM puts `//` comments in JSON, parse fails |

### Root Causes & Fixes Needed

1. **Medication mapper truncation**: Increase `num_predict` beyond 2048 in `ml/pipeline/agents.py` mapper, or simplify the prompt to reduce output size.

2. **epaAC JSON comments**: Add comment-stripping to `_parse_json()` in `ml/pipeline/agents.py` — strip lines matching `//` before `json.loads()`.

3. **Labs phantom columns**: LLM maps `age_years`→`coAgeYears` and `sex`→`coSex` which don't exist on `tbImportLabsData`. Need to validate mapped columns against actual table schema before insert (reject unknown columns).

4. **ICD10 column prefix**: LLM maps to `coOps_descriptions_en` but the actual column is `ops_descriptions_en` (no `co` prefix). The `TABLE_COLUMNS` in `agents.py` lists the correct name but the LLM still adds the prefix. May also be a stale cache issue — clear `tbMappingCache` rows for this file's SHA to force re-mapping.

### Important: Docker Volumes

**NEVER use `docker compose down -v`** — it wipes the Ollama model volume, forcing a ~20min re-download.
- Reset just the DB: `docker volume rm starthack2026_pgdata`
- Clear ML cache: delete rows from `tbMappingCache` table directly

## Hackathon Goal (from Challenge.md)

Build an intelligent application that automates healthcare data mapping from heterogeneous formats into a unified case-centric schema. Judging: Viability 25%, Feasibility 20%, Complexity 20%, Creativity 15%, Design 10%, Presentation 10%.

### Implemented
- File upload (CSV/XLSX/PDF) → 4-stage ML pipeline (Extract → Inspect → Classify → Map)
- LLM-powered table classification and column mapping with caching
- Bulk import into Postgres with row-level error recovery
- Case ID normalization (strips `CASE-` prefix and leading zeros)
- Interactive mapping editor in UI
- E2E test pipeline

### Not Yet Implemented
- Column mapping validation against actual DB schema
- Data quality/completeness dashboard (UI components exist, no backend data)
- Anomaly/inconsistency detection
- Provenance tracking (source file + row number per imported record)
- Transform stage (type coercion, null replacement beyond case_id normalization)
- patient_id ↔ case_id linking across files
- Error-containing test data (`Endtestdaten_mit_Fehlern_ einheitliche ID/` exists but unused)

## Build Notes

- Go is NOT installed on the WSL host — all Go compilation happens inside Docker: `docker compose build api`
- Ollama model (qwen2.5:3b, ~2GB) is stored in a named Docker volume `starthack2026_ollama_data`
- ML service caches by SHA256 of sorted column names — to force re-classification/re-mapping, delete from `tbMappingCache`
