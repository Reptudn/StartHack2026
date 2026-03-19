# TODO — HealthMap

## What the Challenge Requires (from Challenge.md)

The dashboard should display:
1. Data origin and structure
2. Data quality and completeness
3. Detected anomalies or inconsistencies
4. Alerts for quality or mapping issues
5. Manual correction interface for mapping errors

Judging: Viability 25%, Feasibility 20%, Complexity 20%, Creativity 15%, Design 10%, Presentation 10%.

---

## Critical Fixes (broken functionality)

- [ ] **Column validation against DB schema** — LLM maps to phantom columns (e.g. `coAgeYears` on labs table) causing 0 rows imported despite "PASS". Validate mapped columns against `TABLE_COLUMNS` before insert, reject unknown columns. *(affects labs + ICD10)*
- [x] **Row-level error recovery in import.go** — Backported row-by-row fallback from `test.go` into `import.go`.
- [x] **XLSX import support** — Added `excelize` XLSX parser to Go. PDF returns clear error (convert to CSV/XLSX first).

## Features to Build (meeting challenge requirements)

- [ ] **Data quality & completeness dashboard** — Challenge explicitly asks for this. UI components exist (`DataQualityTable.tsx`, `StatsCards.tsx`) but have no backend data. Wire `inspect.py` profile data (null%, dtype, samples) into API response and connect to frontend.
- [ ] **Anomaly/inconsistency detection** — Challenge asks for detected anomalies. Ideas: flag columns with >50% nulls, detect type mismatches (string in numeric column), flag duplicate case_ids, detect outlier values in lab ranges.
- [ ] **Alerts for quality or mapping issues** — Show warnings when: confidence < 0.8, columns unmapped, mapped columns don't exist on target, data types don't match expected schema.
- [ ] **Data origin tracking (provenance)** — Record which source file + row number produced each imported record. `ValidationLog` model already exists, just needs to be populated during import.
- [ ] **Cross-file case_id linking** — The "case-centric" goal means linking labs + meds + nursing + devices by case_id. Need a view or query that shows all data for a given case across tables.
- [ ] **Transform stage** — Type coercion, null replacement, date normalization beyond just case_id prefix stripping. Real-world data needs cleaning before insert.
- [ ] **Conflict/duplicate detection** — Currently append-only with no dedup. Importing same file twice creates duplicates. At minimum detect and warn.

## Nice-to-Have (boost judging scores)

- [ ] **Error-containing test data** — `Endtestdaten_mit_Fehlern_einheitliche ID/` folder has 7 files with intentional errors. Add to test pipeline to demonstrate error handling.
- [ ] **Multi-clinic demo** — `split_data_pat_case_altered/` has data from 4 fake clinics with different column naming. Great for demoing heterogeneous source handling.
- [ ] **patient_id <-> case_id linking across files** — Different files use different ID formats. Build a reconciliation layer.
- [ ] **Presentation** — 10% of judging. Need PowerPoint with architecture diagram, business case, demo screenshots.

## Already Done

- [x] File upload (CSV/XLSX/PDF) via drag-and-drop UI
- [x] 4-stage ML pipeline (Extract -> Inspect -> Classify -> Map)
- [x] LLM-powered table classification and column mapping
- [x] SHA256-based caching with write-through to Postgres
- [x] Bulk import into Postgres with chunked inserts
- [x] Case ID normalization (strips CASE- prefix and leading zeros)
- [x] Interactive mapping editor in UI (manual correction)
- [x] E2E test pipeline with 7 fixtures
- [x] On-premises capable (all services in Docker, local Ollama LLM)
- [x] Privacy-preserving (only column metadata sent to LLM, never raw patient data)
- [x] Force JSON output format on Ollama calls
- [x] Increased mapper token limit (4096)
