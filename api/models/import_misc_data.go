package models

import "time"

// TBImportIcd10Data
type TBImportIcd10Data struct {
	CoId                            int64   `gorm:"primaryKey;autoIncrement;column:coId"`
	CoCaseId                        *int64  `gorm:"column:coCaseId"`
	CoWard                          *string `gorm:"column:coWard;type:varchar(256)"`
	CoAdmissionDate                *string `gorm:"column:coAdmission_date;type:varchar(256)"`
	CoDischargeDate                *string `gorm:"column:coDischarge_date;type:varchar(256)"`
	CoLengthOfStayDays             *string `gorm:"column:coLength_of_stay_days;type:varchar(256)"`
	CoPrimaryIcd10Code             *string `gorm:"column:coPrimary_icd10_code;type:varchar(256)"`
	CoPrimaryIcd10DescriptionEn    *string `gorm:"column:coPrimary_icd10_description_en;type:varchar(256)"`
	CoSecondaryIcd10Codes          *string `gorm:"column:coSecondary_icd10_codes;type:varchar(256)"`
	CpSecondaryIcd10DescriptionsEn *string `gorm:"column:cpSecondary_icd10_descriptions_en;type:varchar(256)"`
	CoOpsCodes                      *string `gorm:"column:coOps_codes;type:varchar(256)"`
	OpsDescriptionsEn               *string `gorm:"column:ops_descriptions_en;type:varchar(256)"`
}

func (TBImportIcd10Data) TableName() string {
	return "tbImportIcd10Data"
}

// TBImportDeviceMotionData
type TBImportDeviceMotionData struct {
	CoId                        int64      `gorm:"primaryKey;autoIncrement;column:coId"`
	CoCaseId                    *int64     `gorm:"column:coCaseId"`
	CoTimestamp                 *time.Time `gorm:"column:coTimestamp"`
	CoPatientId                 *string    `gorm:"column:coPatient_id;type:varchar(256)"`
	CoMovementIndex0100        *string    `gorm:"column:coMovement_index_0_100;type:varchar(256)"`
	CoMicroMovementsCount       *string    `gorm:"column:coMicro_movements_count;type:varchar(256)"`
	CoBedExitDetected01        *string    `gorm:"column:coBed_exit_detected_0_1;type:varchar(256)"`
	CoFallEvent01              *string    `gorm:"column:coFall_event_0_1;type:varchar(256)"`
	CoImpactMagnitudeG          *string    `gorm:"column:coImpact_magnitude_g;type:varchar(256)"`
	CoPostFallImmobilityMinutes *string    `gorm:"column:coPost_fall_immobility_minutes;type:varchar(256)"`
}

func (TBImportDeviceMotionData) TableName() string {
	return "tbImportDeviceMotionData"
}

// TBImportDevice1HzMotionData
type TBImportDevice1HzMotionData struct {
	CoId                 int64      `gorm:"primaryKey;autoIncrement;column:coId"`
	CoCaseId             *int64     `gorm:"column:coCaseId"`
	CoTimestamp          *time.Time `gorm:"column:coTimestamp"`
	CoPatientId          *string    `gorm:"column:coPatient_id;type:varchar(256)"`
	CoDeviceId           *string    `gorm:"column:coDevice_id;type:varchar(256)"`
	CoBedOccupied01      *string    `gorm:"column:coBed_occupied_0_1;type:varchar(256)"`
	CoMovementScore0100  *string    `gorm:"column:coMovement_score_0_100;type:varchar(256)"`
	CoAccelXMS2          *string    `gorm:"column:coAccel_x_m_s2;type:varchar(256)"`
	CoAccelYMS2          *string    `gorm:"column:coAccel_y_m_s2;type:varchar(256)"`
	CoAccelZMS2          *string    `gorm:"column:coAccel_z_m_s2;type:varchar(256)"`
	CoAccelMagnitudeG    *string    `gorm:"column:coAccel_magnitude_g;type:varchar(256)"`
	CoPressureZone1_0100 *string    `gorm:"column:coPressure_zone1_0_100;type:varchar(256)"`
	CoPressureZone2_0100 *string    `gorm:"column:coPressure_zone2_0_100;type:varchar(256)"`
	CoPressureZone3_0100 *string    `gorm:"column:coPressure_zone3_0_100;type:varchar(256)"`
	CoPressureZone4_0100 *string    `gorm:"column:coPressure_zone4_0_100;type:varchar(256)"`
	CoBedExitEvent01     *string    `gorm:"column:coBed_exit_event_0_1;type:varchar(256)"`
	CoBedReturnEvent01   *string    `gorm:"column:coBed_return_event_0_1;type:varchar(256)"`
	CoFallEvent01       *string    `gorm:"column:coFall_event_0_1;type:varchar(256)"`
	CoImpactMagnitudeG   *string    `gorm:"column:coImpact_magnitude_g;type:varchar(256)"`
	CoEventId            *string    `gorm:"column:coEvent_id;type:varchar(256)"`
}

