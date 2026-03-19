# ML Pipeline Stages 1–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single combined LLM call with a proper 4-stage pipeline (Extract → Inspect → Classify → Map), two specialized agents, `qwen2.5:3b`, XLSX/PDF support, mapping cache, and validation logging.

**Architecture:** The Python ML service receives raw file bytes from Go, runs 4 internal stages, and returns a single enriched JSON response. Go orchestrates but does not parse files. All DB writes stay in Go; ML service communicates with Go via HTTP for cache persistence and validation logs.

**Tech Stack:** Python 3.12, FastAPI, pandas, openpyxl, pdfplumber, httpx, pytest · Go 1.23, Gin, GORM, Postgres · Ollama `qwen2.5:3b`

---

## File Map

### ML service — new/modified
| File | Action | Responsibility |
|---|---|---|
| `ml/requirements.txt` | Modify | Add `pandas`, `openpyxl`, `pdfplumber`, `pytest`, `pytest-asyncio` |
| `ml/pipeline/__init__.py` | Create | Package marker |
| `ml/pipeline/schema.py` | Create | All Pydantic models shared across stages |
| `ml/pipeline/extract.py` | Create | Stage 1 — bytes → DataFrame + metadata |
| `ml/pipeline/inspect.py` | Create | Stage 2 — DataFrame → FileProfile |
| `ml/pipeline/agents.py` | Create | Stages 3 & 4 — Ollama LLM calls (Classifier + Mapper) |
| `ml/pipeline/cache.py` | Create | In-memory dict cache + Go API write-through |
| `ml/main.py` | Modify | Wire `/api/process`, remove `/api/map`, add `GO_API_URL` config |
| `ml/tests/__init__.py` | Create | Package marker |
| `ml/tests/test_extract.py` | Create | Tests for Stage 1 |
| `ml/tests/test_inspect.py` | Create | Tests for Stage 2 |
| `ml/tests/test_agents.py` | Create | Tests for Stages 3 & 4 (mock Ollama) |

### Go API — new/modified
| File | Action | Responsibility |
|---|---|---|
| `api/models/models.go` | Modify | Add `MLProcessResponse`, `MappingCache`, `ValidationLog`; remove old `MLMapping`/`MLMappingRequest` |
| `api/handlers/upload.go` | Modify | Send raw file to `/api/process`; parse `MLProcessResponse`; new status logic |
| `api/handlers/import.go` | Modify | Bind `MappingResult` JSON into `MLProcessResponse` instead of `MLMapping` |
| `api/handlers/log.go` | Create | `POST /api/log` — write `ValidationLog` row |
| `api/handlers/cache.go` | Create | `GET /api/cache` + `POST /api/cache` — read/write `MappingCache` rows |
| `api/parser/csv.go` | Modify | `DetectFileType`: accept `xlsx`, `xls`, `pdf` |
| `api/database/migrations.go` | Modify | AutoMigrate `MappingCache` + `ValidationLog` |
| `api/main.go` | Modify | Register `POST /api/log`, `GET /api/cache`, `POST /api/cache` |
| `docker-compose.yml` | Modify | `OLLAMA_MODEL` → `qwen2.5:3b`; add `GO_API_URL` to ml service |

> **Note on cache architecture:** The spec describes `tbMappingCache` as a DB table but assumes ML has DB access (which the spec also avoided for the validation log). This plan resolves the tension: ML uses an in-memory dict as the hot cache and writes through to Go's `POST /api/cache` for persistence. On ML service cold-start, Go's `GET /api/cache` is not pre-loaded — cache warms up organically. This is fine for a hackathon.

---

## Task 1: ML Dependencies and Module Scaffold

**Files:**
- Modify: `ml/requirements.txt`
- Create: `ml/pipeline/__init__.py`
- Create: `ml/pipeline/schema.py`
- Create: `ml/tests/__init__.py`

- [ ] **Step 1: Update `ml/requirements.txt`**

```
fastapi==0.115.0
uvicorn==0.30.6
httpx==0.27.2
pydantic==2.9.2
pandas==2.2.3
openpyxl==3.1.5
pdfplumber==0.11.4
pytest==8.3.3
pytest-asyncio==0.24.0
```

- [ ] **Step 2: Create `ml/pipeline/__init__.py`** (empty file)

- [ ] **Step 3: Create `ml/tests/__init__.py`** (empty file)

- [ ] **Step 4: Create `ml/pipeline/schema.py`** with all shared Pydantic models

```python
from pydantic import BaseModel
from typing import Any


class ColumnProfile(BaseModel):
    name: str
    dtype: str
    null_pct: float
    sample_values: list[str]


class FileProfile(BaseModel):
    filename: str
    format: str
    row_count: int
    columns: list[ColumnProfile]


class ClassifyResult(BaseModel):
    target_table: str
    confidence: float
    reasoning: str


class MapResult(BaseModel):
    mappings: dict[str, str]       # {file_col: db_col}
    unmapped_columns: list[str]
    confidence: float


class MLColumnMapping(BaseModel):
    file_column: str
    db_column: str
    confidence: str                # "high" | "medium" | "low"


class ProcessResponse(BaseModel):
    target_table: str
    confidence: float
    reasoning: str
    column_mappings: list[MLColumnMapping]
    unmapped_columns: list[str]
    row_count: int
    low_confidence: bool
    cache_hit: bool
```

- [ ] **Step 5: Commit scaffold**

```bash
git add ml/requirements.txt ml/pipeline/__init__.py ml/pipeline/schema.py ml/tests/__init__.py
git commit -m "feat(ml): scaffold pipeline package and shared Pydantic schemas"
```

