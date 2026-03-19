import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from pipeline.schema import FileProfile, ColumnProfile
from pipeline.agents import classify, map_columns


def _make_profile(cols: list[str]) -> FileProfile:
    return FileProfile(
        filename="test.csv", format="csv", row_count=100,
        columns=[ColumnProfile(name=c, dtype="string", null_pct=0.0,
                               sample_values=["a", "b"]) for c in cols]
    )


OLLAMA_URL = "http://ollama:11434"


@pytest.mark.asyncio
async def test_classify_returns_target_table():
    profile = _make_profile(["coSodium_mmol_L", "coCreatinine_mg_dL", "coCaseId"])
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "response": '{"target_table": "tbImportLabsData", "confidence": 0.95, "reasoning": "lab columns"}'
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await classify(profile, OLLAMA_URL, "qwen2.5:3b")

    assert result.target_table == "tbImportLabsData"
    assert result.confidence == 0.95


@pytest.mark.asyncio
async def test_classify_ollama_error_returns_unknown():
    profile = _make_profile(["col_a"])
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_client_cls.return_value = mock_client

        result = await classify(profile, OLLAMA_URL, "qwen2.5:3b")

    assert result.target_table == "UNKNOWN"
    assert result.confidence == 0.0


@pytest.mark.asyncio
async def test_map_returns_column_mappings():
    profile = _make_profile(["Natrium", "Kreatinin"])
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "response": '{"mappings": {"Natrium": "coSodium_mmol_L", "Kreatinin": "coCreatinine_mg_dL"}, "unmapped_columns": [], "confidence": 0.9}'
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await map_columns(profile, "tbImportLabsData", OLLAMA_URL, "qwen2.5:3b")

    assert result.mappings["Natrium"] == "coSodium_mmol_L"
    assert result.unmapped_columns == []


@pytest.mark.asyncio
async def test_map_bad_json_returns_empty_mappings():
    profile = _make_profile(["col_x"])
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"response": "sorry, I cannot help with that"}
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await map_columns(profile, "tbImportLabsData", OLLAMA_URL, "qwen2.5:3b")

    assert result.mappings == {}
    assert result.confidence == 0.0
