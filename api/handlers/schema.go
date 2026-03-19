package handlers

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// SchemaTable represents a database table schema
type SchemaTable struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
}

// GetSchema handles GET /api/schema
// It reads db/schema.sql and extracts table names and columns.
func GetSchema(c *gin.Context) {
	tables, err := loadSchemaTables()
	if err != nil {
		log.Printf("[schema] Could not read schema.sql: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not read database schema file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tables": tables})
}

func loadSchemaTables() ([]SchemaTable, error) {
	// Attempt to locate schema.sql
	// Usually running from api/ or root, so we check a couple paths
	paths := []string{
		"../db/schema.sql",
		"db/schema.sql",
		"/app/db/schema.sql", // Docker container path
	}

	var content []byte
	var err error
	for _, p := range paths {
		content, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}

	if err != nil {
		return nil, err
	}

	return parseSchemaSQL(string(content)), nil
}

func parseSchemaSQL(sql string) []SchemaTable {
	var tables []SchemaTable
	
	// Split by CREATE TABLE
	createStatements := strings.Split(sql, "CREATE TABLE ")
	if len(createStatements) == 0 {
		createStatements = strings.Split(sql, "create table ")
	}

	for i := 1; i < len(createStatements); i++ {
		stmt := createStatements[i]
		
		// Remove IF NOT EXISTS
		stmt = strings.Replace(stmt, "IF NOT EXISTS ", "", 1)
		stmt = strings.Replace(stmt, "if not exists ", "", 1)

		// Parse table name
		parts := strings.SplitN(strings.TrimSpace(stmt), " ", 2)
		if len(parts) < 2 {
			continue
		}
		
		tableName := strings.TrimSpace(parts[0])
		
		// Extract inside parentheses
		startIdx := strings.Index(stmt, "(")
		endIdx := strings.LastIndex(stmt, ")")
		
		if startIdx == -1 || endIdx == -1 || startIdx >= endIdx {
			continue
		}
		
		columnsStr := stmt[startIdx+1 : endIdx]
		
		// Parse columns
		var columns []string
		lines := strings.Split(columnsStr, ",")
		
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(strings.ToLower(line), "constraint") {
				continue
			}
			
			// Extract column name (first word)
			colParts := strings.Fields(line)
			if len(colParts) > 0 {
				colName := colParts[0]
				// Avoid constraint blocks that might not be separated by comma nicely
				if strings.ToLower(colName) != "constraint" && strings.ToLower(colName) != "primary" && strings.ToLower(colName) != "foreign" {
					columns = append(columns, colName)
				}
			}
		}
		
		if len(columns) > 0 {
			tables = append(tables, SchemaTable{
				Name:    tableName,
				Columns: columns,
			})
		}
	}
	
	return tables
}