---

## Task 2: Stage 1 — Extract

**Files:**
- Create: `ml/pipeline/extract.py`
- Create: `ml/tests/test_extract.py`

- [ ] **Step 1: Write `ml/tests/test_extract.py`**

```python
import io
import pytest
import pandas as pd
from ml.pipeline.extract import extract


def _csv_bytes(content: str) -> tuple[bytes, str]:
    return content.encode(), "test.csv"


def test_extract_csv_basic():
    data = "name,age\nAlice,30\nBob,25"
    df, meta = extract(*_csv_bytes(data))
    assert list(df.columns) == ["name", "age"]
    assert len(df) == 2
    assert meta["format"] == "csv"
    assert meta["row_count"] == 2


def test_extract_csv_semicolon_delimiter():
    data = "name;age\nAlice;30\nBob;25"
    df, meta = extract(data.encode(), "test.csv")
    assert list(df.columns) == ["name", "age"]
    assert len(df) == 2


def test_extract_tsv():
    data = "name\tage\nAlice\t30"
    df, meta = extract(data.encode(), "test.tsv")
    assert list(df.columns) == ["name", "age"]
    assert meta["format"] == "tsv"


def test_extract_empty_file_returns_unknown():
    df, meta = extract(b"", "empty.csv")
    assert df is None
    assert meta["format"] == "unknown"


def test_extract_unsupported_format_returns_unknown():
    df, meta = extract(b"some bytes", "file.zip")
    assert df is None
    assert meta["format"] == "unknown"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/noahw/projects/StartHack2026/ml
python -m pytest tests/test_extract.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError` or `ImportError` — extract module does not exist yet.

- [ ] **Step 3: Create `ml/pipeline/extract.py`**

```python
"""Stage 1: Extract raw file bytes into a pandas DataFrame + metadata dict."""
import io
from typing import Optional
import pandas as pd


def extract(file_bytes: bytes, filename: str) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Convert raw file bytes into a DataFrame.
    Returns (DataFrame, metadata) or (None, metadata) on failure.
    metadata keys: filename, format, encoding, row_count, column_names
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    fmt = _detect_format(ext)
    base_meta = {"filename": filename, "format": fmt, "encoding": "utf-8",
                 "row_count": 0, "column_names": []}

    if not file_bytes:
        base_meta["format"] = "unknown"
        return None, base_meta

    try:
        if fmt in ("csv", "tsv", "txt"):
            df = _read_delimited(file_bytes, fmt)
        elif fmt in ("xlsx", "xls"):
            df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
        elif fmt == "pdf":
            df = _read_pdf(file_bytes)
        else:
            base_meta["format"] = "unknown"
            return None, base_meta

        if df is None or df.empty:
            return None, {**base_meta, "format": "unknown"}

        # Normalise column names: strip whitespace
        df.columns = [str(c).strip() for c in df.columns]

        meta = {
            "filename": filename,
            "format": fmt,
            "encoding": "utf-8",
            "row_count": len(df),
            "column_names": list(df.columns),
        }
        return df, meta

    except Exception:
        base_meta["format"] = "unknown"
        return None, base_meta


def _detect_format(ext: str) -> str:
    return {
        "csv": "csv", "tsv": "tsv", "txt": "txt",
        "xlsx": "xlsx", "xls": "xls", "pdf": "pdf",
    }.get(ext, "unknown")


def _read_delimited(file_bytes: bytes, fmt: str) -> pd.DataFrame:
    text = file_bytes.decode("utf-8", errors="replace")
    first_line = text.split("\n", 1)[0]
    if fmt == "tsv" or first_line.count("\t") > first_line.count(","):
        sep = "\t"
    elif first_line.count(";") > first_line.count(","):
        sep = ";"
    else:
        sep = ","
    return pd.read_csv(io.StringIO(text), sep=sep, on_bad_lines="skip")


def _read_pdf(file_bytes: bytes) -> Optional[pd.DataFrame]:
    import pdfplumber
    rows = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if table:
                rows.extend(table)
    if not rows:
        return None
    headers = [str(h).strip() if h else f"col_{i}" for i, h in enumerate(rows[0])]
    data = [[str(c).strip() if c else "" for c in row] for row in rows[1:]]
    return pd.DataFrame(data, columns=headers)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/noahw/projects/StartHack2026/ml
python -m pytest tests/test_extract.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/pipeline/extract.py ml/tests/test_extract.py
git commit -m "feat(ml): implement Stage 1 extract with CSV/TSV/XLSX/PDF support"
```

---

## Task 3: Stage 2 — Inspect

**Files:**
- Create: `ml/pipeline/inspect.py`
- Create: `ml/tests/test_inspect.py`

- [ ] **Step 1: Write `ml/tests/test_inspect.py`**

