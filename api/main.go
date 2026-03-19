package main

import (
	"log"

	"epaccdataunifier/config"
	"epaccdataunifier/database"
	"epaccdataunifier/handlers"
	"epaccdataunifier/middleware"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

const version = "2.0.0"

func main() {
	cfg := config.Load()

	if err := database.Connect(cfg); err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer database.Close()

	if err := database.RunMigrations(); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}

	if cfg.IsProd() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	r.Use(middleware.CORS(cfg.CORSOrigins))
	r.MaxMultipartMemory = cfg.MaxUploadMB << 20

	healthCheck := func(c *gin.Context) {
		c.JSON(200, models.HealthResponse{
			Status:  "ok",
			Env:     cfg.AppEnv,
			Version: version,
		})
	}

	r.GET("/", healthCheck)
	r.GET("/api", healthCheck)
	r.GET("/api/health", healthCheck)

	uploadHandler := handlers.NewUploadHandler(cfg)

	api := r.Group("/api")
	{
		api.POST("/upload", uploadHandler.Upload)
		api.GET("/schema", handlers.GetSchema)
		api.GET("/files", handlers.ListFiles)
		api.GET("/files/:id", handlers.GetFile)
		api.GET("/files/:id/progress", handlers.GetFileProgress)
		api.GET("/files/:id/validation", handlers.GetFileValidation)
		api.POST("/validation/:id/resolve", handlers.ResolveValidationError)
		api.POST("/files/:id/import", handlers.Import)
		api.DELETE("/files/:id", handlers.DeleteFile)
	}

	addr := ":" + cfg.Port
	log.Printf("[server] Starting HealthMap API %s on %s (%s)", version, addr, cfg.AppEnv)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
