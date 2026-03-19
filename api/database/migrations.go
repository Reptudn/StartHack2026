package database

import (
	"log"

	"epaccdataunifier/models"
)

func RunMigrations() error {
	// Drop problematic text[] column so AutoMigrate can recreate it cleanly as JSONB
	DB.Exec(`ALTER TABLE file_uploads DROP COLUMN IF EXISTS columns_mapped`)

	// AutoMigrate handles both creating new tables AND adding missing columns
	if err := DB.AutoMigrate(&models.FileUpload{}); err != nil {
		return err
	}

	log.Println("[database] Migrations completed (AutoMigrate)")
	return nil
}
