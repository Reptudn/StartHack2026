# Smart Health Data Mapping — Design Spec

**Date:** 2026-03-18
**Team:** 3 engineers (strong backend/data engineering), 36-hour hackathon
**Challenge:** Build an intelligent application that maps heterogeneous healthcare data into a unified case-centric schema with a quality dashboard.

---

## 1. System Architecture

Five Docker-composed services:

```
┌─────────────┐     ┌──────────────┐      ┌─────────────┐
│   Next.js   │────▶│   FastAPI    │────▶│    Redis    │
│  Dashboard  │◀────│   Backend    │      │  Job Queue  │
└─────────────┘     └──────┬───────┘      └──────┬──────┘
                           │                     │
                           ▼                     ▼
                    ┌─────────────┐     ┌───────────────┐
                    │  Postgres   │◀────│  ML Worker(s) │
                    │     DB      │     │   (Python)    │
                    └─────────────┘     └───────────────┘
```

**Request flow:**

1. User uploads file(s) via Next.js dashboard
2. FastAPI receives file, stores it, creates a job in Redis
3. ML Worker picks up the job and runs the 6-stage ingestion pipeline
4. Results written to Postgres; job status updated
5. Dashboard polls/streams job status, shows results, quality metrics, and flagged items

**On-prem story:** Everything runs in Docker. Swap the Claude API for a local model (Llama, Mistral) and the system is fully air-gapped.

## 2. Tech Stack

| Service | Technology | Role |
|---|---|---|
| `frontend` | Next.js, shadcn/ui, Recharts | File upload UI, job status, quality dashboard |
| `backend` | FastAPI (Python) | REST API, job dispatch, result fetching |
| `queue` | Redis + arq | Lightweight async job queue between FastAPI and workers |
| `ml-worker` | Python (Pandas, pdfplumber, Pydantic) | Data parsing, normalization, LLM-driven mapping |
| `db` | PostgreSQL | Unified output, job metadata, quality logs |
| `llm` | API (prototype); swappable to local model | Schema classification, column mapping, free-text extraction |

**Why FastAPI over Go:** Single language across backend + worker eliminates serialization friction, shared Pydantic models, and lets 2 of 3 team members work fluidly across both services.

## 3. Ingestion Pipeline (ML Worker)

Six-stage pipeline per incoming file:

```
File → [1. Extract] → [2. Inspect] → [3. Classify] → [4. Map] → [5. Transform] → [6. Validate & Load]
```

### Stage 1: Extract

Convert raw file into workable in-memory representation.

- **CSV/TSV** → Pandas DataFrame directly
- **XLSX** → Pandas via openpyxl
- **PDF** → Text extraction via pdfplumber/pymupdf, then structured parsing or LLM
- **Free text** — Already in CSV; the `nursing_note_free_text` column routed to LLM extraction

Output: DataFrame + metadata (filename, encoding, row count, column names, sample rows).

### Stage 2: Inspect

Build a compact "file profile" for the agent:

- Column names and inferred dtypes
- Sample of first 5 rows
- Null percentages per column
- Unique value counts for low-cardinality columns
- Detected ID patterns (e.g., `CASE-0135` format)

Only this profile is sent to the LLM — never the full dataset. A 100k-row CSV becomes ~500 tokens.

### Stage 3: Classify

LLM call receives the file profile and answers: which target table does this belong to?

Possible outputs:
- `tbImportAcData`
- `tbImportLabsData`
- `tbImportNursingDailyReports`
- `tbImportMedicationInpatientData`
- `tbImportDeviceMotionData`
- `tbCaseData`
- `UNKNOWN` → flag for human review

Returns confidence score. Below 0.8 → flag for review.

**Mapping cache:** Classification keyed by hash of (sorted column-name set + target table). Including the target table in the key prevents collisions when different source types share column names. Same schema seen again → skip LLM.

### Stage 4: Map

Second LLM call receives file profile + target table schema, returns column mapping:

```json
{
  "mappings": { "Natrium": "sodium_value", "patient_id": "patient_id" },
  "unmapped_columns": ["some_unknown_col"],
  "confidence": 0.92
}
```

Also cached by column-name hash.

### Stage 5: Transform

**Deterministic code, no LLM.** Applies the mapping from Stage 4:

- Rename columns per mapping
- Normalize `case_id` formats (`CASE-0135`, `0135`, `135` → integer)
- Replace null-equivalent strings (`NULL`, `Missing`, `unknow`, `NaN`, `N/A`, whitespace-only) with actual NULL
- Type coercion (dates, numerics, booleans)
- Deduplicate epaAC data (keep last record per IID — "last" defined by row order in file, as the README states "the last record is authoritative" with no timestamp to sort by)
- For nursing free text: LLM extracts structured fields (symptoms, observations, actions, evaluation) from German text

