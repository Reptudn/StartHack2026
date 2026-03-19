# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HealthMap — a healthcare data harmonization platform that uses an LLM-powered pipeline to automatically map heterogeneous healthcare files (CSV, XLSX, PDF, TSV) to a unified database schema. Built at StartHack 2026.

## Architecture

Five services orchestrated via `docker-compose.yml`:

| Service | Tech | Port | Purpose |
|---------|------|------|---------|
| **api** | Go (Gin + GORM) | 8080 | REST API: file upload, schema, import, cache, logs, job progress |
| **ml** | Python (FastAPI) | 5001 | 4-stage AI pipeline: extract → inspect → classify → map |
| **web** | React 19 + TypeScript + Vite | 4242 | Upload UI with interactive mapping editor & live progress |
| **postgres** | PostgreSQL 16 | 5432 | Persistent storage |
| **ollama** | Ollama | 11434 | Local LLM runtime (qwen2.5:1.5b) |

### Data Flow

1. User uploads file via web UI → API saves to disk → API sends raw bytes to ML `/api/process` with job_id
2. ML pipeline: Extract (parse to DataFrame) → Inspect (build FileProfile + anomalies) → Classify (LLM picks target table) → Map (LLM maps columns in batches)
3. ML reports progress after each stage to API `/api/jobs/{job_id}/progress`; frontend subscribes via SSE
4. Results cached by SHA256 of column names, write-through to API `/api/cache`
5. User reviews/edits mapping in UI → clicks Import → API bulk-inserts rows into target table with row-level error recovery

### Key Design Decisions

- Confidence threshold: 0.8 required for auto-mapping; below that, flagged for manual review
- Cache keyed by SHA256(sorted column names) — avoids repeat LLM calls for same schema
- ML service never sends raw data to LLM — only column names, dtypes, null%, and up to 5 sample values
- Column batching: files with >20 columns split into multiple LLM calls to avoid token limits
- Post-mapping validation: reject columns not in DB schema, case-insensitive fallback, many-to-one dedup
- Reference data from SQL Server .bak provides few-shot examples and valid column lists
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

### Evaluation Pipeline

```bash
cd ml
python ../scripts/evaluate_pipeline.py   # Compare LLM mappings against ground truth
```

Ground truth in `api/testdata/ground_truth.json`. Results written to `eval_results.json`.

## Code Layout

### API (`api/`)
- `main.go` — Server entry (v2.0.0), route registration
- `handlers/upload.go` — File upload, job creation, ML pipeline trigger
- `handlers/import.go` — Import endpoint with case ID normalization
- `handlers/importutil.go` — Shared `BulkImport()`: parse file, apply mappings, chunked inserts (500/chunk), row-level error recovery
- `handlers/progress.go` — Job progress tracking (in-memory + DB), SSE streaming
- `handlers/test.go` — E2E test pipeline handler
- `handlers/files.go`, `schema.go`, `cache.go`, `log.go` — CRUD handlers
- `models/models.go` — All GORM models (FileUpload, MappingCache, ValidationLog, JobProgress, JobState, 8 healthcare tables, MLProcessResponse)
- `database/` — PostgreSQL connection + auto-migration
- `config/` — Env-based config loading
- `parser/` — CSV/XLSX/PDF format detection and parsing

### ML (`ml/`)
- `main.py` — FastAPI app, `/api/process` endpoint with per-stage progress reporting
- `pipeline/extract.py` — Stage 1: file bytes → DataFrame (CSV, XLSX, PDF via pdfplumber)
- `pipeline/inspect.py` — Stage 2: DataFrame → FileProfile (max 150 cols, anomaly detection: high nulls, duplicates, truncation)
- `pipeline/agents.py` — Stage 3 & 4: Classifier agent + Mapper agent (batched, validated, deduped). 30+ German/abbreviated header examples in prompt. Reference data from `reference_data.json`
- `pipeline/schema.py` — Pydantic models (`FileProfile`, `MLColumnMapping`, `ProcessResponse` with profile + anomalies)
- `pipeline/cache.py` — In-memory + write-through cache
- `reference_data.json` — Extracted from .bak: valid columns + sample rows per table (3141 lines)
- `tests/` — Unit tests per pipeline stage

### Web (`web/src/`)
- `App.tsx` — Router (Landing → Dashboard)
- `components/Dashboard.tsx` — Main file list, upload, live SSE progress tracking
- `components/MappingResult.tsx` — Interactive mapping editor with confidence indicators
- `components/FileUpload.tsx` — Drag-and-drop upload
- `components/DataQualityTable.tsx`, `ErrorCorrectionPanel.tsx`, `StatsCards.tsx` — Data quality UI (wired but limited backend data)
- `components/Landing.tsx` — Welcome page
- `api.ts` — API client with SSE subscription (uploadFiles, subscribeToProgress, getFiles, reprocessFile)

### Scripts (`scripts/`)
- `evaluate_pipeline.py` — Evaluation harness: precision/recall/F1 per file
- `extract_bak_reference.py` — Extract reference data from SQL Server .bak

## Database

