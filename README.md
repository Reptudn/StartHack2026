# HealthMap

**Automated healthcare data harmonization powered by local LLMs.**

HealthMap is an on-premises platform that takes heterogeneous healthcare data files (CSV, XLSX, PDF, TSV) and automatically maps them to a unified relational schema. It uses a locally hosted language model to classify files and map columns, ensuring that no patient data ever leaves your infrastructure.

Built at [START Hack 2026](https://www.starthack.eu/) for the [epaCC](https://www.epacc.ch/) challenge.

---

## Table of Contents

- [Architecture](#architecture)
- [Data Flow](#data-flow)
- [Quick Start](#quick-start)
- [Services](#services)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Development](#development)
- [Evaluation](#evaluation)
- [Privacy and Security](#privacy-and-security)
- [License](#license)

---

## Architecture

HealthMap consists of five services orchestrated with Docker Compose:

```
                         +------------+
                         |   Web UI   |  :4242
                         | React / TS |
                         +------+-----+
                                |
                         +------v-----+
                         |  REST API  |  :8080
                         |  Go (Gin)  |
                         +--+------+--+
                            |      |
               +------------+      +------------+
               |                                |
        +------v------+                 +-------v------+
        | ML Pipeline |                 |  PostgreSQL  |  :5432
        |   FastAPI   |                 |     16       |
        +------+------+                 +--------------+
               |
        +------v------+
        |   Ollama    |  :11434
        | qwen2.5:1.5b|
        +-------------+
```

| Service      | Technology          | Port  | Role                                                |
|--------------|---------------------|-------|-----------------------------------------------------|
| **web**      | React 19, TypeScript, Vite | 4242  | Upload UI, interactive mapping editor, live progress |
| **api**      | Go (Gin + GORM)     | 8080  | File management, schema, import, SSE streaming      |
| **ml**       | Python (FastAPI)    | 5001  | 4-stage AI pipeline: extract, inspect, classify, map |
| **postgres** | PostgreSQL 16       | 5432  | Persistent storage for all data                      |
| **ollama**   | Ollama              | 11434 | Local LLM runtime                                   |

---

## Data Flow

1. **Upload** -- User uploads a healthcare data file through the web interface. The API persists the file to disk and creates a processing job.

2. **Extract** -- The ML service parses the raw file (CSV, XLSX, or PDF) into a structured DataFrame.

3. **Inspect** -- Column profiling runs across the DataFrame: data types, null percentages, sample values, and anomaly detection (high null rates, duplicates, truncation).

4. **Classify** -- The LLM receives only column metadata (names, types, null rates, up to 5 sample values per column) and determines which target table the file belongs to. Results are cached by a SHA-256 hash of the sorted column names.

5. **Map** -- The LLM maps each source column to the corresponding database column, working in batches of 20 columns to stay within token limits. Post-mapping validation rejects invalid columns, applies case-insensitive fallback, and deduplicates many-to-one mappings.

6. **Review** -- The user reviews the proposed mapping in an interactive editor. Columns below the 0.8 confidence threshold are flagged for manual review. Users can accept, edit, or ignore individual mappings.

7. **Import** -- On approval, the API bulk-inserts rows into the target table using chunked inserts (500 rows per chunk) with row-level error recovery.

Progress is reported after each stage via Server-Sent Events (SSE), giving the user real-time visibility into the pipeline.

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- At least 4 GB of available RAM (for the Ollama model)

### Launch

```bash
git clone https://github.com/Reptudn/StartHack2026.git
cd StartHack2026
docker compose up --build
```

On first launch, Ollama will download the `qwen2.5:1.5b` model (approximately 1 GB). Subsequent starts reuse the cached model from a named Docker volume.

Once all services are healthy:

- **Web UI**: [http://localhost:4242](http://localhost:4242)
- **API**: [http://localhost:8080/api/health](http://localhost:8080/api/health)

### Run the End-to-End Test Suite

```bash
curl -X POST http://localhost:8080/api/test
```

This processes 13 test fixtures through the full pipeline (upload, classify, map, import). It takes several minutes because each file is processed by the LLM.

### Stop Services

```bash
docker compose down
```

**Important:** Do not use `docker compose down -v`. The `-v` flag removes named volumes, which would delete the cached Ollama model and force a re-download. To reset only the database, remove the specific volume:

```bash
docker volume rm starthack2026_pgdata
```

---

## Services

### API (Go)

```bash
cd api
go mod tidy
go build -o main .
./main
```

Configuration is loaded from `api/.env.dev` (development) or `api/.env.prod` (production). Key variables: `DB_HOST`, `ML_SERVICE_URL`, `CORS_ORIGINS`.

### ML Pipeline (Python)

```bash
cd ml
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 5001
```

Configuration via environment: `OLLAMA_URL`, `OLLAMA_MODEL`, `GO_API_URL`.

### Web (React / TypeScript)

```bash
cd web
npm install
npm run dev
```

API URL configured via `VITE_API_URL` in `web/.env`.

---

## Database Schema

GORM auto-migrates all tables on API startup. The eight target healthcare tables are:

| Table                                | Description                  |
|--------------------------------------|------------------------------|
| `tbCaseData`                         | Patient case metadata        |
| `tbImportAcData`                     | Activity classification data |
| `tbImportLabsData`                   | Laboratory results           |
| `tbImportIcd10Data`                  | ICD-10 diagnoses and OPS procedures |
| `tbImportDeviceMotionData`           | Motion sensor events         |
| `tbImportDevice1HzMotionData`        | High-frequency motion data   |
| `tbImportMedicationInpatientData`    | Inpatient medication records |
| `tbImportNursingDailyReportsData`    | Nursing daily reports        |

All tables share a common primary key (`coId`, auto-increment) and a foreign key reference (`coCaseId`). The canonical schema definition is in `db/schema.sql`.

---

## API Reference

### File Operations

| Method | Endpoint                          | Description                          |
|--------|-----------------------------------|--------------------------------------|
| POST   | `/api/upload`                     | Upload a file and start processing   |
| GET    | `/api/files`                      | List all uploaded files              |
| GET    | `/api/files/:id`                  | Get file details and mapping result  |
| POST   | `/api/files/:id/import`           | Import mapped data into target table |
| POST   | `/api/files/:id/reprocess`        | Re-run the ML pipeline on a file     |
| DELETE | `/api/files/:id`                  | Delete a file and its records        |

### Progress and Validation

| Method | Endpoint                          | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/jobs/:id/stream`            | SSE stream of pipeline progress      |
| GET    | `/api/jobs/:id`                   | Get current job status               |
| GET    | `/api/files/:id/progress`         | Get processing progress for a file   |
| GET    | `/api/files/:id/validation`       | Get validation errors                |
| POST   | `/api/validation/:id/resolve`     | Resolve a validation error           |

### Table Data

| Method | Endpoint                          | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/tables`                     | List available tables                |
| GET    | `/api/tables/:name/data`          | Query table rows (paginated)         |
| GET    | `/api/tables/:name/columns`       | Get column names for a table         |
| PUT    | `/api/tables/:name/rows/:id`      | Update a row                         |
| DELETE | `/api/tables/:name/rows/:id`      | Delete a row                         |

### Other

| Method | Endpoint                          | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/health`                     | Health check                         |
| GET    | `/api/schema`                     | Get database schema information      |
| GET    | `/api/cache`                      | View mapping cache entries           |
| POST   | `/api/test`                       | Run end-to-end test pipeline         |

---

## Development

### Project Structure

```
StartHack2026/
  api/                    # Go REST API
    handlers/             # Route handlers (upload, import, progress, table data)
    models/               # GORM models for all tables
    database/             # Database connection and migration
    config/               # Environment-based configuration
    parser/               # CSV, XLSX, PDF file parsing
    testdata/             # E2E test fixtures (13 files)
  ml/                     # Python ML pipeline
    pipeline/
      extract.py          # Stage 1: file parsing
      inspect.py          # Stage 2: column profiling and anomaly detection
      agents.py           # Stage 3-4: LLM classification and mapping
      schema.py           # Pydantic models
      cache.py            # In-memory + write-through cache
    reference_data.json   # Valid columns and sample rows per table
    tests/                # Unit tests
  web/                    # React frontend
    src/
      components/         # Dashboard, FileUpload, MappingResult, etc.
      api.ts              # API client with SSE support
  db/
    schema.sql            # Target table definitions (MS SQL Server dialect)
  scripts/
    evaluate_pipeline.py  # Precision/recall/F1 evaluation harness
  docker-compose.yml
```

### Build Notes

- Go is compiled inside the Docker container. There is no requirement for a local Go installation.
- The Ollama model is stored in a named volume (`starthack2026_ollama_data`) and persists across container restarts.
- The ML service caches classification and mapping results by SHA-256 of the sorted column names. To force re-processing, delete the corresponding row from the `tbMappingCache` table.

---

## Evaluation

An evaluation pipeline compares LLM-generated mappings against ground truth annotations:

```bash
cd ml
python ../scripts/evaluate_pipeline.py
```

Ground truth is defined in `api/testdata/ground_truth.json`. Results are written to `eval_results.json` with per-file precision, recall, and F1 scores.

---

## Privacy and Security

HealthMap is designed for on-premises deployment. All processing happens locally:

- The LLM runs on your own hardware via Ollama. No data is sent to external AI services.
- Only column-level metadata (column names, data types, null percentages, and up to 5 sample values) is sent to the LLM. Raw patient records are never included in LLM prompts.
- The database, file storage, and all services run within your Docker network.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
