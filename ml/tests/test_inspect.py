import pandas as pd
from pipeline.inspect import inspect
from pipeline.schema import FileProfile


def test_inspect_basic_profile():
    df = pd.DataFrame({"age": [30, 25, None], "name": ["Alice", "Bob", "Carol"]})
    meta = {"filename": "test.csv", "format": "csv", "row_count": 3, "column_names": ["age", "name"]}
    profile = inspect(df, meta)
    assert isinstance(profile, FileProfile)
    assert profile.row_count == 3
    assert len(profile.columns) == 2
    age_col = next(c for c in profile.columns if c.name == "age")
    assert round(age_col.null_pct, 2) == round(1/3, 2)
    assert len(age_col.sample_values) <= 5


def test_inspect_truncates_sample_values():
    df = pd.DataFrame({"x": range(100)})
    meta = {"filename": "big.csv", "format": "csv", "row_count": 100, "column_names": ["x"]}
    profile = inspect(df, meta)
    assert len(profile.columns[0].sample_values) == 5


def test_inspect_large_dataframe_stays_under_600_tokens():
    import string
    cols = {f"col_{c}": range(10000) for c in string.ascii_lowercase[:50]}
    df = pd.DataFrame(cols)
    meta = {"filename": "wide.csv", "format": "csv", "row_count": 10000,
            "column_names": list(df.columns)}
    profile = inspect(df, meta)
    # Rough token estimate: 4 chars ≈ 1 token
    profile_json = profile.model_dump_json()
    estimated_tokens = len(profile_json) / 4
    assert estimated_tokens < 600, f"Profile too large: ~{estimated_tokens:.0f} tokens"