```python
import pandas as pd
from ml.pipeline.inspect import inspect
from ml.pipeline.schema import FileProfile


def test_inspect_basic_profile():
    df = pd.DataFrame({"age": [30, 25, None], "name": ["Alice", "Bob", "Carol"]})
    meta = {"filename": "test.csv", "format": "csv", "row_count": 3, "column_names": ["age", "name"]}
    profile = inspect(df, meta)
    assert isinstance(profile, FileProfile)
    assert profile.row_count == 3
    assert len(profile.columns) == 2
    age_col = next(c for c in profile.columns if c.name == "age")
    assert round(age_col.null_pct, 2) == round(1/3, 2)
    assert len(age_col.sample_values) <= 5


def test_inspect_truncates_sample_values():
    df = pd.DataFrame({"x": range(100)})
    meta = {"filename": "big.csv", "format": "csv", "row_count": 100, "column_names": ["x"]}
    profile = inspect(df, meta)
    assert len(profile.columns[0].sample_values) == 5


def test_inspect_large_dataframe_stays_under_600_tokens():
    # 50 columns, 10k rows — profile should still be compact
    import string
    cols = {f"col_{c}": range(10000) for c in string.ascii_lowercase[:50]}
    df = pd.DataFrame(cols)
    meta = {"filename": "wide.csv", "format": "csv", "row_count": 10000,
            "column_names": list(df.columns)}
    profile = inspect(df, meta)
    # Rough token estimate: 4 chars ≈ 1 token
    profile_json = profile.model_dump_json()
    estimated_tokens = len(profile_json) / 4
    assert estimated_tokens < 600, f"Profile too large: ~{estimated_tokens:.0f} tokens"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/noahw/projects/StartHack2026/ml
python -m pytest tests/test_inspect.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `ml/pipeline/inspect.py`**

```python
"""Stage 2: Build a compact FileProfile from a DataFrame. Never sends raw data to LLM."""
import pandas as pd
from .schema import FileProfile, ColumnProfile


# Max sample values per column — keeps profile under ~600 tokens for any file
_MAX_SAMPLE = 5
# Max columns to profile — beyond this, truncate (very wide files)
_MAX_COLS = 40


def inspect(df: pd.DataFrame, meta: dict) -> FileProfile:
    """Convert a DataFrame into a compact FileProfile for LLM consumption."""
    cols_to_profile = list(df.columns)[:_MAX_COLS]
    column_profiles = []

    for col in cols_to_profile:
        series = df[col]
        null_pct = float(series.isna().mean())
        non_null = series.dropna()
        sample = [str(v) for v in non_null.head(_MAX_SAMPLE).tolist()]
        dtype = _friendly_dtype(series)
        column_profiles.append(ColumnProfile(
            name=col,
            dtype=dtype,
            null_pct=round(null_pct, 3),
            sample_values=sample,
        ))

    return FileProfile(
        filename=meta["filename"],
        format=meta["format"],
        row_count=meta["row_count"],
        columns=column_profiles,
    )


def _friendly_dtype(series: pd.Series) -> str:
    kind = series.dtype.kind
    return {"i": "int", "u": "int", "f": "float", "b": "bool",
            "M": "datetime", "O": "string", "U": "string"}.get(kind, "string")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/noahw/projects/StartHack2026/ml
python -m pytest tests/test_inspect.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/pipeline/inspect.py ml/tests/test_inspect.py
git commit -m "feat(ml): implement Stage 2 inspect — compact FileProfile builder"
```

---

## Task 4: Stages 3 & 4 — LLM Agents (Classifier + Mapper)

**Files:**
- Create: `ml/pipeline/agents.py`
- Create: `ml/tests/test_agents.py`

The DB schema for all 8 target tables lives in `agents.py` as a constant. Each agent makes one Ollama call with `temperature=0.1`, `num_predict=1024`, strips markdown fences, parses JSON, and falls back gracefully.

- [ ] **Step 1: Write `ml/tests/test_agents.py`**

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from ml.pipeline.schema import FileProfile, ColumnProfile
from ml.pipeline.agents import classify, map_columns


def _make_profile(cols: list[str]) -> FileProfile:
    return FileProfile(
        filename="test.csv", format="csv", row_count=100,
        columns=[ColumnProfile(name=c, dtype="string", null_pct=0.0,
                               sample_values=["a", "b"]) for c in cols]
    )


OLLAMA_URL = "http://ollama:11434"


@pytest.mark.asyncio
async def test_classify_returns_target_table():
    profile = _make_profile(["coSodium_mmol_L", "coCreatinine_mg_dL", "coCaseId"])
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "response": '{"target_table": "tbImportLabsData", "confidence": 0.95, "reasoning": "lab columns"}'
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await classify(profile, OLLAMA_URL, "qwen2.5:3b")

    assert result.target_table == "tbImportLabsData"
    assert result.confidence == 0.95


@pytest.mark.asyncio
async def test_classify_ollama_error_returns_unknown():
    profile = _make_profile(["col_a"])
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_client_cls.return_value = mock_client

        result = await classify(profile, OLLAMA_URL, "qwen2.5:3b")

    assert result.target_table == "UNKNOWN"
    assert result.confidence == 0.0


@pytest.mark.asyncio
async def test_map_returns_column_mappings():
    profile = _make_profile(["Natrium", "Kreatinin"])
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "response": '{"mappings": {"Natrium": "coSodium_mmol_L", "Kreatinin": "coCreatinine_mg_dL"}, "unmapped_columns": [], "confidence": 0.9}'
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await map_columns(profile, "tbImportLabsData", OLLAMA_URL, "qwen2.5:3b")

    assert result.mappings["Natrium"] == "coSodium_mmol_L"
    assert result.unmapped_columns == []


@pytest.mark.asyncio
async def test_map_bad_json_returns_empty_mappings():
    profile = _make_profile(["col_x"])
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"response": "sorry, I cannot help with that"}
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await map_columns(profile, "tbImportLabsData", OLLAMA_URL, "qwen2.5:3b")

    assert result.mappings == {}
    assert result.confidence == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/noahw/projects/StartHack2026/ml
python -m pytest tests/test_agents.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `ml/pipeline/agents.py`**

```python
"""Stages 3 & 4: LLM-powered Classifier and Mapper agents."""
import json
import re
import httpx
from .schema import FileProfile, ClassifyResult, MapResult


