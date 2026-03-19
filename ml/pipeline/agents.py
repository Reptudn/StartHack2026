"""Stages 3 & 4: LLM-powered Classifier and Mapper agents."""
import json
import logging
import re
import httpx
from .schema import FileProfile, ClassifyResult, MapResult

logger = logging.getLogger(__name__)

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
    except Exception as exc:
        logger.warning("classify failed: %s", exc)
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
    except Exception as exc:
        logger.warning("map_columns failed: %s", exc)
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
