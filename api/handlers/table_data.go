package handlers

import (
	"net/http"
	"strconv"

	"epaccdataunifier/database"

	"github.com/gin-gonic/gin"
)

var allowedTables = map[string]bool{
	"tbCaseData":                        true,
	"tbImportAcData":                    true,
	"tbImportLabsData":                  true,
	"tbImportIcd10Data":                 true,
	"tbImportDeviceMotionData":          true,
	"tbImportDevice1HzMotionData":       true,
	"tbImportMedicationInpatientData":   true,
	"tbImportNursingDailyReportsData":   true,
}

type TableInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

var tableDescriptions = map[string]string{
	"tbCaseData":                      "Case Data",
	"tbImportAcData":                 "AC Data",
	"tbImportLabsData":               "Labs Data",
	"tbImportIcd10Data":              "ICD10 Data",
	"tbImportDeviceMotionData":       "Device Motion Data",
	"tbImportDevice1HzMotionData":    "Device 1Hz Motion Data",
	"tbImportMedicationInpatientData": "Medication Inpatient Data",
	"tbImportNursingDailyReportsData": "Nursing Daily Reports Data",
}

func ListTables(c *gin.Context) {
	var tables []TableInfo
	for name := range allowedTables {
		tables = append(tables, TableInfo{
			Name:        name,
			Description: tableDescriptions[name],
		})
	}
	c.JSON(http.StatusOK, tables)
}

func GetTableData(c *gin.Context) {
	tableName := c.Param("name")
	if !allowedTables[tableName] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid table name"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	offset := (page - 1) * limit

	var rows []map[string]interface{}
	err := database.DB.Table(tableName).
		Limit(limit).
		Offset(offset).
		Order("id DESC").
		Find(&rows).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query table: " + err.Error()})
		return
	}

	var total int64
	database.DB.Table(tableName).Count(&total)

	c.JSON(http.StatusOK, gin.H{
		"table":     tableName,
		"rows":       rows,
		"total":     total,
		"page":      page,
		"page_size": limit,
	})
}

func UpdateTableRow(c *gin.Context) {
	tableName := c.Param("name")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid row ID"})
		return
	}

	if !allowedTables[tableName] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid table name"})
		return
	}

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON: " + err.Error()})
		return
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No fields to update"})
		return
	}

	result := database.DB.Table(tableName).Where("id = ?", id).Updates(updates)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Update failed: " + result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Row not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Row updated", "id": id})
}

func DeleteTableRow(c *gin.Context) {
	tableName := c.Param("name")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid row ID"})
		return
	}

	if !allowedTables[tableName] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid table name"})
		return
	}

	result := database.DB.Table(tableName).Where("id = ?", id).Delete(nil)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Delete failed: " + result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Row not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Row deleted", "id": id})
}

func GetTableColumns(c *gin.Context) {
	tableName := c.Param("name")
	if !allowedTables[tableName] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid table name"})
		return
	}

	var columns []string
	rows, err := database.DB.Table(tableName).Limit(1).Rows()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get columns: " + err.Error()})
		return
	}
	defer rows.Close()

	if rows.Err() != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get columns: " + rows.Err().Error()})
		return
	}

	columns, _ = rows.Columns()

	c.JSON(http.StatusOK, gin.H{
		"table":   tableName,
		"columns": columns,
	})
}