# ── Target table descriptions (used in Classifier prompt) ──────────────────
TABLE_DESCRIPTIONS = """
1. tbCaseData — patient case records: admission/discharge dates, ICD-10 codes, OPS codes, ward, demographics
2. tbImportAcData — nursing assessment scores: IID/SID item values, assessment dates, Dekubitus scores
3. tbImportLabsData — laboratory results: sodium, potassium, creatinine, glucose, haemoglobin, WBC, CRP, etc. with flags and reference ranges
4. tbImportIcd10Data — diagnosis codes: ICD-10 primary/secondary, OPS codes, length of stay, admission/discharge
5. tbImportDeviceMotionData — hourly aggregated motion sensor data: movement index, bed exit, fall events, impact magnitude
6. tbImportDevice1HzMotionData — raw 1Hz motion sensor data: accelerometer axes, pressure zones, bed occupancy, fall events
7. tbImportMedicationInpatientData — inpatient medication orders and administrations: ATC codes, dose, route, frequency, PRN flag
8. tbImportNursingDailyReportsData — nursing daily reports: ward, shift, free-text nursing notes (may be in German)
"""

# ── Target table column lists (used in Mapper prompt) ───────────────────────
TABLE_COLUMNS = {
    "tbCaseData": "coId, coE2I222, coPatientId, coE2I223, coE2I228, coLastname, coFirstname, coGender, coDateOfBirth, coAgeYears, coTypeOfStay, coIcd, coDrgName, coRecliningType, coState",
    "tbImportAcData": "coId, coCaseId, coE0I001..coE0I083 (assessment scores), coE2I001..coE2I232 (clinical indicators), coMaxDekuGrad, coDekubitusWertTotal, coLastAssessment, coCaseIdAlpha",
    "tbImportLabsData": "coId, coCaseId, coSpecimen_datetime, coSodium_mmol_L, coSodium_flag, cosodium_ref_low, cosodium_ref_high, coPotassium_mmol_L, coPotassium_flag, coPotassium_ref_low, coPotassium_ref_high, coCreatinine_mg_dL, coCreatinine_flag, coCreatinine_ref_low, coCreatinine_ref_high, coEgfr_mL_min_1_73m2, coEgfr_flag, coGlucose_mg_dL, coGlucose_flag, coHemoglobin_g_dL, coHb_flag, coWbc_10e9_L, coWbc_flag, coPlatelets_10e9_L, coPlatelets_flag, coCrp_mg_L, coCrp_flag, coAlt_U_L, coAlt_flag, coAst_U_L, coAst_flag, coBilirubin_mg_dL, coBilirubin_flag, coAlbumin_g_dL, coAlbumin_flag, coInr, coInr_flag, coLactate_mmol_L, coLactate_flag",
    "tbImportIcd10Data": "coId, coCaseId, coWard, coAdmission_date, coDischarge_date, coLength_of_stay_days, coPrimary_icd10_code, coPrimary_icd10_description_en, coSecondary_icd10_codes, coOps_codes",
    "tbImportDeviceMotionData": "coId, coCaseId, coTimestamp, coPatient_id, coMovement_index_0_100, coMicro_movements_count, coBed_exit_detected_0_1, coFall_event_0_1, coImpact_magnitude_g, coPost_fall_immobility_minutes",
    "tbImportDevice1HzMotionData": "coId, coCaseId, coTimestamp, coPatient_id, coDevice_id, coBed_occupied_0_1, coMovement_score_0_100, coAccel_x_m_s2, coAccel_y_m_s2, coAccel_z_m_s2, coAccel_magnitude_g, coPressure_zone1_0_100, coPressure_zone2_0_100, coPressure_zone3_0_100, coPressure_zone4_0_100, coBed_exit_event_0_1, coBed_return_event_0_1, coFall_event_0_1, coImpact_magnitude_g, coEvent_id",
    "tbImportMedicationInpatientData": "coId, coCaseId, coPatient_id, coRecord_type, coEncounter_id, coWard, coAdmission_datetime, coDischarge_datetime, coOrder_id, coMedication_code_atc, coMedication_name, coRoute, coDose, coDose_unit, coFrequency, coOrder_start_datetime, coOrder_stop_datetime, coIs_prn_0_1, coIndication, administration_datetime, administered_dose, administered_unit, administration_status, note",
    "tbImportNursingDailyReportsData": "coId, coCaseId, coPatient_id, coWard, coReport_date, coShift, coNursing_note_free_text",
}

KNOWN_TABLES = set(TABLE_COLUMNS.keys())


async def classify(profile: FileProfile, ollama_url: str, model: str) -> ClassifyResult:
    """Agent 1: Classify which target table a file belongs to."""
    prompt = f"""/no_think
You are a healthcare data classifier. Given a file profile, identify which database table the data belongs to.

TARGET TABLES:
{TABLE_DESCRIPTIONS}

FILE PROFILE:
Filename: {profile.filename}
Format: {profile.format}
Rows: {profile.row_count}
Columns: {', '.join(c.name for c in profile.columns)}
Sample values per column:
{chr(10).join(f"  {c.name}: {c.sample_values[:3]}" for c in profile.columns[:20])}

Respond with ONLY valid JSON, no explanation:
{{"target_table": "tableName", "confidence": 0.95, "reasoning": "one sentence"}}

If no table matches, use "UNKNOWN" with confidence 0.0.
"""
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False,
                      "options": {"temperature": 0.1, "num_predict": 256}},
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            data = _parse_json(raw)
            table = data.get("target_table", "UNKNOWN")
            confidence = float(data.get("confidence", 0.0))
            reasoning = str(data.get("reasoning", ""))
            return ClassifyResult(target_table=table, confidence=confidence, reasoning=reasoning)
    except Exception:
        return ClassifyResult(target_table="UNKNOWN", confidence=0.0, reasoning="LLM call failed")