GORM auto-migrates on API startup all tables including the 8 target healthcare tables.
Models in `api/models/models.go`: `FileUpload`, `MappingCache`, `ValidationLog`, `JobProgress`, `JobState`, plus 8 target tables (`TBCaseData`, `TBImportAcData`, `TBImportLabsData`, `TBImportIcd10Data`, `TBImportDeviceMotionData`, `TBImportDevice1HzMotionData`, `TBImportMedicationInpatientData`, `TBImportNursingDailyReportsData`).
Target schema reference: `db/schema.sql` (MS SQL Server dialect — Go models are the source of truth for Postgres).
Default dev credentials: user `healthmap`, password `healthmap_dev`, database `healthmap`.

## E2E Test Pipeline

`POST /api/test` — runs test fixtures through the full pipeline (upload → ML classify/map → DB import).

- Fixtures in `api/testdata/` with manifest at `api/testdata/manifest.json` (13 fixtures)
- Handler: `api/handlers/test.go`
- Run: `curl -X POST http://localhost:8080/api/test` (takes ~10min, LLM processes each file)

### Current Evaluation Results

Latest eval run (`eval_results.json`):

| File | Precision | Recall | F1 | Notes |
|------|-----------|--------|----|-------|
| synth_labs.csv | 1.0 | 0.21 | 0.35 | 13/62 correct — many cols unmapped |
| synth_cases_icd10_ops.csv | 1.0 | 0.73 | 0.84 | 8/11 correct |
| synth_device_motion_fall.csv | 1.0 | 0.75 | 0.86 | 6/8 correct |
| synth_device_raw_1hz_motion_fall.csv | 0.0 | 0.0 | 0.0 | Classification failed |
| synth_medication_raw_inpatient.csv | 0.0 | 0.0 | 0.0 | Classification failed |
| synth_nursing_daily_reports.csv | 0.0 | 0.0 | 0.0 | Classification failed |
| **Overall** | **1.0** | **0.208** | **0.344** | 27 correct, 0 wrong, 103 missed |

High precision (no wrong mappings) but low recall (many unmapped columns), with 3 files failing classification entirely.

### Important: Docker Volumes

**NEVER use `docker compose down -v`** — it wipes the Ollama model volume, forcing a ~20min re-download.
- Reset just the DB: `docker volume rm starthack2026_pgdata`
- Clear ML cache: delete rows from `tbMappingCache` table directly

## What Has Been Implemented

- File upload (CSV/XLSX/PDF) via drag-and-drop UI
- 4-stage ML pipeline (Extract → Inspect → Classify → Map) with LLM (qwen2.5:1.5b)
- LLM-powered table classification and column mapping with SHA256 caching
- Column batching for large files (>20 columns split across LLM calls)
- Post-mapping validation: reject invalid columns, case-insensitive fallback, many-to-one dedup
- Reference data integration from SQL Server .bak (valid columns + sample rows per table)
- German/abbreviated header examples in mapper prompt (30+ examples)
- Bulk import into Postgres with chunked inserts and row-level error recovery
- Case ID normalization (strips `CASE-` prefix, leading zeros, trailing sub-IDs)
- NULL string handling (NULL, N/A, NA, none, #N/A, NaN, Missing, unknow)
- Required field enforcement (coCaseId required, rows without it skipped)
- Interactive mapping editor in UI with confidence indicators (high/medium/low)
- Real-time job progress tracking via SSE (per-stage updates streamed to frontend)
- Job persistence (in-memory + DB)
- Anomaly detection in inspect stage (>50% nulls warning, duplicates, truncation)
- Profile data wired to API response (ProcessResponse includes profile + anomalies)
- Evaluation pipeline with precision/recall/F1 metrics and ground truth
- E2E test pipeline with 13 fixtures
- On-premises capable (all services in Docker, local Ollama LLM)
- Privacy-preserving (only column metadata sent to LLM, never raw patient data)

## Outstanding Items (Small Wins)

### Mapping Accuracy (biggest impact)
- **3 files fail classification** — device_raw_1hz, medication, nursing all return classification errors. Likely prompt tuning or model size issue (qwen2.5:1.5b may be too small for these).
- **Labs low recall** — Only 13/62 columns mapped. LLM leaves most unmapped. May need more specific few-shot examples or larger model.
- **Prompt tuning** — Column descriptions for ambiguous DB columns (e.g. value vs ref vs flag) could help LLM distinguish similar columns.

### Dashboard & UI
- **Data quality table** — `DataQualityTable.tsx` and `StatsCards.tsx` components exist but have limited backend data wired. Profile/anomaly data now available in API response but not fully displayed.
- **Duplicate file detection** — SHA256 content hash on FileUpload to prevent re-uploading identical files (~30 lines Go).

### Post-MVP (if time permits)
- epaAC pivot transform (5 different formats, complex)
- Cross-file case_id linking (case-centric view across labs/meds/nursing/devices)
- Full provenance tracking (source file + row number per imported record)
- Presentation materials (PowerPoint, architecture diagram, demo screenshots — 10% of judging)

## Build Notes

- Go is NOT installed on the WSL host — all Go compilation happens inside Docker: `docker compose build api`
- Ollama model (qwen2.5:1.5b, ~1GB) is stored in a named Docker volume `starthack2026_ollama_data`
- ML service caches by SHA256 of sorted column names — to force re-classification/re-mapping, delete from `tbMappingCache`

## Hackathon Judging

Viability 25%, Feasibility 20%, Complexity 20%, Creativity 15%, Design 10%, Presentation 10%.
