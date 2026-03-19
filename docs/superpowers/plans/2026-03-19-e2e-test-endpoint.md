# E2E Test Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/test` endpoint that runs test fixture files through the full pipeline (upload → ML classify/map → import) and returns structured results.

**Architecture:** New handler in Go API reads files from `api/testdata/`, sends each to ML service via the same path as regular uploads, verifies mapping, attempts import if valid, returns per-file results with timing.

**Tech Stack:** Go (Gin), existing upload/import logic, JSON manifest for test fixtures.

---

### Task 1: Create testdata directory and manifest

**Files:**
- Create: `api/testdata/manifest.json`

- [ ] **Step 1: Create empty manifest**

```json
{
  "fixtures": []
}
```

The `fixtures` array will be populated when real data files are added. Each entry:
```json
{
  "file": "filename.csv",
  "expected_table": "tbImportLabsData"
}
```

- [ ] **Step 2: Commit**

```bash
git add api/testdata/manifest.json
git commit -m "feat: add empty test fixture manifest for E2E testing"
```

---

### Task 2: Create test handler

**Files:**
- Create: `api/handlers/test.go`

- [ ] **Step 1: Write the test handler**

The handler:
1. Reads `api/testdata/manifest.json`
2. For each fixture entry, opens the file from `api/testdata/`
3. Sends it to ML service `/api/process` (same multipart POST as upload handler)
4. Checks: did ML return a valid response? Does target_table match expected?
5. If status is "mapped", calls the import logic (inserts rows into DB)
6. Collects per-file results with timing

Returns:
```json
{
  "results": [
    {
      "file": "labs_sample.csv",
      "status": "pass",
      "expected_table": "tbImportLabsData",
      "got_table": "tbImportLabsData",
      "confidence": 0.92,
      "columns_mapped": 15,
      "rows_imported": 1000,
      "duration_ms": 3200,
      "error": ""
    }
  ],
  "passed": 1,
  "failed": 0,
  "total": 1
}
```

- [ ] **Step 2: Register route in main.go**

Add `api.POST("/test", testHandler.RunTests)` to the route group.

- [ ] **Step 3: Commit**

---

### Task 3: Test with empty manifest (smoke test)

- [ ] **Step 1: Build and verify**

```bash
cd api && go build -o main .
```

- [ ] **Step 2: Curl the endpoint with docker-compose running**

```bash
curl -X POST http://localhost:8080/api/test
```

Expected: `{"results":[],"passed":0,"failed":0,"total":0}`

- [ ] **Step 3: Commit if any fixes needed**