async def map_columns(profile: FileProfile, target_table: str,
                      ollama_url: str, model: str) -> MapResult:
    """Agent 2: Map file columns to target table columns."""
    table_cols = TABLE_COLUMNS.get(target_table, "")
    prompt = f"""/no_think
You are a healthcare data column mapper. Map the file's columns to the database table's columns.

TARGET TABLE: {target_table}
DATABASE COLUMNS: {table_cols}

FILE COLUMNS AND SAMPLES:
{chr(10).join(f"  {c.name} ({c.dtype}): {c.sample_values[:3]}" for c in profile.columns)}

Rules:
- Map each file column to the single best matching database column
- Only map columns you are confident about
- List unmapped file columns separately

Respond with ONLY valid JSON, no explanation:
{{"mappings": {{"file_col": "db_col"}}, "unmapped_columns": ["col1"], "confidence": 0.9}}
"""
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False,
                      "options": {"temperature": 0.1, "num_predict": 1024}},
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            data = _parse_json(raw)
            mappings = {str(k): str(v) for k, v in data.get("mappings", {}).items()}
            unmapped = [str(c) for c in data.get("unmapped_columns", [])]
            confidence = float(data.get("confidence", 0.0))
            return MapResult(mappings=mappings, unmapped_columns=unmapped, confidence=confidence)
    except Exception:
        return MapResult(mappings={}, unmapped_columns=[c.name for c in profile.columns], confidence=0.0)


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    # Find first {...} block
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/noahw/projects/StartHack2026/ml
python -m pytest tests/test_agents.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/pipeline/agents.py ml/tests/test_agents.py
git commit -m "feat(ml): implement Classifier and Mapper LLM agents (Stages 3 & 4)"
```

---

## Task 5: In-Memory Cache

**Files:**
- Create: `ml/pipeline/cache.py`

No dedicated tests — the cache is a thin dict wrapper with a write-through HTTP call. Tested implicitly via the integration in Task 6.

- [ ] **Step 1: Create `ml/pipeline/cache.py`**

```python
"""
In-memory cache for classifier and mapper results.
Keyed by SHA256 of sorted column names (classifier) or sorted cols + target_table (mapper).
Write-through to Go's POST /api/cache for persistence.
"""
import hashlib
import httpx

# Hot cache: {column_hash: dict}
_cache: dict[str, dict] = {}


def make_classifier_key(column_names: list[str]) -> str:
    joined = "|".join(sorted(column_names))
    return hashlib.sha256(joined.encode()).hexdigest()


def make_mapper_key(column_names: list[str], target_table: str) -> str:
    joined = "|".join(sorted(column_names)) + "|" + target_table
    return hashlib.sha256(joined.encode()).hexdigest()


def get(key: str) -> dict | None:
    return _cache.get(key)


def put(key: str, entry: dict) -> None:
    _cache[key] = entry


async def write_through(key: str, entry: dict, go_api_url: str) -> None:
    """Persist cache entry to Go API (best-effort, never raises).

    Go's CacheWriteRequest expects:
      column_hash, target_table, column_mapping (JSON string), confidence

    The entry dict may contain 'mappings' (a dict) — serialize it to a JSON
    string under 'column_mapping' before sending.
    """
    import json as _json
    put(key, entry)
    payload = {
        "column_hash": key,
        "target_table": entry.get("target_table", ""),
        "column_mapping": _json.dumps(entry.get("mappings", {})),
        "confidence": entry.get("confidence", 0.0),
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"{go_api_url}/api/cache", json=payload)
    except Exception:
        pass  # Cache write failure is non-fatal
```

- [ ] **Step 2: Commit**

```bash
git add ml/pipeline/cache.py
git commit -m "feat(ml): add in-memory cache with Go write-through"
```

---

## Task 6: Wire `/api/process` Endpoint in `main.py`

**Files:**
- Modify: `ml/main.py`

Replace the existing `/api/map` endpoint with `/api/process`. The old `MappingRequest`/`MappingResponse` classes are removed. All logic moves to the pipeline modules.

- [ ] **Step 1: Replace `ml/main.py`**

```python
"""
ML Service — 4-stage pipeline: Extract → Inspect → Classify → Map
"""
import os
import httpx
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from pipeline.schema import ProcessResponse, MLColumnMapping
from pipeline.extract import extract
from pipeline.inspect import inspect
from pipeline.agents import classify, map_columns, KNOWN_TABLES
from pipeline import cache

