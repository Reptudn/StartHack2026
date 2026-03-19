package database

import (
	"log"

	"epaccdataunifier/models"
)

func RunMigrations() error {
	// Drop columns_mapped before AutoMigrate so it's not re-added
	DB.Exec(`ALTER TABLE file_uploads DROP COLUMN IF EXISTS columns_mapped`)

	if err := DB.AutoMigrate(
		&models.FileUpload{},
		&models.MappingCache{},
		&models.ValidationLog{},
	); err != nil {
		return err
	}

	// TODO: Add models.Job when async job queue (Redis) is implemented
	// TODO: Add models.FlaggedRecord when manual review/correction UI is built

	log.Println("[database] Migrations completed")
	return nil
}