**Lab data wide-to-long pivot:** The `synth_labs_1000_cases.csv` stores labs in wide format (one column per parameter). Transform stage melts this into long format:
1. Detect parameter groups by column naming convention: `{ParameterName}`, `{ParameterName}_flag`, `{ParameterName}_ref_low`, `{ParameterName}_ref_high`
2. Use Pandas `melt` to pivot each group into rows: `parameter_name`, `value`, `flag`, `ref_low`, `ref_high`
3. `unit` is not present in the source data — infer from parameter name using a static lookup table (e.g., Natrium → mmol/L, Kreatinin → mg/dL). Where unknown, store as NULL and flag.

**epaAC format handling:** The 5 epaAC files represent the same assessment data in structurally different layouts:
- **Data-1** (row-per-IID): Each row is one item. Group by assessment episode, extract IID → SID → item values.
- **Data-2** (wide SID-based): One row per assessment, columns are SIDs. Use `IID-SID-ITEM.csv` lookup to map SID numbers to item names.
- **Data-3** (wide text-header): One row per assessment, columns are human-readable item names. Use `IID-SID-ITEM.csv` to map text headers to canonical IIDs.
- **Data-4** (XLSX): Same structure as Data-3 but in Excel format. Use openpyxl extraction, then same mapping logic.
- **Data-5** (encrypted headers): Headers are obfuscated. Strategy: pass header sample to the LLM mapper agent, which attempts to match against known IID/SID patterns. If confidence is low, flag for human review. This is the stretch goal — tackle last.

**epaAC JSONB structure:** `tbImportAcData.item_values` stores a flat key-value object where keys are canonical item identifiers (IIDs) and values are the assessment scores: `{"E0I001": 3, "E2I225": 1, "E2I222": 2}`. One row per assessment episode.

**Raw 1Hz device motion data:** `synthetic_device_raw_1hz_motion_fall.csv` (108k rows, accelerometer + pressure zones at 1Hz) does not map to `tbImportDeviceMotionData`'s hourly-aggregated schema. Decision: **aggregate to hourly** to match the existing target schema. Compute per-hour: mean `movement_score`, count of `bed_exit_event`, max `impact_magnitude_g`, detect `fall_event` presence. Columns without a target mapping (individual accelerometer axes, pressure zones) are stored as a JSONB `raw_summary` column on `tbImportDeviceMotionData` for future use.

### Stage 6: Validate & Load

Validation checks before writing to Postgres:

- **Mandatory fields:** `case_id` and `patient_id` present → drop rows where missing
- **Referential integrity:** `case_id` exists in `tbCaseData`? Flag orphans
- **Value range checks:** Lab values within plausible clinical ranges, timestamps not in future
- **Schema conformance:** All required target columns present and correctly typed

Valid rows → Postgres. Validation report → `tbJobResults` metadata table.

## 4. Agent Design

Three specialized LLM calls, each with focused task and structured output:

### Agent 1: Classifier
- **Input:** File profile
- **Output:** `{ target_table: string, confidence: float, reasoning: string }`
- **System prompt:** Target schema descriptions and known data patterns
- **Cacheable:** Yes

### Agent 2: Mapper
- **Input:** File profile + target table schema definition
- **Output:** `{ mappings: { source: target }, unmapped_columns: [], confidence: float }`
- **System prompt:** Target table column definitions, expected types, known naming conventions
- **Cacheable:** Yes

### Agent 3: Free Text Extractor
- **Input:** Single German nursing note
- **Output:** `{ symptoms: [], observations: [], actions: [], evaluation: string, confidence: float }`
- **System prompt:** Clinical NLP instructions, German medical terminology, extraction examples
- **Not cacheable** — every note is unique

### Design principles:
- **Structured outputs only** — every LLM call returns JSON, validated against Pydantic schema
- **Confidence thresholds** — below 0.8 → flag for human review
- **Fail safe** — invalid JSON or unknown target → job flagged, never silently loaded
- **Token efficiency** — only file profiles sent to LLM, never raw data

## 5. Database Schema

### Core tables (required by challenge)

All core tables include `job_id (FK)`, `source_file`, and `source_row_number` for provenance tracking.

