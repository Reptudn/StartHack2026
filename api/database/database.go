package database

import (
	"fmt"
	"log"
	"time"

	"epaccdataunifier/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect(cfg *config.Config) error {
	var err error
	dsn := cfg.DSN()
	
	// Retry connection for a few seconds to handle slow DB startup
	maxRetries := 5
	for i := 0; i < maxRetries; i++ {
		DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err == nil {
			break
		}
		log.Printf("[database] Attempt %d/%d failed, retrying in 2s...", i+1, maxRetries)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		return fmt.Errorf("failed to connect to database after retries: %w", err)
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get sql.DB: %w", err)
	}

	// Connection pool settings
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)

	log.Println("[database] Connected to PostgreSQL via GORM")
	return nil
}

func Close() {
	if DB != nil {
		sqlDB, err := DB.DB()
		if err == nil {
			sqlDB.Close()
			log.Println("[database] Connection closed")
		}
	}
}
