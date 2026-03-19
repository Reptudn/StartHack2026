"""Stages 3 & 4: LLM-powered Classifier and Mapper agents."""
import json
import logging
import re
from pathlib import Path
import httpx
from .schema import FileProfile, ClassifyResult, MapResult

logger = logging.getLogger(__name__)

# ── Load reference data (schema + sample rows) from extracted .bak ────────
_REF_PATH = Path(__file__).resolve().parent.parent / "reference_data.json"
_REFERENCE: dict = {}
if _REF_PATH.exists():
    with open(_REF_PATH) as f:
        _REFERENCE = json.load(f)
    logger.info("Loaded reference data for %d tables", len(_REFERENCE))
else:
    logger.warning("reference_data.json not found at %s — running without reference context", _REF_PATH)

# ── Build VALID_COLUMNS from reference data (dynamic, not hardcoded) ──────
VALID_COLUMNS: dict[str, set[str]] = {}
for _table, _info in _REFERENCE.items():
    VALID_COLUMNS[_table] = {c["name"] for c in _info["columns"]} - {"coId"}

# ── Target table descriptions (used in Classifier prompt) ──────────────────
TABLE_DESCRIPTIONS = """
1. tbCaseData — patient demographics and case master data. Key columns: coPatientId, coLastname, coFirstname, coGender, coDateOfBirth, coAgeYears, coTypeOfStay, coIcd, coDrgName. Use this ONLY for files with patient demographics (name, gender, date of birth). NOT for diagnosis/ICD-10 code files.

2. tbImportAcData — nursing care assessment scores (epaAC/ePA-AC). Key indicators: columns named like E0I001, E2I225, SID, IID, Einschätzung, FallID, PID, or assessment score codes. Files may use semicolon delimiters. Use this for ANY file with epaAC assessment data or columns matching E0I/E2I patterns.

3. tbImportLabsData — laboratory test results. Key columns: sodium, potassium, creatinine, glucose, hemoglobin, WBC, platelets, CRP, ALT, AST, bilirubin, albumin, INR, lactate. Each lab has value + flag + ref_low + ref_high columns. Use this for files with lab values and reference ranges.

4. tbImportIcd10Data — diagnosis and procedure codes. Key columns: primary_icd10_code, secondary_icd10_codes, ops_codes, ops_descriptions, length_of_stay_days, admission_date, discharge_date. Use this for files focused on ICD-10 diagnosis codes and OPS procedure codes. DISTINGUISH from tbCaseData: if the file has icd10_code/ops_codes columns, it belongs HERE, not in tbCaseData.

5. tbImportDeviceMotionData — hourly aggregated motion/fall sensor data. Key columns: movement_index, micro_movements_count, bed_exit_detected, fall_event, impact_magnitude, post_fall_immobility. Typically has patient_id + timestamp at hourly intervals.

6. tbImportDevice1HzMotionData — raw high-frequency (1Hz) motion sensor data. Key columns: accel_x, accel_y, accel_z, accel_magnitude, pressure_zone1-4, bed_occupied, movement_score, device_id. Has very many rows (100k+) at per-second frequency.

7. tbImportMedicationInpatientData — inpatient medication records. Key columns: record_type (ORDER/CHANGE/ADMIN), medication_code_atc, medication_name, dose, dose_unit, route, frequency, order_id, encounter_id, administration_status. Use this for any file with medication orders or administration records.

8. tbImportNursingDailyReportsData — nursing daily shift reports. Key columns: case_id, patient_id, ward, report_date, shift, nursing_note_free_text. The nursing_note_free_text column contains free-text clinical notes (may be in English or German). Use this for files with daily nursing narrative reports.
"""

# ── Build TABLE_COLUMNS strings from reference data ────────────────────────
TABLE_COLUMNS: dict[str, str] = {}
for _table, _cols in VALID_COLUMNS.items():
    TABLE_COLUMNS[_table] = ", ".join(sorted(_cols))

KNOWN_TABLES = set(TABLE_COLUMNS.keys())


def _build_reference_context(target_table: str) -> str:
    """Build a few-shot context string from reference data for the mapper prompt."""
    info = _REFERENCE.get(target_table)
    if not info or not info.get("sample_rows"):
        return ""

    # Show column name + type + one sample value
    col_types = {c["name"]: c["type"] for c in info["columns"] if c["name"] != "coId"}
    sample_row = info["sample_rows"][0]

    lines = []
    for col_name, col_type in col_types.items():
        sample_val = sample_row.get(col_name)
        if sample_val and sample_val.strip():
            lines.append(f"  {col_name} ({col_type}): e.g. {sample_val}")
        else:
            lines.append(f"  {col_name} ({col_type})")

    return "\n".join(lines)


