"""
ML Service — 4-stage pipeline: Extract → Inspect → Classify → Map
Reports rich progress to the API after each stage when job_id is provided.
"""

import json
import logging
import os
import httpx
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from pipeline.schema import ProcessResponse, MLColumnMapping
from pipeline.extract import extract
from pipeline.inspect import inspect
from pipeline.agents import classify, map_columns, KNOWN_TABLES
from pipeline import cache

logger = logging.getLogger(__name__)

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


async def _report_progress(
    job_id: Optional[str],
    stage: str,
    message: str,
    percent: int,
    data: Optional[dict] = None,
):
    """POST rich progress to the API's job tracking endpoint. Fire-and-forget."""
    if not job_id:
        return
    try:
        payload = {
            "stage": stage,
            "message": message,
            "percent": percent,
        }
        if data:
            payload["data"] = data
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{GO_API_URL}/api/jobs/{job_id}/progress",
                json=payload,
            )
    except Exception as exc:
        logger.debug("progress callback failed (non-fatal): %s", exc)


@app.get("/health")
async def health():
    return {"status": "ok", "model": OLLAMA_MODEL}


@app.post("/api/process", response_model=ProcessResponse)
async def process_file(
    file: UploadFile = File(...),
    job_id: Optional[str] = Form(None),
):
    """Run the 4-stage pipeline on an uploaded file with rich progress reporting."""
    filename = file.filename or "unknown"
    file_bytes = await file.read()

    # ── Stage 1: Extract ────────────────────────────────────────────────────
    await _report_progress(
        job_id,
        "extract",
        f"Reading {filename}...",
        5,
        {
            "filename": filename,
            "file_size_kb": round(len(file_bytes) / 1024, 1),
        },
    )

    df, meta = extract(file_bytes, filename)
    if df is None:
        await _report_progress(
            job_id,
            "error",
            "File extraction failed — unsupported format or empty file",
            0,
            {
                "filename": filename,
                "reason": "extraction_failed",
            },
        )
        return ProcessResponse(
            target_table="UNKNOWN",
            confidence=0.0,
            reasoning="Extraction failed",
            column_mappings=[],
            unmapped_columns=[],
            row_count=0,
            low_confidence=True,
            cache_hit=False,
        )

    row_count = meta["row_count"]
    col_count = len(df.columns)
    columns = list(df.columns)

    await _report_progress(
        job_id,
        "extract",
        f"Parsed {row_count:,} rows, {col_count} columns ({meta['format'].upper()} format)",
        15,
        {
            "filename": filename,
            "format": meta["format"],
            "row_count": row_count,
            "column_count": col_count,
            "columns": columns,
        },
    )

    # ── Stage 2: Inspect ────────────────────────────────────────────────────
    await _report_progress(
        job_id,
        "inspect",
        "Analyzing column types and data patterns...",
        20,
        {
            "columns": columns,
            "row_count": row_count,
        },
    )

    profile = inspect(df, meta)

    col_names = [c.name for c in profile.columns]
    col_profiles = [
        {
            "name": c.name,
            "dtype": c.dtype,
            "null_pct": round(c.null_pct * 100, 1),
            "sample_values": c.sample_values[:3],
        }
        for c in profile.columns
    ]

    await _report_progress(
        job_id,
        "inspect",
        f"Profiled {len(col_names)} columns — detected types, nulls, and sample values",
        30,
        {
            "columns": col_names,
            "column_profiles": col_profiles,
            "row_count": row_count,
            "format": meta["format"],
        },
    )

    # ── Stage 3: Classify (Agent 1) — cache check first ────────────────────
    classifier_key = cache.make_classifier_key(col_names)
    cached = cache.get(classifier_key)
    classify_cache_hit = cached is not None

    if cached:
        target_table = cached["target_table"]
        confidence = cached["confidence"]
        reasoning = cached.get("reasoning", "")
        await _report_progress(
            job_id,
            "classify",
            f"Cache hit → {target_table} (confidence {confidence:.0%})",
            50,
            {
                "target_table": target_table,
                "confidence": round(confidence, 4),
                "reasoning": reasoning,
                "cache_hit": True,
                "model_used": OLLAMA_MODEL,
            },
        )
    else:
        await _report_progress(
            job_id,
            "classify",
            f"Asking AI ({OLLAMA_MODEL}) to identify the target table...",
            35,
            {
                "stage_detail": "sending_prompt_to_llm",
                "model": OLLAMA_MODEL,
                "columns_analyzed": col_names,
            },
        )
        result = await classify(profile, OLLAMA_URL, OLLAMA_MODEL)
        target_table = result.target_table
        confidence = result.confidence
        reasoning = result.reasoning
        await cache.write_through(
            classifier_key,
            {
                "target_table": target_table,
                "confidence": confidence,
                "reasoning": reasoning,
            },
            GO_API_URL,
        )
        await _report_progress(
            job_id,
            "classify",
            f"AI classified as {target_table} (confidence {confidence:.0%})",
            55,
            {
                "target_table": target_table,
                "confidence": round(confidence, 4),
                "reasoning": reasoning,
                "cache_hit": False,
                "model_used": OLLAMA_MODEL,
            },
        )

    low_confidence = (
        confidence < CONFIDENCE_THRESHOLD or target_table not in KNOWN_TABLES
    )
    if low_confidence:
        await _report_progress(
            job_id,
            "error",
            f"Low confidence classification: {target_table} ({confidence:.0%}). Manual review needed.",
            0,
            {
                "target_table": target_table,
                "confidence": round(confidence, 4),
                "reasoning": reasoning,
                "reason": "low_confidence",
                "threshold": CONFIDENCE_THRESHOLD,
            },
        )
        return ProcessResponse(
            target_table=target_table,
            confidence=confidence,
            reasoning=reasoning,
            column_mappings=[],
            unmapped_columns=[c.name for c in profile.columns],
            row_count=meta["row_count"],
            low_confidence=True,
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
        await _report_progress(
            job_id,
            "map",
            f"Cache hit → {len(mappings)} columns mapped, {len(unmapped)} unmapped",
            85,
            {
                "target_table": target_table,
                "mappings": {k: v for k, v in mappings.items()},
                "unmapped_columns": unmapped,
                "mapping_confidence": round(map_confidence, 4),
                "cache_hit": True,
                "columns_mapped": len(mappings),
                "columns_unmapped": len(unmapped),
            },
        )
    else:
        await _report_progress(
            job_id,
            "map",
            f"Asking AI ({OLLAMA_MODEL}) to map columns to {target_table}...",
            60,
            {
                "stage_detail": "sending_mapping_prompt_to_llm",
                "target_table": target_table,
                "model": OLLAMA_MODEL,
                "file_columns": col_names,
            },
        )
        map_result = await map_columns(profile, target_table, OLLAMA_URL, OLLAMA_MODEL)
        mappings = map_result.mappings
        unmapped = map_result.unmapped_columns
        map_confidence = map_result.confidence
        await cache.write_through(
            mapper_key,
            {
                "target_table": target_table,
                "mappings": mappings,
                "unmapped_columns": unmapped,
                "confidence": map_confidence,
            },
            GO_API_URL,
        )
        await _report_progress(
            job_id,
            "map",
            f"Mapped {len(mappings)} columns, {len(unmapped)} unmapped (confidence {map_confidence:.0%})",
            85,
            {
                "target_table": target_table,
                "mappings": mappings,
                "unmapped_columns": unmapped,
                "mapping_confidence": round(map_confidence, 4),
                "cache_hit": False,
                "columns_mapped": len(mappings),
                "columns_unmapped": len(unmapped),
                "model_used": OLLAMA_MODEL,
            },
        )

    column_mappings = [
        MLColumnMapping(
            file_column=src,
            db_column=dst,
            confidence="high"
            if map_confidence >= 0.8
            else "medium"
            if map_confidence >= 0.5
            else "low",
        )
        for src, dst in mappings.items()
    ]

    # ── Done ────────────────────────────────────────────────────────────────
    mapped_count = len(column_mappings)
    high_count = sum(1 for m in column_mappings if m.confidence == "high")
    low_count = sum(1 for m in column_mappings if m.confidence == "low")
    medium_count = mapped_count - high_count - low_count

    mapping_details = [
        {
            "file_column": m.file_column,
            "db_column": m.db_column,
            "confidence": m.confidence,
        }
        for m in column_mappings
    ]

    await _report_progress(
        job_id,
        "done",
        f"Mapping complete: {mapped_count} columns ({high_count} high, {medium_count} medium, {low_count} low confidence)",
        100,
        {
            "target_table": target_table,
            "confidence": round(confidence, 4),
            "reasoning": reasoning,
            "row_count": row_count,
            "columns_mapped": mapped_count,
            "columns_high_confidence": high_count,
            "columns_medium_confidence": medium_count,
            "columns_low_confidence": low_count,
            "columns_unmapped": len(unmapped),
            "unmapped_columns": unmapped,
            "mapping_details": mapping_details,
            "cache_hit": classify_cache_hit or map_cache_hit,
            "model_used": OLLAMA_MODEL,
        },
    )

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
