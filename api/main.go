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
	testHandler := handlers.NewTestHandler(cfg)

	api := r.Group("/api")
	{
		api.POST("/upload", uploadHandler.Upload)
		api.POST("/test", testHandler.RunTests)
		api.GET("/schema", handlers.GetSchema)
		api.GET("/files", handlers.ListFiles)
		api.GET("/files/:id", handlers.GetFile)
		api.GET("/files/:id/progress", handlers.GetFileProgress)
		api.GET("/files/:id/validation", handlers.GetFileValidation)
		api.GET("/files/:id/mapping-diagnostics", handlers.GetMappingDiagnostics)
		api.POST("/validation/:id/resolve", handlers.ResolveValidationError)
		api.POST("/files/:id/import", handlers.Import)
		api.POST("/files/:id/reprocess", handlers.ReprocessFile(cfg))
		api.DELETE("/files/:id", handlers.DeleteFile)
		api.POST("/log", handlers.CreateLog)
		api.GET("/cache", handlers.GetCache)
		api.POST("/cache", handlers.PostCache)

		// Table data CRUD
		api.GET("/tables", handlers.ListTables)
		api.GET("/tables/:name/data", handlers.GetTableData)
		api.GET("/tables/:name/columns", handlers.GetTableColumns)
		api.PUT("/tables/:name/rows/:id", handlers.UpdateTableRow)
		api.DELETE("/tables/:name/rows/:id", handlers.DeleteTableRow)

		// Job progress (SSE)
		api.POST("/jobs/:id/progress", handlers.PostProgress)
		api.GET("/jobs/:id/stream", handlers.StreamProgress)
		api.GET("/jobs/:id", handlers.GetProgress)
	}

	addr := ":" + cfg.Port
	log.Printf("[server] Starting HealthMap API %s on %s (%s)", version, addr, cfg.AppEnv)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
