"""
ML Service — Maps uploaded file columns to the DB schema using Ollama.
"""

import json
import os
import re
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="HealthMap ML Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:0.8b")

# The DB schema embedded as a compact reference for the LLM
DB_SCHEMA = """
Tables and their columns:

1. tbCaseData: coId, coE2I222, coPatientId, coE2I223, coE2I228, coLastname, coFirstname, coGender, coDateOfBirth, coAgeYears, coTypeOfStay, coIcd, coDrgName, coRecliningType, coState

2. tbImportAcData: coId, coCaseId, coE0I001-coE0I083 (smallint assessment scores), coE2I001-coE2I232 (smallint/nvarchar clinical indicators), coE2I2000-coE2I2279 (smallint extended indicators), coMaxDekuGrad, coDekubitusWertTotal, coLastAssessment, coE3I0889, coCaseIdAlpha

3. tbImportLabsData: coId, coCaseId, coSpecimen_datetime, coSodium_mmol_L, coSodium_flag, cosodium_ref_low, cosodium_ref_high, coPotassium_mmol_L, coPotassium_flag, coPotassium_ref_low, coPotassium_ref_high, coCreatinine_mg_dL, coCreatinine_flag, coCreatinine_ref_low, coCreatinine_ref_high, coEgfr_mL_min_1_73m2, coEgfr_flag, coEgfr_ref_low, coEgfr_ref_high, coGlucose_mg_dL, coGlucose_flag, coGlucose_ref_low, coGlucose_ref_high, coHemoglobin_g_dL, coHb_flag, coHb_ref_low, coHb_ref_high, coWbc_10e9_L, coWbc_flag, coWbc_ref_low, coWbc_ref_high, coPlatelets_10e9_L, coPlatelets_flag, coPlt_ref_low, coPlt_ref_high, coCrp_mg_L, coCrp_flag, coCrp_ref_low, coCrp_ref_high, coAlt_U_L, coAlt_flag, coAlt_ref_low, coAlt_ref_high, coAst_U_L, coAst_flag, coAst_ref_low, coAst_ref_high, coBilirubin_mg_dL, coBilirubin_flag, coBili_ref_low, coBili_ref_high, coAlbumin_g_dL, coAlbumin_flag, coAlbumin_ref_low, coAlbumin_ref_high, coInr, coInr_flag, coInr_ref_low, coInr_ref_high, coLactate_mmol_L, coLactate_flag, coLactate_ref_low, coLactate_ref_high

4. tbImportIcd10Data: coId, coCaseId, coWard, coAdmission_date, coDischarge_date, coLength_of_stay_days, coPrimary_icd10_code, coPrimary_icd10_description_en, coSecondary_icd10_codes, cpSecondary_icd10_descriptions_en, coOps_codes, ops_descriptions_en

5. tbImportDeviceMotionData: coId, coCaseId, coTimestamp, coPatient_id, coMovement_index_0_100, coMicro_movements_count, coBed_exit_detected_0_1, coFall_event_0_1, coImpact_magnitude_g, coPost_fall_immobility_minutes

6. tbImportDevice1HzMotionData: coId, coCaseId, coTimestamp, coPatient_id, coDevice_id, coBed_occupied_0_1, coMovement_score_0_100, coAccel_x_m_s2, coAccel_y_m_s2, coAccel_z_m_s2, coAccel_magnitude_g, coPressure_zone1_0_100, coPressure_zone2_0_100, coPressure_zone3_0_100, coPressure_zone4_0_100, coBed_exit_event_0_1, coBed_return_event_0_1, coFall_event_0_1, coImpact_magnitude_g, coEvent_id

7. tbImportMedicationInpatientData: coId, coCaseId, coPatient_id, coRecord_type, coEncounter_id, coWard, coAdmission_datetime, coDischarge_datetime, coOrder_id, coOrder_uuid, coMedication_code_atc, coMedication_name, coRoute, coDose, coDose_unit, coFrequency, coOrder_start_datetime, coOrder_stop_datetime, coIs_prn_0_1, coIndication, prescriber_role, order_status, administration_datetime, administered_dose, administered_unit, administration_status, note

8. tbImportNursingDailyReportsData: coId, coCaseId, coPatient_id, coWard, coReport_date, coShift, coNursing_note_free_text
"""


class MappingRequest(BaseModel):
    headers: list[str]
    sample_rows: list[list[str]]
    filename: str


class ColumnMapping(BaseModel):
    file_column: str
    db_column: str
    confidence: str  # "high", "medium", "low"


class MappingResponse(BaseModel):
    target_table: str
    column_mappings: list[ColumnMapping]
    unmapped_columns: list[str]


@app.get("/health")
async def health():
    return {"status": "ok", "model": OLLAMA_MODEL}


@app.post("/api/map", response_model=MappingResponse)
async def map_columns(req: MappingRequest):
    """Ask Ollama to map file columns to DB schema."""

    # Build sample data preview
    sample_preview = "Headers: " + ", ".join(req.headers) + "\n"
    for i, row in enumerate(req.sample_rows[:3]):
        sample_preview += f"Row {i+1}: " + ", ".join(row) + "\n"

    prompt = f"""/no_think
You are a data mapping assistant. Given a file's column headers and sample data, determine which database table the data belongs to and map each file column to the correct database column.

DATABASE SCHEMA:
{DB_SCHEMA}

UPLOADED FILE: "{req.filename}"
{sample_preview}

INSTRUCTIONS:
1. Identify which ONE table this file's data maps to best.
2. For each file column, find the best matching database column in that table.
3. If a file column has no match, list it as unmapped.

Respond with ONLY valid JSON (no markdown, no explanation):
{{
  "target_table": "tableName",
  "column_mappings": [
    {{"file_column": "col_from_file", "db_column": "col_from_db", "confidence": "high"}},
    ...
  ],
  "unmapped_columns": ["col1", "col2"]
}}
"""

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 2048},
                },
            )
            resp.raise_for_status()
            result = resp.json()
            raw_text = result.get("response", "")

            # Parse the JSON from the LLM response
            mapping = _parse_llm_json(raw_text, req.headers)
            return mapping

    except httpx.HTTPStatusError as e:
        # Ollama not ready or model not loaded — return a fallback
        return _fallback_mapping(req.headers, f"Ollama error: {e.response.status_code}")
    except Exception as e:
        return _fallback_mapping(req.headers, str(e))


def _parse_llm_json(raw: str, headers: list[str]) -> MappingResponse:
    """Try to extract valid JSON from the LLM output."""
    # Try to find JSON in the response
    raw = raw.strip()

    # Remove markdown code fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
        return MappingResponse(
            target_table=data.get("target_table", "unknown"),
            column_mappings=[
                ColumnMapping(**cm) for cm in data.get("column_mappings", [])
            ],
            unmapped_columns=data.get("unmapped_columns", []),
        )
    except (json.JSONDecodeError, Exception):
        return _fallback_mapping(headers, "Failed to parse LLM response")


def _fallback_mapping(headers: list[str], error: str) -> MappingResponse:
    """Return a best-effort fallback when the LLM fails."""
    return MappingResponse(
        target_table=f"unknown (error: {error})",
        column_mappings=[],
        unmapped_columns=headers,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
