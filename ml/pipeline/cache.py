"""
In-memory cache for classifier and mapper results.
Keyed by SHA256 of sorted column names (classifier) or sorted cols + target_table (mapper).
Write-through to Go's POST /api/cache for persistence.
"""
import hashlib
import json
import logging
import httpx

logger = logging.getLogger(__name__)

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
    put(key, entry)
    payload = {
        "column_hash": key,
        "target_table": entry.get("target_table", ""),
        "column_mapping": json.dumps(entry.get("mappings", {})),
        "confidence": entry.get("confidence", 0.0),
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"{go_api_url}/api/cache", json=payload)
    except Exception as exc:
        logger.debug("cache write-through failed (non-fatal): %s", exc)
