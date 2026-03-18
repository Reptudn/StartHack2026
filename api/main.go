package main

import (
	"log"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/handlers"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

const version = "1.0.0"

func main() {
	// Load configuration
	cfg := config.Load()

	// Connect to database
	if err := database.Connect(cfg); err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer database.Close()

	// Run migrations
	if err := database.RunMigrations(); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}

	// Set Gin mode
	if cfg.IsProd() {
		gin.SetMode(gin.ReleaseMode)
	}

	// Create router
	r := gin.Default()

	// Middleware
	// r.Use(middleware.CORS(cfg.CORSOrigins))

	// Max upload size
	r.MaxMultipartMemory = cfg.MaxUploadMB << 20

	// Health check
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, models.HealthResponse{
			Status:  "ok",
			Env:     cfg.AppEnv,
			Version: version,
		})
	})

	// Upload handler
	uploadHandler := handlers.NewUploadHandler(cfg)

	// API routes
	api := r.Group("/api")
	{
		api.POST("/upload", uploadHandler.Upload)
		api.GET("/files", handlers.ListFiles)
		api.GET("/files/:id", handlers.GetFile)
		api.DELETE("/files/:id", handlers.DeleteFile)
		api.GET("/files/:id/errors", handlers.GetFileErrors)
		api.PATCH("/files/:id/errors/:errorId", handlers.ResolveError)
		api.GET("/stats", handlers.GetStats)
	}

	// Start server
	addr := ":" + cfg.Port
	log.Printf("[server] Starting HealthMap API %s on %s (%s)", version, addr, cfg.AppEnv)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