func (TBImportDevice1HzMotionData) TableName() string {
	return "tbImportDevice1HzMotionData"
}

// TBImportMedicationInpatientData
type TBImportMedicationInpatientData struct {
	CoId                   int64   `gorm:"primaryKey;autoIncrement;column:coId"`
	CoCaseId               *int64  `gorm:"column:coCaseId"`
	CoPatientId            *string `gorm:"column:coPatient_id;type:varchar(256)"`
	CoRecordType           *string `gorm:"column:coRecord_type;type:varchar(256)"`
	CoEncounterId          *string `gorm:"column:coEncounter_id;type:varchar(256)"`
	CoWard                 *string `gorm:"column:coWard;type:varchar(256)"`
	CoAdmissionDatetime   *string `gorm:"column:coAdmission_datetime;type:varchar(256)"`
	CoDischargeDatetime   *string `gorm:"column:coDischarge_datetime;type:varchar(256)"`
	CoOrderId              *string `gorm:"column:coOrder_id;type:varchar(256)"`
	CoOrderUuid            *string `gorm:"column:coOrder_uuid;type:varchar(256)"`
	CoMedicationCodeAtc   *string `gorm:"column:coMedication_code_atc;type:varchar(256)"`
	CoMedicationName       *string `gorm:"column:coMedication_name;type:varchar(256)"`
	CoRoute                *string `gorm:"column:coRoute;type:varchar(256)"`
	CoDose                 *string `gorm:"column:coDose;type:varchar(256)"`
	CoDoseUnit             *string `gorm:"column:coDose_unit;type:varchar(256)"`
	CoFrequency            *string `gorm:"column:coFrequency;type:varchar(256)"`
	CoOrderStartDatetime  *string `gorm:"column:coOrder_start_datetime;type:varchar(256)"`
	CoOrderStopDatetime    *string `gorm:"column:coOrder_stop_datetime;type:varchar(256)"`
	CoIsPrn01              *string `gorm:"column:coIs_prn_0_1;type:varchar(256)"`
	CoIndication           *string `gorm:"column:coIndication;type:varchar(256)"`
	PrescriberRole         *string `gorm:"column:prescriber_role;type:varchar(256)"`
	OrderStatus            *string `gorm:"column:order_status;type:varchar(256)"`
	AdministrationDatetime *string `gorm:"column:administration_datetime;type:varchar(256)"`
	AdministeredDose       *string `gorm:"column:administered_dose;type:varchar(256)"`
	AdministeredUnit       *string `gorm:"column:administered_unit;type:varchar(256)"`
	AdministrationStatus   *string `gorm:"column:administration_status;type:varchar(256)"`
	Note                   *string `gorm:"column:note;type:varchar(256)"`
}

func (TBImportMedicationInpatientData) TableName() string {
	return "tbImportMedicationInpatientData"
}

// TBImportNursingDailyReportsData
type TBImportNursingDailyReportsData struct {
	CoId                  int64   `gorm:"primaryKey;autoIncrement;column:coId"`
	CoCaseId              *int64  `gorm:"column:coCaseId"`
	CoPatientId           *string `gorm:"column:coPatient_id;type:varchar(256)"`
	CoWard                *string `gorm:"column:coWard;type:varchar(256)"`
	CoReportDate          *string `gorm:"column:coReport_date;type:varchar(256)"`
	CoShift               *string `gorm:"column:coShift;type:varchar(256)"`
	CoNursingNoteFreeText *string `gorm:"column:coNursing_note_free_text;type:text"`
}

func (TBImportNursingDailyReportsData) TableName() string {
	return "tbImportNursingDailyReportsData"
}