app = FastAPI(title="HealthMap ML Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
GO_API_URL = os.getenv("GO_API_URL", "http://api:8080")

CONFIDENCE_THRESHOLD = 0.8


@app.get("/health")
async def health():
    return {"status": "ok", "model": OLLAMA_MODEL}


@app.post("/api/process", response_model=ProcessResponse)
async def process_file(file: UploadFile = File(...)):
    """Run the 4-stage pipeline on an uploaded file."""
    filename = file.filename or "unknown"
    file_bytes = await file.read()

    # ── Stage 1: Extract ────────────────────────────────────────────────────
    df, meta = extract(file_bytes, filename)
    if df is None:
        return ProcessResponse(
            target_table="UNKNOWN", confidence=0.0, reasoning="Extraction failed",
            column_mappings=[], unmapped_columns=[], row_count=0,
            low_confidence=True, cache_hit=False,
        )

    # ── Stage 2: Inspect ────────────────────────────────────────────────────
    profile = inspect(df, meta)

    col_names = [c.name for c in profile.columns]

    # ── Stage 3: Classify (Agent 1) — cache check first ────────────────────
    classifier_key = cache.make_classifier_key(col_names)
    cached = cache.get(classifier_key)
    classify_cache_hit = cached is not None

    if cached:
        target_table = cached["target_table"]
        confidence = cached["confidence"]
        reasoning = cached.get("reasoning", "")
    else:
        result = await classify(profile, OLLAMA_URL, OLLAMA_MODEL)
        target_table = result.target_table
        confidence = result.confidence
        reasoning = result.reasoning
        await cache.write_through(
            classifier_key,
            {"target_table": target_table, "confidence": confidence, "reasoning": reasoning},
            GO_API_URL,
        )

    low_confidence = confidence < CONFIDENCE_THRESHOLD or target_table not in KNOWN_TABLES
    if low_confidence:
        return ProcessResponse(
            target_table=target_table, confidence=confidence, reasoning=reasoning,
            column_mappings=[], unmapped_columns=[c.name for c in profile.columns],
            row_count=meta["row_count"], low_confidence=True,
            cache_hit=classify_cache_hit,
        )

    # ── Stage 4: Map (Agent 2) — cache check first ─────────────────────────
    mapper_key = cache.make_mapper_key(col_names, target_table)
    cached_map = cache.get(mapper_key)
    map_cache_hit = cached_map is not None

    if cached_map:
        mappings = cached_map.get("mappings", {})
        unmapped = cached_map.get("unmapped_columns", [])
        map_confidence = cached_map.get("confidence", 0.0)
    else:
        map_result = await map_columns(profile, target_table, OLLAMA_URL, OLLAMA_MODEL)
        mappings = map_result.mappings
        unmapped = map_result.unmapped_columns
        map_confidence = map_result.confidence
        await cache.write_through(
            mapper_key,
            {"target_table": target_table, "mappings": mappings,
             "unmapped_columns": unmapped, "confidence": map_confidence},
            GO_API_URL,
        )

    column_mappings = [
        MLColumnMapping(
            file_column=src,
            db_column=dst,
            confidence="high" if map_confidence >= 0.8 else "medium" if map_confidence >= 0.5 else "low",
        )
        for src, dst in mappings.items()
    ]

    return ProcessResponse(
        target_table=target_table,
        confidence=confidence,
        reasoning=reasoning,
        column_mappings=column_mappings,
        unmapped_columns=unmapped,
        row_count=meta["row_count"],
        low_confidence=False,
        cache_hit=classify_cache_hit or map_cache_hit,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
```

- [ ] **Step 2: Verify ML service starts locally**

```bash
cd /home/noahw/projects/StartHack2026/ml
pip install -r requirements.txt -q
python -c "from pipeline.extract import extract; from pipeline.inspect import inspect; from pipeline.agents import classify; print('imports OK')"
```

Expected: `imports OK`

- [ ] **Step 3: Commit**

```bash
git add ml/main.py
git commit -m "feat(ml): wire /api/process endpoint — 4-stage pipeline end-to-end"
```

---

## Task 7: Go — DB Models and Migrations

**Files:**
- Modify: `api/models/models.go`
- Modify: `api/database/migrations.go`

- [ ] **Step 1: Add new models to `api/models/models.go`**

Add after the `ValidationError` struct (which will be superseded by `ValidationLog`):

```go
// MappingCache stores LLM results keyed by column hash to avoid repeat LLM calls.
type MappingCache struct {
    ColumnHash    string     `json:"column_hash" gorm:"primaryKey;type:varchar(64)"`
    TargetTable   string     `json:"target_table" gorm:"type:varchar(100)"`
    ColumnMapping string     `json:"column_mapping" gorm:"type:jsonb"`
    Confidence    float64    `json:"confidence"`
    TimesUsed     int        `json:"times_used" gorm:"default:0"`
    CreatedAt     time.Time  `json:"created_at" gorm:"default:now()"`
}

func (MappingCache) TableName() string { return "tbMappingCache" }

// ValidationLog records pipeline stage outcomes for provenance.
type ValidationLog struct {
    ID           int64     `json:"id" gorm:"primaryKey;autoIncrement"`
    FileID       int64     `json:"file_id" gorm:"not null"`
    Stage        string    `json:"stage" gorm:"type:varchar(20)"`
    Severity     string    `json:"severity" gorm:"type:varchar(10)"`
    Message      string    `json:"message" gorm:"type:text"`
    AffectedRows int       `json:"affected_rows"`
    CreatedAt    time.Time `json:"created_at" gorm:"default:now()"`
}

func (ValidationLog) TableName() string { return "tbValidationLog" }
```

Also replace `MLMapping` and `MLMappingRequest` with `MLProcessResponse`:

```go
// MLProcessResponse is the response from POST /api/process on the ML service.
type MLProcessResponse struct {
    TargetTable     string            `json:"target_table"`
    Confidence      float64           `json:"confidence"`
    Reasoning       string            `json:"reasoning"`
    ColumnMappings  []MLColumnMapping `json:"column_mappings"`
    UnmappedColumns []string          `json:"unmapped_columns"`
    RowCount        int               `json:"row_count"`
    LowConfidence   bool              `json:"low_confidence"`
    CacheHit        bool              `json:"cache_hit"`
}
```

`MLColumnMapping` struct is unchanged.

Also update `UploadResponse` to use `MLProcessResponse`:

```go
type UploadResponse struct {
    File    FileUpload         `json:"file"`
    Mapping *MLProcessResponse `json:"mapping,omitempty"`
}
```

- [ ] **Step 2: Remove `ColumnsMapped` from `FileUpload` in `api/models/models.go`**

The `ColumnsMapped []string` field is no longer needed (row count and mappings come from the ML response). Remove it so AutoMigrate doesn't re-add a `columns_mapped` column after the `DROP COLUMN` in migrations.

```go
// Remove this field from FileUpload:
//   ColumnsMapped []string  `json:"columns_mapped" gorm:"type:jsonb;serializer:json"`
```

- [ ] **Step 3: Update `api/database/migrations.go`**

```go
package database

import (
    "log"
    "epaccdataunifier/models"
)

func RunMigrations() error {
    DB.Exec(`ALTER TABLE file_uploads DROP COLUMN IF EXISTS columns_mapped`)

    if err := DB.AutoMigrate(
        &models.FileUpload{},
        &models.MappingCache{},
        &models.ValidationLog{},
    ); err != nil {
        return err
    }

    // TODO: Add models.Job when async job queue (Redis) is implemented
    // TODO: Add models.FlaggedRecord when manual review/correction UI is built

    log.Println("[database] Migrations completed")
    return nil
}
```

- [ ] **Step 4: Verify Go compiles**

```bash
cd /home/noahw/projects/StartHack2026/api
go build ./...
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/models/models.go api/database/migrations.go
git commit -m "feat(api): add MappingCache, ValidationLog models; replace MLMapping with MLProcessResponse"
```

---

## Task 8: Go — `/api/log` and `/api/cache` Handlers

**Files:**
- Create: `api/handlers/log.go`
- Create: `api/handlers/cache.go`
- Modify: `api/main.go`

- [ ] **Step 1: Create `api/handlers/log.go`**

```go
package handlers

import (
    "net/http"
    "epaccdataunifier/database"
    "epaccdataunifier/models"
    "github.com/gin-gonic/gin"
)

type LogRequest struct {
    FileID       int64  `json:"file_id" binding:"required"`
    Stage        string `json:"stage" binding:"required"`
    Severity     string `json:"severity" binding:"required"`
    Message      string `json:"message" binding:"required"`
    AffectedRows int    `json:"affected_rows"`
}

func CreateLog(c *gin.Context) {
    var req LogRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
        return
    }
    entry := models.ValidationLog{
        FileID:       req.FileID,
        Stage:        req.Stage,
        Severity:     req.Severity,
        Message:      req.Message,
        AffectedRows: req.AffectedRows,
    }
    if err := database.DB.Create(&entry).Error; err != nil {
        c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Failed to write log"})
        return
    }
    c.JSON(http.StatusCreated, entry)
}
```

- [ ] **Step 2: Create `api/handlers/cache.go`**

```go
package handlers

import (
    "net/http"
    "epaccdataunifier/database"
    "epaccdataunifier/models"
    "github.com/gin-gonic/gin"
)

type CacheWriteRequest struct {
    ColumnHash    string  `json:"column_hash" binding:"required"`
    TargetTable   string  `json:"target_table"`
    ColumnMapping string  `json:"column_mapping"`
    Confidence    float64 `json:"confidence"`
}

// GetCache handles GET /api/cache?hash=xxx
func GetCache(c *gin.Context) {
    hash := c.Query("hash")
    if hash == "" {
        c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "hash query param required"})
        return
    }
    var entry models.MappingCache
    if err := database.DB.First(&entry, "column_hash = ?", hash).Error; err != nil {
        c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "cache miss"})
        return
    }
    c.JSON(http.StatusOK, entry)
}

