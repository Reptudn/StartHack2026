package database

import (
	"database/sql"
	"fmt"
	"log"

	"epaccdataunifier/config"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func Connect(cfg *config.Config) error {
	var err error
	DB, err = sql.Open("postgres", cfg.DSN())
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	if err = DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Connection pool settings
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)

	log.Println("[database] Connected to PostgreSQL")
	return nil
}

func Close() {
	if DB != nil {
		DB.Close()
		log.Println("[database] Connection closed")
	}
}
