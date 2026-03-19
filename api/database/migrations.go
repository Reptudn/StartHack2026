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
		&models.JobState{},
		&models.TBCaseData{},
		&models.TBImportAcData{},
		&models.TBImportLabsData{},
		&models.TBImportIcd10Data{},
		&models.TBImportDeviceMotionData{},
		&models.TBImportDevice1HzMotionData{},
		&models.TBImportMedicationInpatientData{},
		&models.TBImportNursingDailyReportsData{},
	); err != nil {
		return err
	}

	log.Println("[database] Migrations completed")
	return nil
}
