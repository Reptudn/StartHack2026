"""Stage 2: Build a compact FileProfile from a DataFrame. Never sends raw data to LLM."""
import logging
import pandas as pd
from .schema import FileProfile, ColumnProfile

logger = logging.getLogger(__name__)

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
