# Data Validation & Storage Pipeline

Plan für die Überprüfung, Bewertung und Speicherung von geparsten Healthcare-Dateien.

## Architektur-Übersicht

```
📤 File Upload → 🔄 Parser & Mapper → ✅ Validation Layer → 📊 Quality Scoring → 🗄️ Database
                                                                                  ↘ 🖥️ Dashboard → Manual Fix → DB
```

---

## 1. Validation Layer – Drei Stufen der Prüfung

### Stufe 1: Strukturelle Validierung
> Prüft ob die Daten das korrekte Format haben

| Regel | Beschreibung | Betroffene Dateien |
|-------|-------------|-------------------|
| **Pflichtfelder** | `case_id` und `patient_id` müssen vorhanden sein → sonst Zeile entfernen | Alle |
| **NULL-Erkennung** | `NULL`, `Missing`, `unknow`, `NaN`, `N/A`, Leerzeichen → als NULL markieren | Alle |
| **case_id Normalisierung** | `CASE-0135`, `0135`, `135` → alle zu Integer `135` | Alle |
| **Datentyp-Prüfung** | Numerische Felder (Labwerte, Scores) als Zahlen, Datumsfelder als ISO 8601 | Labs, Medication, Devices |
| **Duplikat-Handling** | Bei epaAC-Data-1: letzter Datensatz pro IID gewinnt | epaAC-Data |
| **Record-Type Check** | `ORDER`, `CHANGE`, `ADMIN` müssen gültig sein | Medication |

### Stufe 2: Semantische Validierung
> Prüft ob die Werte medizinisch/logisch sinnvoll sind

| Regel | Beispiel | Aktion |
|-------|---------|--------|
| **Wertebereich** | Natrium: 120–160 mmol/L, Kalium: 2.5–6.5 mmol/L | Flag als Anomalie wenn außerhalb |
| **Referenzwert-Konsistenz** | `*_flag` muss mit `*_ref_low`/`*_ref_high` übereinstimmen | Auto-Korrektur vorschlagen |
| **Binärfelder** | `fall_event_0_1`, `bed_exit_detected_0_1` nur 0 oder 1 | Error wenn anderer Wert |
| **Zeitliche Konsistenz** | `admission_datetime` < `discharge_datetime` | Flag als Anomalie |
| **Medication-Logik** | `administered_dose` bei Status `given` muss > 0 sein | Warning |
| **ICD-10 Format** | Code muss dem Pattern `[A-Z][0-9]{2}(\.[0-9]{1,2})?` folgen | Flag als Anomalie |

### Stufe 3: Cross-File Validierung
> Prüft Konsistenz zwischen verschiedenen Dateien

| Regel | Beschreibung |
|-------|-------------|
| **Referentielle Integrität** | Jede `patient_id` in Labs/Medication/Devices muss auch in Cases existieren |
| **Zeitliche Überlappung** | Sensor-Timestamps müssen innerhalb des Aufenthaltszeitraums liegen |
| **Pflegebericht ↔ Events** | Sturz in Sensor-Daten sollte sich im Pflegebericht widerspiegeln |

---

## 2. Quality Score – Bewertungskriterien

Jede Datei bekommt einen **Quality Score (0–100)** basierend auf gewichteten Kriterien:

```
Quality Score = (Completeness × 0.35) + (Accuracy × 0.30)
             + (Consistency × 0.20) + (Timeliness × 0.15)
```

| Metrik | Gewicht | Berechnung |
|--------|---------|-----------|
| **Completeness** | 35% | `(nicht-NULL Felder) / (erwartete Felder)` × 100 |
| **Accuracy** | 30% | `(Werte im gültigen Bereich) / (alle Werte)` × 100 |
| **Consistency** | 20% | `(konsistente Cross-Referenzen) / (alle Referenzen)` × 100 |
| **Timeliness** | 15% | `(gültige Timestamps) / (alle Timestamps)` × 100 |

**Schwellenwerte:**
- 🟢 **≥ 80** → Gut, direkt nutzbar
- 🟡 **50–79** → Akzeptabel, manuelle Prüfung empfohlen
- 🔴 **< 50** → Schlecht, Korrekturen nötig vor Speicherung

---

## 3. Datenbank-Schema (PostgreSQL)

### Kern-Tabellen