// PostCache handles POST /api/cache — upsert a cache entry
func PostCache(c *gin.Context) {
    var req CacheWriteRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: err.Error()})
        return
    }
    entry := models.MappingCache{
        ColumnHash:    req.ColumnHash,
        TargetTable:   req.TargetTable,
        ColumnMapping: req.ColumnMapping,
        Confidence:    req.Confidence,
        TimesUsed:     1,
    }
    result := database.DB.Exec(`
        INSERT INTO "tbMappingCache" (column_hash, target_table, column_mapping, confidence, times_used, created_at)
        VALUES (?, ?, ?, ?, 1, now())
        ON CONFLICT (column_hash) DO UPDATE
        SET times_used = "tbMappingCache".times_used + 1,
            confidence = EXCLUDED.confidence,
            column_mapping = EXCLUDED.column_mapping
    `, entry.ColumnHash, entry.TargetTable, entry.ColumnMapping, entry.Confidence)
    if result.Error != nil {
        c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "cache write failed"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"ok": true})
}
```

- [ ] **Step 3: Register routes in `api/main.go`**

Add to the `api` route group:

```go
api.POST("/log", handlers.CreateLog)
api.GET("/cache", handlers.GetCache)
api.POST("/cache", handlers.PostCache)
```

- [ ] **Step 4: Verify Go compiles**

```bash
cd /home/noahw/projects/StartHack2026/api
go build ./...
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/handlers/log.go api/handlers/cache.go api/main.go
git commit -m "feat(api): add /api/log, /api/cache endpoints for ML service write-through"
```

---

## Task 9: Go — Update Upload Handler and File Type Gate

**Files:**
- Modify: `api/handlers/upload.go`
- Modify: `api/handlers/import.go`
- Modify: `api/parser/csv.go`

- [ ] **Step 1: Update `DetectFileType` in `api/parser/csv.go`**

Change the switch to:

```go
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
```

Also add a helper used by the upload handler:

```go
// IsDirectlyParseable returns true for formats Go's CSV parser handles.
// XLSX and PDF are forwarded to the ML service for extraction.
func IsDirectlyParseable(fileType string) bool {
    return fileType == "csv" || fileType == "tsv" || fileType == "txt"
}
```

- [ ] **Step 2: Rewrite the ML call section in `api/handlers/upload.go`**

Replace the block from `mlReq := models.MLMappingRequest{...}` through the end of the ML response handling with:

```go
// Send raw file to ML service /api/process
// Note: `savedPath` is the variable set earlier in this handler when the file
// was saved to disk (filepath.Join(h.Config.UploadDir, uuid+filename)).
var mapping *models.MLProcessResponse
mappingJSON := "{}"
status := "error"

