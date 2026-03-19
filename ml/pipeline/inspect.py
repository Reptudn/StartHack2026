"""Stage 2: Build a compact FileProfile from a DataFrame. Never sends raw data to LLM."""
import logging
import pandas as pd
from .schema import FileProfile, ColumnProfile, AnomalyFlag

logger = logging.getLogger(__name__)

# Max sample values per column — keeps profile under ~600 tokens for any file
_MAX_SAMPLE = 5
# Max columns to profile — labs has 62, epaAC has 300+
_MAX_COLS = 150

# Thresholds for anomaly detection
_HIGH_NULL_PCT = 0.5  # >50% nulls
_SUSPECT_NULL_PCT = 0.3  # >30% nulls


def inspect(df: pd.DataFrame, meta: dict) -> FileProfile:
    """Convert a DataFrame into a compact FileProfile for LLM consumption."""
    cols_to_profile = list(df.columns)[:_MAX_COLS]
    column_profiles = []
    anomalies = []

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

        # Anomaly: high null percentage
        if null_pct > _HIGH_NULL_PCT:
            anomalies.append(AnomalyFlag(
                column=col,
                severity="warning",
                message=f"Column has {null_pct:.0%} null values",
            ))
        elif null_pct > _SUSPECT_NULL_PCT:
            anomalies.append(AnomalyFlag(
                column=col,
                severity="info",
                message=f"Column has {null_pct:.0%} null values",
            ))

    # Anomaly: check for duplicate rows by all columns
    dup_count = int(df.duplicated().sum())
    if dup_count > 0:
        anomalies.append(AnomalyFlag(
            column="_all",
            severity="warning",
            message=f"{dup_count} duplicate rows detected ({dup_count/len(df):.0%} of data)",
        ))

    # Anomaly: columns truncated
    total_cols = len(df.columns)
    if total_cols > _MAX_COLS:
        anomalies.append(AnomalyFlag(
            column="_meta",
            severity="info",
            message=f"File has {total_cols} columns, only first {_MAX_COLS} profiled",
        ))

    return FileProfile(
        filename=meta["filename"],
        format=meta["format"],
        row_count=meta["row_count"],
        columns=column_profiles,
        anomalies=anomalies,
    )


def _friendly_dtype(series: pd.Series) -> str:
    kind = series.dtype.kind
    return {"i": "int", "u": "int", "f": "float", "b": "bool",
            "M": "datetime", "O": "string", "U": "string"}.get(kind, "string")
