import io
import pytest
import pandas as pd
from pipeline.extract import extract


def _csv_bytes(content: str) -> tuple[bytes, str]:
    return content.encode(), "test.csv"


def test_extract_csv_basic():
    data = "name,age\nAlice,30\nBob,25"
    df, meta = extract(*_csv_bytes(data))
    assert list(df.columns) == ["name", "age"]
    assert len(df) == 2
    assert meta["format"] == "csv"
    assert meta["row_count"] == 2


def test_extract_csv_semicolon_delimiter():
    data = "name;age\nAlice;30\nBob;25"
    df, meta = extract(data.encode(), "test.csv")
    assert list(df.columns) == ["name", "age"]
    assert len(df) == 2


def test_extract_tsv():
    data = "name\tage\nAlice\t30"
    df, meta = extract(data.encode(), "test.tsv")
    assert list(df.columns) == ["name", "age"]
    assert meta["format"] == "tsv"


def test_extract_empty_file_returns_unknown():
    df, meta = extract(b"", "empty.csv")
    assert df is None
    assert meta["format"] == "unknown"


def test_extract_unsupported_format_returns_unknown():
    df, meta = extract(b"some bytes", "file.zip")
    assert df is None
    assert meta["format"] == "unknown"
