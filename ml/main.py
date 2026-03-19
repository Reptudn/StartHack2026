"""
ML Service — 4-stage pipeline: Extract → Inspect → Classify → Map
"""
import os
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
