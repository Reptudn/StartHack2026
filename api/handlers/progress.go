package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"epaccdataunifier/database"
	"epaccdataunifier/models"

	"github.com/gin-gonic/gin"
)

// In-memory job store — maps jobId to latest progress + subscriber channels.
var (
	jobStore = sync.Map{} // jobId → *jobState
)

type jobState struct {
	mu          sync.RWMutex
	progress    models.JobProgress
	subscribers map[chan models.JobProgress]struct{}
}

func getOrCreateJob(jobID string) *jobState {
	if v, ok := jobStore.Load(jobID); ok {
		return v.(*jobState)
	}

	// Try loading from DB (user came back after restart)
	var existing models.JobState
	if err := database.DB.First(&existing, "job_id = ?", jobID).Error; err == nil {
		p := models.JobProgress{
			JobID:   jobID,
			Stage:   existing.Stage,
			Message: existing.Message,
			Percent: existing.Percent,
		}
		if existing.Data != "" && existing.Data != "{}" {
			var data map[string]interface{}
			json.Unmarshal([]byte(existing.Data), &data)
			p.Data = data
		}
		js := &jobState{
			progress:    p,
			subscribers: make(map[chan models.JobProgress]struct{}),
		}
		jobStore.Store(jobID, js)
		return js
	}

	js := &jobState{
		progress: models.JobProgress{
			JobID:   jobID,
			Stage:   "queued",
			Message: "Waiting to start...",
			Percent: 0,
		},
		subscribers: make(map[chan models.JobProgress]struct{}),
	}
	jobStore.Store(jobID, js)
	return js
}

// PostProgress handles POST /api/jobs/:id/progress — called by the ML service.
func PostProgress(c *gin.Context) {
	jobID := c.Param("id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Missing job ID"})
		return
	}

	var progress models.JobProgress
	if err := c.ShouldBindJSON(&progress); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Invalid progress payload: " + err.Error()})
		return
	}
	progress.JobID = jobID
	progress.Timestamp = time.Now().UnixMilli()

	js := getOrCreateJob(jobID)
	js.mu.Lock()
	js.progress = progress
	// Notify all SSE subscribers
	for ch := range js.subscribers {
		select {
		case ch <- progress:
		default: // drop if subscriber is slow
		}
	}
	js.mu.Unlock()

	// Persist to DB so users can check status after refresh/restart
	dataJSON := "{}"
	if progress.Data != nil {
		if b, err := json.Marshal(progress.Data); err == nil {
			dataJSON = string(b)
		}
	}
	jobState := models.JobState{
		JobID:     jobID,
		Stage:     progress.Stage,
		Message:   progress.Message,
		Percent:   progress.Percent,
		Data:      dataJSON,
		UpdatedAt: time.Now(),
	}
	database.DB.Save(&jobState)

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetProgress handles GET /api/jobs/:id — polling fallback, returns latest snapshot.
func GetProgress(c *gin.Context) {
	jobID := c.Param("id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Missing job ID"})
		return
	}

	// Check in-memory first
	if v, ok := jobStore.Load(jobID); ok {
		js := v.(*jobState)
		js.mu.RLock()
		p := js.progress
		js.mu.RUnlock()
		c.JSON(http.StatusOK, p)
		return
	}

	// Fall back to DB
	var existing models.JobState
	if err := database.DB.First(&existing, "job_id = ?", jobID).Error; err == nil {
		p := models.JobProgress{
			JobID:   jobID,
			Stage:   existing.Stage,
			Message: existing.Message,
			Percent: existing.Percent,
		}
		if existing.Data != "" && existing.Data != "{}" {
			var data map[string]interface{}
			json.Unmarshal([]byte(existing.Data), &data)
			p.Data = data
		}
		c.JSON(http.StatusOK, p)
		return
	}

	c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "Job not found"})
}

// StreamProgress handles GET /api/jobs/:id/stream — SSE endpoint.
func StreamProgress(c *gin.Context) {
	jobID := c.Param("id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "Missing job ID"})
		return
	}

	js := getOrCreateJob(jobID)

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", c.Request.Header.Get("Origin"))
	c.Header("Access-Control-Allow-Credentials", "true")
	c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Cache-Control, Last-Event-ID")
	c.Header("Vary", "Origin")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: "Streaming not supported"})
		return
	}

	// Create a subscriber channel
	ch := make(chan models.JobProgress, 16)
	js.mu.Lock()
	js.subscribers[ch] = struct{}{}
	// Send current state immediately
	current := js.progress
	js.mu.Unlock()

	// Write current state first
	writeSSE(c, flusher, current)

	// If already done/error, send and close
	if current.Stage == "done" || current.Stage == "error" {
		js.mu.Lock()
		delete(js.subscribers, ch)
		js.mu.Unlock()
		close(ch)
		return
	}

	// Listen for updates until done/error or client disconnects
	notify := c.Request.Context().Done()
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-notify:
			// Client disconnected
			js.mu.Lock()
			delete(js.subscribers, ch)
			js.mu.Unlock()
			close(ch)
			return
		case p, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(c, flusher, p)
			if p.Stage == "done" || p.Stage == "error" {
				js.mu.Lock()
				delete(js.subscribers, ch)
				js.mu.Unlock()
				close(ch)
				return
			}
		case <-keepalive.C:
			// Send a comment to keep the connection alive
			fmt.Fprintf(c.Writer, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func writeSSE(c *gin.Context, flusher http.Flusher, p models.JobProgress) {
	b, err := json.Marshal(p)
	if err != nil {
		return
	}
	fmt.Fprintf(c.Writer, "event: progress\n")
	fmt.Fprintf(c.Writer, "data: %s\n\n", string(b))
	flusher.Flush()
}
