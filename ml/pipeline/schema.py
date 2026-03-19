from pydantic import BaseModel


class ColumnProfile(BaseModel):
    name: str
    dtype: str
    null_pct: float
    sample_values: list[str]


class AnomalyFlag(BaseModel):
    column: str
    severity: str  # "warning" | "info"
    message: str


class FileProfile(BaseModel):
    filename: str
    format: str
    row_count: int
    columns: list[ColumnProfile]
    anomalies: list[AnomalyFlag] = []


class ClassifyResult(BaseModel):
    target_table: str
    confidence: float
    reasoning: str


class MapResult(BaseModel):
    mappings: dict[str, str]       # {file_col: db_col}
    unmapped_columns: list[str]
    confidence: float


class MLColumnMapping(BaseModel):
    file_column: str
    db_column: str
    confidence: str                # "high" | "medium" | "low"


class ProcessResponse(BaseModel):
    target_table: str
    confidence: float
    reasoning: str
    column_mappings: list[MLColumnMapping]
    unmapped_columns: list[str]
    row_count: int
    low_confidence: bool
    cache_hit: bool
    profile: FileProfile | None = None
    anomalies: list[AnomalyFlag] = []
