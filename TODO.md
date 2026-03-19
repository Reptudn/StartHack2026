# TODO — HealthMap

## Challenge Requirements (from Challenge.md)

Dashboard must display:
1. Data origin and structure
2. Data quality and completeness
3. Detected anomalies or inconsistencies
4. Alerts for quality or mapping issues
5. Manual correction interface for mapping errors

Additional: on-premises capable, SQL database integration, AI-driven mapping, handles CSV/XLSX/PDF/free-text.

Judging: Viability 25%, Feasibility 20%, Complexity 20%, Creativity 15%, Design 10%, Presentation 10%.

Expected output: PowerPoint, code repo, clickable prototype, architecture diagram.

---

## Phase 1 — Pipeline Bug Fixes (do now)

- [ ] **Many-to-one mapping dedup** — LLM maps multiple source columns to same target (e.g. 8 medication cols → `administration_datetime`). After LLM response in `agents.py`, reverse-index mappings, keep first match per target, move rest to unmapped.
- [ ] **Raise 40-column inspect cap** — `inspect.py` truncates at 40 columns. Labs has 62, epaAC has 300+. Raise `_MAX_COLS` to 100+ for mapper stage so columns aren't silently dropped.
- [ ] **Add missing NULL strings** — README specifies `Missing` and `unknow` (intentional typo) as NULL values. Add to `isNullString()` in `import.go` and `test.go`.
- [ ] **Enforce required fields** — README says rows missing `case_id` or `patient_id` must be deleted. Add check during import.

## Phase 2 — Mapping Quality (German/abbreviated headers)

- [ ] **Improve mapper prompt with examples** — Add few-shot examples showing German→English mappings: `Na → coSodium_mmol_L`, `Aufnahmedatum → coAdmission_date`, `station → coWard`, `medikament → coMedication_name`. This is the primary lever for Fehler data.
- [ ] **Add column descriptions to mapper prompt** — Include short descriptions for ambiguous DB columns (e.g. `coSodium_mmol_L: "sodium lab value in mmol/L"`) so LLM can distinguish value vs ref columns.
- [ ] **Fix nursing free-text miss** — `nursing_note_free_text` not mapped. Likely needs explicit prompt example: `NursingNote → coNursing_note_free_text`.
- [ ] **Fix labs value→ref mismapping** — `sodium_mmol_L` maps to `cosodium_ref_high` instead of `coSodium_mmol_L`. Prompt examples should clarify value vs flag vs ref columns.

## Phase 3 — Easy Wins (high impact, low effort)

- [ ] **Wire profile data to API response** — `inspect.py` already computes null%, dtype, samples per column. Add `profile` field to `ProcessResponse` in `schema.py`. ~50 lines. Frontend components (`DataQualityTable.tsx`, `StatsCards.tsx`) exist but have no data.
- [ ] **Basic anomaly flags** — Flag columns with >50% nulls in inspect stage. Already have `null_pct`. ~20 lines Python.
- [ ] **Duplicate file detection** — Add SHA256 content hash to `FileUpload` model, check before import. ~30 lines Go.

## Phase 4 — Skip for MVP (teammates or post-hackathon)

- [ ] **epaAC pivot transform** — 5 different epaAC formats (Data-1 through Data-5), each structured differently. Needs pre-transform step. Too complex for MVP.
- [ ] **Cross-file case_id linking** — Case-centric view linking labs + meds + nursing + devices by case_id.
- [ ] **Full provenance tracking** — Row-level source file + row number per imported record. `ValidationLog` model exists but not populated.
- [ ] **Presentation** — PowerPoint with architecture diagram, business case, demo screenshots. 10% of judging.

## Pipeline Cleanup

- [ ] **Deduplicate import logic** — `test.go:attemptImport()` is copy-paste of `import.go`. Extract shared function to avoid bug divergence.
- [ ] **Classifier shows 20 cols, mapper shows all** — Inconsistent truncation in `agents.py`. Align both to use same column set from profile.

## Resources Available

- **`epaCC-START-Hack-2026/DB/Hack2026.bak`** — SQL Server backup with filled target database. Could extract ground-truth data for few-shot prompt examples.
- **`epaCC-START-Hack-2026/IID-SID-ITEM.csv`** — 7,881 rows mapping epaCC assessment codes (E0I/E2I) to descriptions. Critical if tackling epaAC.
- **`epaCC-START-Hack-2026/Hack2026_README.md`** — German dataset documentation with exact column lists, NULL handling rules, case_id format specs.
- **`epaCC-START-Hack-2026/DB/CreateImportTables.sql`** — Canonical MS SQL Server schema for all 8 target tables.

## Already Done

- [x] File upload (CSV/XLSX/PDF) via drag-and-drop UI
- [x] 4-stage ML pipeline (Extract → Inspect → Classify → Map)
- [x] LLM-powered table classification and column mapping (7/7 classify correctly)
- [x] SHA256-based caching with write-through to Postgres
- [x] Bulk import into Postgres with chunked inserts
- [x] Case ID normalization (strips CASE- prefix, leading zeros, trailing sub-IDs)
- [x] NULL string handling (NULL, N/A, NA, none, #N/A, NaN)
- [x] Interactive mapping editor in UI (manual correction)
- [x] E2E test pipeline with 7 fixtures
- [x] On-premises capable (all services in Docker, local Ollama LLM)
- [x] Privacy-preserving (only column metadata sent to LLM, never raw patient data)
- [x] Force JSON output format on Ollama calls
- [x] Increased mapper token limit (4096)
- [x] Column validation against DB schema (VALID_COLUMNS in agents.py)
- [x] Row-level error recovery in import.go
- [x] XLSX import support via excelize