def _dedup_mappings(mappings: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """Deduplicate many-to-one mappings: if multiple source cols map to the same
    target, keep the first one and move the rest to unmapped."""
    seen_targets: dict[str, str] = {}  # target_col -> first source_col
    deduped: dict[str, str] = {}
    dupes: list[str] = []

    for src, tgt in mappings.items():
        if tgt in seen_targets:
            logger.info("Dedup: %s -> %s (already mapped by %s)", src, tgt, seen_targets[tgt])
            dupes.append(src)
        else:
            seen_targets[tgt] = src
            deduped[src] = tgt

    return deduped, dupes


def _validate_mappings(mappings: dict[str, str], target_table: str) -> tuple[dict[str, str], list[str]]:
    """Remove any mapping whose target column doesn't exist in the DB schema."""
    valid_cols = VALID_COLUMNS.get(target_table)
    if not valid_cols:
        return mappings, []

    validated = {}
    rejected = []
    for src, tgt in mappings.items():
        if tgt in valid_cols:
            validated[src] = tgt
        else:
            # Try case-insensitive match
            match = next((vc for vc in valid_cols if vc.lower() == tgt.lower()), None)
            if match:
                validated[src] = match
                logger.info("Case-corrected mapping: %s -> %s (was %s)", src, match, tgt)
            else:
                rejected.append(f"{src}->{tgt}")
                logger.info("Rejected invalid mapping: %s -> %s (not in %s)", src, tgt, target_table)

    return validated, rejected


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
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False,
                      "format": "json",
                      "options": {"temperature": 0.1, "num_predict": 256}},
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            data = _parse_json(raw)
            table = data.get("target_table", "UNKNOWN")
            confidence = float(data.get("confidence", 0.0))
            reasoning = str(data.get("reasoning", ""))
            return ClassifyResult(target_table=table, confidence=confidence, reasoning=reasoning)
    except Exception as exc:
        logger.warning("classify failed: %s: %s", type(exc).__name__, exc)
        return ClassifyResult(target_table="UNKNOWN", confidence=0.0, reasoning=f"LLM call failed: {type(exc).__name__}")


_BATCH_SIZE = 20  # Max columns per LLM call to stay within num_predict token limits


def _build_mapper_prompt(columns: list, target_table: str, table_cols: str,
                         ref_section: str) -> str:
    """Build the mapper prompt for a batch of columns."""
    col_lines = "\n".join(
        f"  - {c.name} (type: {c.dtype}, samples: {c.sample_values[:3]})"
        for c in columns
    )
    return f"""/no_think
You are a healthcare data column mapper. Map each file column to the best matching database column.

TARGET TABLE: {target_table}
DATABASE COLUMNS (these are the ONLY valid targets — do NOT invent columns):
{table_cols}
{ref_section}
FILE COLUMNS (source data to map):
{col_lines}

MAPPING RULES:
1. You MUST only use column names from the DATABASE COLUMNS list above. Do NOT create new column names.
2. Database columns have a "co" prefix: e.g. "patient_id" -> "coPatient_id", "case_id" -> "coCaseId".
3. Map ALL columns you can match. Put truly unmappable columns in unmapped_columns.
4. Each database column can only be used ONCE. Do not map multiple source columns to the same target.

COMMON MAPPINGS (German/abbreviated headers → database columns):
  Na, Natrium → coSodium_mmol_L (sodium value, NOT cosodium_ref_high)
  Na_flag, sodium_flag → coSodium_flag
  Na_low, sodium_ref_low → cosodium_ref_low
  Na_high, sodium_ref_high → cosodium_ref_high
  K, Kalium → coPotassium_mmol_L
  Creat, Kreatinin → coCreatinine_mg_dL
  Hb, hemoglobin_g_dL → coHemoglobin_g_dL
  Aufnahmedatum, admission_date → coAdmission_date or coAdmission_datetime
  Entlassungsdatum, Entlassdatum → coDischarge_date or coDischarge_datetime
  Verweildauer_Tage, length_of_stay_days → coLength_of_stay_days
  station, Ward → coWard
  medikament, medication_name → coMedication_name
  NursingNote, nursing_note_free_text → coNursing_note_free_text
  CaseID, FallNr, case_id → coCaseId
  PatientID, PID, patient_id → coPatient_id or coPatientId
  ICD10_Haupt, primary_icd10_code → coPrimary_icd10_code
  OPS_Code, ops_codes → coOps_codes
  rec_type, record_type → coRecord_type
  dosis, dose → coDose
  einheit, dose_unit → coDose_unit
  haeufigkeit, frequency → coFrequency
  applikation, route → coRoute
  atc_code, medication_code_atc → coMedication_code_atc
  bei_bedarf, is_prn_0_1 → coIs_prn_0_1
  indikation, indication → coIndication
  start_dt, order_start_datetime → coOrder_start_datetime
  stop_dt, order_stop_datetime → coOrder_stop_datetime
  gabe_dt, administration_datetime → administration_datetime
  gegebene_dosis, administered_dose → administered_dose
  gabe_einheit, administered_unit → administered_unit
  gabe_status, administration_status → administration_status
  notiz, note → note
  verschreiber, prescriber_role → prescriber_role
  bestellung_status, order_status → order_status
  enc_id, encounter_id → coEncounter_id
  uuid, order_uuid → coOrder_uuid

IMPORTANT: For lab data, distinguish between VALUE columns and REFERENCE columns:
  - Na (the measured value) → coSodium_mmol_L
  - Na_flag (H/L/normal) → coSodium_flag
  - Na_low (reference range low) → cosodium_ref_low
  - Na_high (reference range high) → cosodium_ref_high
  Do NOT map the value column to a ref column!

Respond with ONLY valid JSON:
{{"mappings": {{"file_col": "db_col"}}, "unmapped_columns": ["col1"], "confidence": 0.9}}
"""


