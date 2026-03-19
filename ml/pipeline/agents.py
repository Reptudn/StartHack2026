"""Stages 3 & 4: LLM-powered Classifier and Mapper agents."""
import json
import logging
import re
import httpx
from .schema import FileProfile, ClassifyResult, MapResult

logger = logging.getLogger(__name__)

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

# ── Target table column lists (used in Mapper prompt) ───────────────────────
TABLE_COLUMNS = {
    "tbCaseData": "coId, coE2I222, coPatientId, coE2I223, coE2I228, coLastname, coFirstname, coGender, coDateOfBirth, coAgeYears, coTypeOfStay, coIcd, coDrgName, coRecliningType, coState",
    "tbImportAcData": "coId, coCaseId, coE0I001..coE0I083 (assessment scores), coE2I001..coE2I232 (clinical indicators), coMaxDekuGrad, coDekubitusWertTotal, coLastAssessment, coCaseIdAlpha",
    "tbImportLabsData": "coId, coCaseId, coSpecimen_datetime, coSodium_mmol_L, coSodium_flag, cosodium_ref_low, cosodium_ref_high, coPotassium_mmol_L, coPotassium_flag, coPotassium_ref_low, coPotassium_ref_high, coCreatinine_mg_dL, coCreatinine_flag, coCreatinine_ref_low, coCreatinine_ref_high, coEgfr_mL_min_1_73m2, coEgfr_flag, coGlucose_mg_dL, coGlucose_flag, coHemoglobin_g_dL, coHb_flag, coWbc_10e9_L, coWbc_flag, coPlatelets_10e9_L, coPlatelets_flag, coCrp_mg_L, coCrp_flag, coAlt_U_L, coAlt_flag, coAst_U_L, coAst_flag, coBilirubin_mg_dL, coBilirubin_flag, coAlbumin_g_dL, coAlbumin_flag, coInr, coInr_flag, coLactate_mmol_L, coLactate_flag",
    "tbImportIcd10Data": "coId, coCaseId, coWard, coAdmission_date, coDischarge_date, coLength_of_stay_days, coPrimary_icd10_code, coPrimary_icd10_description_en, coSecondary_icd10_codes, cpSecondary_icd10_descriptions_en, coOps_codes, ops_descriptions_en",
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
        logger.warning("classify failed: %s", exc)
        return ClassifyResult(target_table="UNKNOWN", confidence=0.0, reasoning="LLM call failed")


async def map_columns(profile: FileProfile, target_table: str,
                      ollama_url: str, model: str) -> MapResult:
    """Agent 2: Map file columns to target table columns."""
    table_cols = TABLE_COLUMNS.get(target_table, "")
    prompt = f"""/no_think
You are a healthcare data column mapper. Map each file column to the best matching database column.

TARGET TABLE: {target_table}
DATABASE COLUMNS (available targets):
{table_cols}

FILE COLUMNS (source data):
{chr(10).join(f"  - {c.name} (type: {c.dtype}, samples: {c.sample_values[:3]})" for c in profile.columns)}

INSTRUCTIONS:
1. For each file column, find the database column with the most similar name and meaning.
2. Column names often match with simple transformations: e.g. "sodium_mmol_L" -> "coSodium_mmol_L", "patient_id" -> "coPatient_id", "case_id" -> "coCaseId".
3. The database columns typically have a "co" prefix followed by the column name.
4. Map ALL columns you can match, even if the match is approximate.
5. List truly unmappable columns in unmapped_columns.

Respond with ONLY valid JSON:
{{"mappings": {{"sodium_mmol_L": "coSodium_mmol_L", "patient_id": "coPatient_id"}}, "unmapped_columns": ["unknown_col"], "confidence": 0.9}}
"""
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False,
                      "format": "json",
                      "options": {"temperature": 0.1, "num_predict": 4096}},
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            logger.info("map_columns raw response length: %d chars", len(raw))
            data = _parse_json(raw)
            if not data:
                logger.warning("map_columns: failed to parse JSON from response: %s", raw[:500])
            mappings = {str(k): str(v) for k, v in data.get("mappings", {}).items()}
            unmapped = [str(c) for c in data.get("unmapped_columns", [])]
            confidence = float(data.get("confidence", 0.0))
            return MapResult(mappings=mappings, unmapped_columns=unmapped, confidence=confidence)
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