```sql
-- Harmonisierte Patientendaten
CREATE TABLE patients (
    patient_id  INTEGER PRIMARY KEY,
    sex         VARCHAR(10),
    age_years   INTEGER
);

-- Fälle / Aufenthalte
CREATE TABLE cases (
    case_id             INTEGER PRIMARY KEY,
    patient_id          INTEGER REFERENCES patients(patient_id),
    ward                VARCHAR(50),
    admission_datetime  TIMESTAMP,
    discharge_datetime  TIMESTAMP,
    length_of_stay_days INTEGER,
    primary_icd10       VARCHAR(10),
    primary_icd10_desc  TEXT,
    secondary_icd10     TEXT[],
    ops_codes           TEXT[]
);

-- Laborwerte (harmonisiert)
CREATE TABLE lab_results (
    id              SERIAL PRIMARY KEY,
    case_id         INTEGER REFERENCES cases(case_id),
    patient_id      INTEGER REFERENCES patients(patient_id),
    specimen_dt     TIMESTAMP,
    parameter_name  VARCHAR(50),
    value           NUMERIC,
    unit            VARCHAR(20),
    flag            VARCHAR(10),
    ref_low         NUMERIC,
    ref_high        NUMERIC
);

-- Sensor/Gerätedaten (aggregiert)
CREATE TABLE device_readings (
    id                  SERIAL PRIMARY KEY,
    patient_id          INTEGER REFERENCES patients(patient_id),
    device_id           VARCHAR(50),
    timestamp           TIMESTAMP,
    movement_score      NUMERIC,
    bed_occupied        BOOLEAN,
    fall_event          BOOLEAN,
    impact_magnitude_g  NUMERIC,
    data_source         VARCHAR(50)
);

-- Medikation
CREATE TABLE medications (
    id                  SERIAL PRIMARY KEY,
    patient_id          INTEGER REFERENCES patients(patient_id),
    encounter_id        VARCHAR(50),
    record_type         VARCHAR(10),
    order_id            VARCHAR(50),
    medication_atc      VARCHAR(10),
    medication_name     VARCHAR(200),
    dose                NUMERIC,
    dose_unit           VARCHAR(20),
    route               VARCHAR(50),
    admin_datetime      TIMESTAMP,
    admin_status        VARCHAR(20),
    note                TEXT
);

-- Pflegeberichte (Freitext + NLP-Extraktion)
CREATE TABLE nursing_reports (
    id                  SERIAL PRIMARY KEY,
    case_id             INTEGER REFERENCES cases(case_id),
    patient_id          INTEGER REFERENCES patients(patient_id),
    ward                VARCHAR(50),
    report_date         DATE,
    shift               VARCHAR(20),
    free_text           TEXT,
    extracted_entities   JSONB
);

-- epaAC Assessments (harmonisiert)
CREATE TABLE epa_assessments (
    id                  SERIAL PRIMARY KEY,
    iid                 VARCHAR(20),
    case_id             INTEGER,
    assessment_type     VARCHAR(100),
    assessment_date     DATE,
    scores              JSONB
);
```

### Meta-Tabellen (Tracking)

```sql
-- Datei-Upload-Tracking
CREATE TABLE file_uploads (
    id              SERIAL PRIMARY KEY,
    filename        VARCHAR(500),
    file_type       VARCHAR(10),
    file_size_bytes BIGINT,
    uploaded_at     TIMESTAMP DEFAULT NOW(),
    quality_score   NUMERIC,
    completeness    NUMERIC,
    accuracy        NUMERIC,
    consistency     NUMERIC,
    timeliness      NUMERIC,
    status          VARCHAR(20),
    row_count       INTEGER,
    error_count     INTEGER
);

-- Einzelne Validierungsfehler
CREATE TABLE validation_errors (
    id              SERIAL PRIMARY KEY,
    file_id         INTEGER REFERENCES file_uploads(id),
    row_number      INTEGER,
    column_name     VARCHAR(100),
    error_type      VARCHAR(50),
    severity        VARCHAR(10),
    original_value  TEXT,
    suggested_value TEXT,
    resolved        VARCHAR(10) DEFAULT 'pending',
    resolved_at     TIMESTAMP,
    resolved_by     VARCHAR(100)
);
```

---

## 4. Pipeline-Flow (Zusammenfassung)

```
Upload CSV/XLSX/PDF/TXT
        ↓
Format-Erkennung & Parsing
        ↓
Schema-Mapping → Unified Model
        ↓
Stufe 1: Strukturelle Validierung
        ↓
Stufe 2: Semantische Validierung
        ↓
Stufe 3: Cross-File Validierung
        ↓
Quality Score berechnen
        ↓
   Score ≥ 80? ──→ Ja ──→ ✅ In DB speichern
        ↓
       Nein
        ↓
   ⚠️ Im Dashboard anzeigen → Manuelle Korrektur → In DB speichern
```

## 5. Technologie-Zuordnung

| Komponente | Wo | Technologie |
|------------|-----|-----------|
| Parsing & Mapping | `ml/` | Python (pandas, openpyxl, pdfplumber) |
| NLP für Pflegetexte | `ml/` | Python (spaCy / LLM API) |
| Validierungs-Regeln | `api/` | Go (regelbasiert, performant) |
| Quality Score | `api/` | Go |
| Datenbank | extern | PostgreSQL (Docker) |
| Dashboard | `web/` | React (bereits gebaut) |