async def _map_batch(columns: list, target_table: str, table_cols: str,
                     ref_section: str, ollama_url: str, model: str,
                     batch_num: int, total_batches: int) -> tuple[dict[str, str], list[str], float]:
    """Map a single batch of columns. Returns (mappings, unmapped, confidence)."""
    prompt = _build_mapper_prompt(columns, target_table, table_cols, ref_section)
    logger.info("Mapping batch %d/%d (%d columns)", batch_num, total_batches, len(columns))

    async with httpx.AsyncClient(timeout=360.0) as client:
        resp = await client.post(
            f"{ollama_url}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False,
                  "format": "json",
                  "options": {"temperature": 0.1, "num_predict": 4096}},
        )
        resp.raise_for_status()
        raw = resp.json().get("response", "")
        logger.info("Batch %d/%d response length: %d chars", batch_num, total_batches, len(raw))
        data = _parse_json(raw)
        if not data:
            logger.warning("Batch %d: failed to parse JSON: %s", batch_num, raw[:500])
        mappings = {str(k): str(v) for k, v in data.get("mappings", {}).items()}
        unmapped = [str(c) for c in data.get("unmapped_columns", [])]
        confidence = float(data.get("confidence", 0.0))
        return mappings, unmapped, confidence


async def map_columns(profile: FileProfile, target_table: str,
                      ollama_url: str, model: str) -> MapResult:
    """Agent 2: Map file columns to target table columns.

    Splits into batches of _BATCH_SIZE columns to avoid exceeding LLM token limits.
    """
    table_cols = TABLE_COLUMNS.get(target_table, "")
    ref_context = _build_reference_context(target_table)

    ref_section = ""
    if ref_context:
        ref_section = f"""
DATABASE COLUMN DETAILS (name, SQL type, and example value from a correctly filled database):
{ref_context}
"""

    columns = list(profile.columns)
    batches = [columns[i:i + _BATCH_SIZE] for i in range(0, len(columns), _BATCH_SIZE)]
    total_batches = len(batches)

    if total_batches > 1:
        logger.info("Splitting %d columns into %d batches of ~%d", len(columns), total_batches, _BATCH_SIZE)

    all_mappings: dict[str, str] = {}
    all_unmapped: list[str] = []
    confidences: list[float] = []

    try:
        for i, batch in enumerate(batches, 1):
            mappings, unmapped, confidence = await _map_batch(
                batch, target_table, table_cols, ref_section,
                ollama_url, model, i, total_batches,
            )
            all_mappings.update(mappings)
            all_unmapped.extend(unmapped)
            confidences.append(confidence)

        # Post-processing: dedup many-to-one mappings (especially across batches)
        all_mappings, dupes = _dedup_mappings(all_mappings)
        if dupes:
            logger.info("Deduped %d many-to-one mappings: %s", len(dupes), dupes)
            all_unmapped.extend(dupes)

        # Post-processing: validate against known schema
        all_mappings, rejected = _validate_mappings(all_mappings, target_table)
        if rejected:
            logger.info("Rejected %d invalid mappings: %s", len(rejected), rejected)
            for r in rejected:
                src = r.split("->")[0]
                if src not in all_unmapped:
                    all_unmapped.append(src)

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        return MapResult(mappings=all_mappings, unmapped_columns=all_unmapped, confidence=avg_confidence)
    except Exception as exc:
        logger.warning("map_columns failed: %s: %s", type(exc).__name__, exc)
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
