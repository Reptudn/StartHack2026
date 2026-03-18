package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv      string
	Port        string
	DBHost      string
	DBPort      string
	DBUser      string
	DBPassword  string
	DBName      string
	DBSSLMode   string
	CORSOrigins []string
	UploadDir   string
	MaxUploadMB int64
}

func Load() *Config {
	// Try loading .env file (ignore error if not found, use env vars directly)
	_ = godotenv.Load()

	cfg := &Config{
		AppEnv:      getEnv("APP_ENV", "development"),
		Port:        getEnv("PORT", "8080"),
		DBHost:      getEnv("DB_HOST", "localhost"),
		DBPort:      getEnv("DB_PORT", "5432"),
		DBUser:      getEnv("DB_USER", "healthmap"),
		DBPassword:  getEnv("DB_PASSWORD", "healthmap_dev"),
		DBName:      getEnv("DB_NAME", "healthmap"),
		DBSSLMode:   getEnv("DB_SSLMODE", "disable"),
		CORSOrigins: strings.Split(getEnv("CORS_ORIGINS", "http://localhost:5173"), ","),
		UploadDir:   getEnv("UPLOAD_DIR", "./uploads"),
		MaxUploadMB: getEnvInt("MAX_UPLOAD_MB", 50),
	}

	// Ensure upload directory exists
	if err := os.MkdirAll(cfg.UploadDir, 0755); err != nil {
		log.Fatalf("Failed to create upload directory: %v", err)
	}

	log.Printf("[config] env=%s port=%s db=%s@%s:%s/%s cors=%v",
		cfg.AppEnv, cfg.Port, cfg.DBUser, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.CORSOrigins)

	return cfg
}

func (c *Config) DSN() string {
	return "host=" + c.DBHost +
		" port=" + c.DBPort +
		" user=" + c.DBUser +
		" password=" + c.DBPassword +
		" dbname=" + c.DBName +
		" sslmode=" + c.DBSSLMode
}

func (c *Config) IsProd() bool {
	return c.AppEnv == "production"
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		i, err := strconv.ParseInt(v, 10, 64)
		if err == nil {
			return i
		}
	}
	return fallback
}
