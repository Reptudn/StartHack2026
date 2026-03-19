package models

import "time"

type TBCaseData struct {
	CoId           int64      `gorm:"primaryKey;autoIncrement;column:coId"`
	CoE2I222       *int64     `gorm:"column:coE2I222"`
	CoPatientId    *int64     `gorm:"column:coPatientId"`
	CoE2I223       *time.Time `gorm:"column:coE2I223"`
	CoE2I228       *time.Time `gorm:"column:coE2I228"`
	CoLastname     *string    `gorm:"column:coLastname;type:varchar(256)"`
	CoFirstname    *string    `gorm:"column:coFirstname;type:varchar(256)"`
	CoGender       *string    `gorm:"column:coGender;type:varchar(256)"`
	CoDateOfBirth  *time.Time `gorm:"column:coDateOfBirth"`
	CoAgeYears     *int       `gorm:"column:coAgeYears"`
	CoTypeOfStay   *string    `gorm:"column:coTypeOfStay;type:varchar(256)"`
	CoIcd          *string    `gorm:"column:coIcd;type:varchar(256)"`
	CoDrgName      *string    `gorm:"column:coDrgName;type:varchar(256)"`
	CoRecliningType *string    `gorm:"column:coRecliningType;type:varchar(256)"`
	CoState        *string    `gorm:"column:coState;type:varchar(256)"`
}

func (TBCaseData) TableName() string {
	return "tbCaseData"
}