```sql
tbCaseData
  -- case_id (PK), patient_id, sex, age, ward, admission_date,
  -- discharge_date, primary_icd10_code, primary_icd10_description,
  -- secondary_icd10_codes, ops_codes, length_of_stay,
  -- job_id (FK), source_file, source_row_number

tbImportAcData
  -- id (PK), case_id (FK), assessment_type, assessment_date,
  -- iid, sid, item_values (JSONB),
  -- job_id (FK), source_file, source_row_number

tbImportLabsData
  -- id (PK), case_id (FK), patient_id, specimen_datetime,
  -- parameter_name, value, unit, flag, ref_low, ref_high,
  -- job_id (FK), source_file, source_row_number

tbImportNursingDailyReports
  -- id (PK), case_id (FK), patient_id, ward, report_date, shift,
  -- raw_text, extracted_symptoms, extracted_actions, extracted_evaluation,
  -- job_id (FK), source_file, source_row_number

tbImportMedicationInpatientData
  -- id (PK), case_id (FK), encounter_id, record_type,
  -- medication_code_atc, medication_name, dose, dose_unit, route,
  -- frequency, order_start, order_stop, is_prn,
  -- administration_datetime, administered_dose, administered_unit, administration_status, note,
  -- job_id (FK), source_file, source_row_number

tbImportDeviceMotionData
  -- id (PK), patient_id, timestamp, movement_index,
  -- micro_movements_count, bed_exit_detected, fall_event,
  -- impact_magnitude_g, post_fall_immobility_minutes,
  -- raw_summary (JSONB, for 1Hz aggregated extra columns),
  -- job_id (FK), source_file, source_row_number
```

**Notes:**
- Device motion data uses `patient_id` for referential integrity (no `case_id` in source). Validated against `tbCaseData.patient_id`.
- Medication `encounter_id` is treated as a 1:1 alias for `case_id` — the mapper links them via `patient_id` + admission date overlap. If ambiguous, flag for review.

### System tables

```sql
tbJobs
  -- job_id (PK), filename, status (queued/processing/completed/failed),
  -- target_table, rows_received, rows_loaded, rows_dropped, rows_flagged,
  -- retry_count (default 0, max 1), error_message,
  -- created_at, completed_at

tbMappingCache
  -- column_hash (PK), target_table, column_mapping (JSONB),
  -- confidence, times_used, created_at

tbValidationLog
  -- id (PK), job_id (FK), check_type, severity, message,
  -- affected_rows, details (JSONB)

tbFlaggedRecords
  -- id (PK), job_id (FK), row_data (JSONB), flag_reason,
  -- resolved (bool), resolved_by, resolved_at
```

**Key decisions:**
- Lab data in **long format** (one row per parameter) — normalizes cleanly, accommodates any lab parameter
- Nursing reports keep **both** raw text and extracted structured fields — auditable, humans can correct
- Mapping cache enables the system to improve without retraining
- Flagged records power the manual correction UI

## 6. Dashboard

Four views, kept lean:

### Upload & Jobs
- Drag-and-drop file upload (single or batch)
- Job queue with live status via server-sent events (SSE endpoint on FastAPI, no WebSockets)
- Per-job summary: rows loaded/dropped/flagged, elapsed time

### Data Quality Overview
- Table-level completeness heatmap
- Per-table: column-level null percentages, row counts, last import
- Global stats: total records, total flagged, average mapping confidence

### Anomalies & Flags
- List of flagged records with reason
- Inline correction: see raw source alongside proposed mapping, approve or correct
- Corrections logged to validation log

### Provenance
- Pick any unified record → trace to source file, row number, applied mapping
- Shows agent classification reasoning and confidence

### Not building:
- No auth, no complex filtering, no export, no multi-tenant

## 7. Execution Plan (36 Hours)

| Timeslot | Person 1 (Pipeline Lead) | Person 2 (Pipeline/Backend) | Person 3 (Frontend) |
|---|---|---|---|
| **H0-3** | Docker compose, Postgres schema, scaffolding | ML worker skeleton, file extractors (CSV/XLSX/PDF) | Next.js setup, upload UI, job status view |
| **H3-8** | Agent prompts — classifier & mapper, Pydantic schemas, caching | Transform stage — ID normalization, nulls, types, dedup | FastAPI endpoints — upload, job creation, status polling |
| **H8-14** | Free text extractor agent, integrate with pipeline | Validation stage — mandatory fields, range checks, referential integrity, load | Quality overview page, completeness heatmap |
| **H14-20** | End-to-end: run all hackathon files through pipeline, fix edge cases | Flagged records + correction API, validation log endpoints | Anomalies & flags view, inline correction UI |
| **H20-26** | Pipeline hardening, epaAC 5-format edge cases | Provenance tracking — source → target lineage | Provenance view, UI polish |
| **H26-30** | Integration testing, demo rehearsal | Integration testing, demo rehearsal | Responsive fixes, final polish |
| **H30-36** | Presentation prep, architecture diagrams | Demo data prep, backup recordings | Slides, screenshots |

### Critical path:
Pipeline must work end-to-end by **H20**. After that is hardening and polish.

### Risk mitigations:
- **epaAC formats:** Tackle 3 CSV formats first, XLSX second, encrypted headers last (flag as future work if needed)
- **PDF parsing:** If unreliable, demo with simulated PDF — show the architecture handles it
- **LLM latency:** Batch nursing notes, parallelize across Redis workers
