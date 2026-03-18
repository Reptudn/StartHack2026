package database

import "log"

func RunMigrations() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS file_uploads (
			id              SERIAL PRIMARY KEY,
			filename        VARCHAR(500) NOT NULL,
			file_type       VARCHAR(10) NOT NULL,
			file_size_bytes BIGINT NOT NULL,
			uploaded_at     TIMESTAMP DEFAULT NOW(),
			quality_score   NUMERIC DEFAULT 0,
			completeness    NUMERIC DEFAULT 0,
			accuracy        NUMERIC DEFAULT 0,
			consistency     NUMERIC DEFAULT 0,
			timeliness      NUMERIC DEFAULT 0,
			status          VARCHAR(20) DEFAULT 'processing',
			row_count       INTEGER DEFAULT 0,
			error_count     INTEGER DEFAULT 0,
			columns_mapped  TEXT[] DEFAULT '{}'
		)`,
		`CREATE TABLE IF NOT EXISTS validation_errors (
			id              SERIAL PRIMARY KEY,
			file_id         INTEGER REFERENCES file_uploads(id) ON DELETE CASCADE,
			row_number      INTEGER NOT NULL,
			column_name     VARCHAR(100) NOT NULL,
			error_type      VARCHAR(50) NOT NULL,
			severity        VARCHAR(10) DEFAULT 'error',
			original_value  TEXT DEFAULT '',
			suggested_value TEXT DEFAULT '',
			resolved        VARCHAR(10) DEFAULT 'pending',
			resolved_at     TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_validation_errors_file_id ON validation_errors(file_id)`,
		`CREATE INDEX IF NOT EXISTS idx_validation_errors_resolved ON validation_errors(resolved)`,
		`CREATE INDEX IF NOT EXISTS idx_file_uploads_status ON file_uploads(status)`,
	}

	for _, m := range migrations {
		if _, err := DB.Exec(m); err != nil {
			return err
		}
	}

	log.Println("[database] Migrations completed")
	return nil
}