mlReqBody := &bytes.Buffer{}
writer := multipart.NewWriter(mlReqBody)
part, err := writer.CreateFormFile("file", fileHeader.Filename)
if err == nil {
    // Re-open saved file for ML service
    mlFile, err2 := os.Open(savedPath)
    if err2 == nil {
        io.Copy(part, mlFile)
        mlFile.Close()
    }
}
writer.Close()

resp, err := http.Post(
    h.Config.MLServiceURL+"/api/process",
    writer.FormDataContentType(),
    mlReqBody,
)
if err != nil {
    log.Printf("[upload] ML service call failed: %v", err)
} else {
    defer resp.Body.Close()
    body, _ := io.ReadAll(resp.Body)
    var mlResp models.MLProcessResponse
    if err := json.Unmarshal(body, &mlResp); err == nil {
        mapping = &mlResp
        mappingJSON = string(body)
        switch {
        case mlResp.LowConfidence || mlResp.TargetTable == "UNKNOWN" || mlResp.TargetTable == "":
            status = "review"
        default:
            status = "mapped"
        }
    } else {
        log.Printf("[upload] Failed to parse ML response: %v", err)
    }
}
```

Also remove the CSV parse block used only for ML profiling. Keep only:
- The file save to disk (unchanged)
- The new ML call block above
- The `fileUpload` struct creation

The `RowCount` field: populate from `mapping.RowCount` if available, else 0.

Add `"mime/multipart"` to the import block alongside the existing `"net/http"` — both are needed (`multipart.NewWriter` builds the body, `http.Post` sends it).

- [ ] **Step 3: Update `api/handlers/import.go`** — change the JSON bind type

```go
// Line 22 — change:
var mapping models.MLMapping
// to:
var mapping models.MLProcessResponse
```

The rest of the import handler reads `mapping.ColumnMappings` — field name is unchanged.

- [ ] **Step 4: Verify Go compiles**

```bash
cd /home/noahw/projects/StartHack2026/api
go build ./...
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/handlers/upload.go api/handlers/import.go api/parser/csv.go
git commit -m "feat(api): send raw file to /api/process; accept xlsx/pdf; use MLProcessResponse"
```

---

## Task 10: Docker Compose and Model Upgrade

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update `OLLAMA_MODEL` and add `GO_API_URL` to ml service**

```yaml
  ml:
    build:
      context: ./ml
      dockerfile: Dockerfile
    ports:
      - "5001:5001"
    environment:
      OLLAMA_URL: http://ollama:11434
      OLLAMA_MODEL: ${OLLAMA_MODEL:-qwen2.5:3b}
      GO_API_URL: http://api:8080
    depends_on:
      ollama-pull:
        condition: service_completed_successfully
    restart: unless-stopped
    networks:
      - app
```

Also update the `ollama-pull` service default model reference:

```yaml
  ollama-pull:
    image: ollama/ollama:latest
    environment:
      - OLLAMA_HOST=http://ollama:11434
    command: pull ${OLLAMA_MODEL:-qwen2.5:3b}
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: upgrade default Ollama model to qwen2.5:3b; add GO_API_URL to ml service"
```

---

## Task 11: Smoke Test Full Stack

- [ ] **Step 1: Build and start all services**

```bash
cd /home/noahw/projects/StartHack2026
docker compose up --build -d
```

Wait for ollama-pull to complete (pulls ~2GB model — may take a few minutes first run).

- [ ] **Step 2: Verify ML service health**

```bash
curl -s http://localhost:5001/health | python3 -m json.tool
```

Expected:
```json
{"status": "ok", "model": "qwen2.5:3b"}
```

- [ ] **Step 3: Upload a CSV and check pipeline result**

```bash
curl -s -X POST http://localhost:8080/api/upload \
  -F "file=@<path-to-any-hackathon-csv>" \
  | python3 -m json.tool | head -40
```

Expected: response contains `target_table` (not `"unknown"`), `column_mappings` array with entries, `low_confidence: false` for a well-structured file.

- [ ] **Step 4: Verify DB tables were created**

```bash
docker compose exec postgres psql -U healthmap -d healthmap -c "\dt"
```

Expected: `tbMappingCache` and `tbValidationLog` appear in the table list alongside `file_uploads`.

- [ ] **Step 5: Upload the same CSV again — verify cache hit**

```bash
curl -s -X POST http://localhost:8080/api/upload \
  -F "file=@<same-csv>" \
  | python3 -m json.tool | grep cache_hit
```

Expected: `"cache_hit": true`

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: verify full stack smoke test passes"
```
