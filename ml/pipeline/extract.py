"""Stage 1: Extract raw file bytes into a pandas DataFrame + metadata dict."""
import io
import logging
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
            # openpyxl handles .xlsx only; .xls (legacy BIFF8) will fail gracefully
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

    except Exception as exc:
        logging.getLogger(__name__).warning("extract failed for %s: %s", filename, exc)
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
