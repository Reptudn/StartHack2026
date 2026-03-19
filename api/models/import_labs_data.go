package models

type TBImportLabsData struct {
	CoId                int64   `gorm:"primaryKey;autoIncrement;column:coId"`
	CoCaseId            *int64  `gorm:"column:coCaseId"`
	CoSpecimenDatetime  *string `gorm:"column:coSpecimen_datetime;type:varchar(256)"`
	CoSodiumMmolL       *string `gorm:"column:coSodium_mmol_L;type:varchar(256)"`
	CoSodiumFlag        *string `gorm:"column:coSodium_flag;type:varchar(256)"`
	CoSodiumRefLow      *string `gorm:"column:cosodium_ref_low;type:varchar(256)"`
	CoSodiumRefHigh     *string `gorm:"column:cosodium_ref_high;type:varchar(256)"`
	CoPotassiumMmolL    *string `gorm:"column:coPotassium_mmol_L;type:varchar(256)"`
	CoPotassiumFlag     *string `gorm:"column:coPotassium_flag;type:varchar(256)"`
	CoPotassiumRefLow   *string `gorm:"column:coPotassium_ref_low;type:varchar(256)"`
	CoPotassiumRefHigh  *string `gorm:"column:coPotassium_ref_high;type:varchar(256)"`
	CoCreatinineMgDl    *string `gorm:"column:coCreatinine_mg_dL;type:varchar(256)"`
	CoCreatinineFlag    *string `gorm:"column:coCreatinine_flag;type:varchar(256)"`
	CoCreatinineRefLow  *string `gorm:"column:coCreatinine_ref_low;type:varchar(256)"`
	CoCreatinineRefHigh *string `gorm:"column:coCreatinine_ref_high;type:varchar(256)"`
	CoEgfrMlMin173m2    *string `gorm:"column:coEgfr_mL_min_1_73m2;type:varchar(256)"`
	CoEgfrFlag          *string `gorm:"column:coEgfr_flag;type:varchar(256)"`
	CoEgfrRefLow        *string `gorm:"column:coEgfr_ref_low;type:varchar(256)"`
	CoEgfrRefHigh       *string `gorm:"column:coEgfr_ref_high;type:varchar(256)"`
	CoGlucoseMgDl       *string `gorm:"column:coGlucose_mg_dL;type:varchar(256)"`
	CoGlucoseFlag       *string `gorm:"column:coGlucose_flag;type:varchar(256)"`
	CoGlucoseRefLow     *string `gorm:"column:coGlucose_ref_low;type:varchar(256)"`
	CoGlucoseRefHigh    *string `gorm:"column:coGlucose_ref_high;type:varchar(256)"`
	CoHemoglobinGDl     *string `gorm:"column:coHemoglobin_g_dL;type:varchar(256)"`
	CoHbFlag            *string `gorm:"column:coHb_flag;type:varchar(256)"`
	CoHbRefLow          *string `gorm:"column:coHb_ref_low;type:varchar(256)"`
	CoHbRefHigh         *string `gorm:"column:coHb_ref_high;type:varchar(256)"`
	CoWbc10e9L          *string `gorm:"column:coWbc_10e9_L;type:varchar(256)"`
	CoWbcFlag           *string `gorm:"column:coWbc_flag;type:varchar(256)"`
	CoWbcRefLow         *string `gorm:"column:coWbc_ref_low;type:varchar(256)"`
	CoWbcRefHigh        *string `gorm:"column:coWbc_ref_high;type:varchar(256)"`
	CoPlatelets10e9L    *string `gorm:"column:coPlatelets_10e9_L;type:varchar(256)"`
	CoPlateletsFlag     *string `gorm:"column:coPlatelets_flag;type:varchar(256)"`
	CoPltRefLow         *string `gorm:"column:coPlt_ref_low;type:varchar(256)"`
	CoPltRefHigh        *string `gorm:"column:coPlt_ref_high;type:varchar(256)"`
	CoCrpMgL            *string `gorm:"column:coCrp_mg_L;type:varchar(256)"`
	CoCrpFlag           *string `gorm:"column:coCrp_flag;type:varchar(256)"`
	CoCrpRefLow         *string `gorm:"column:coCrp_ref_low;type:varchar(256)"`
	CoCrpRefHigh        *string `gorm:"column:coCrp_ref_high;type:varchar(256)"`
	CoAltUL             *string `gorm:"column:coAlt_U_L;type:varchar(256)"`
	CoAltFlag           *string `gorm:"column:coAlt_flag;type:varchar(256)"`
	CoAltRefLow         *string `gorm:"column:coAlt_ref_low;type:varchar(256)"`
	CoAltRefHigh        *string `gorm:"column:coAlt_ref_high;type:varchar(256)"`
	CoAstUL             *string `gorm:"column:coAst_U_L;type:varchar(256)"`
	CoAstFlag           *string `gorm:"column:coAst_flag;type:varchar(256)"`
	CoAstRefLow         *string `gorm:"column:coAst_ref_low;type:varchar(256)"`
	CoAstRefHigh        *string `gorm:"column:coAst_ref_high;type:varchar(256)"`
	CoBilirubinMgDl     *string `gorm:"column:coBilirubin_mg_dL;type:varchar(256)"`
	CoBilirubinFlag     *string `gorm:"column:coBilirubin_flag;type:varchar(256)"`
	CoBiliRefLow        *string `gorm:"column:coBili_ref_low;type:varchar(256)"`
	CoBiliRefHigh       *string `gorm:"column:coBili_ref_high;type:varchar(256)"`
	CoAlbuminGDl        *string `gorm:"column:coAlbumin_g_dL;type:varchar(256)"`
	CoAlbuminFlag       *string `gorm:"column:coAlbumin_flag;type:varchar(256)"`
	CoAlbuminRefLow     *string `gorm:"column:coAlbumin_ref_low;type:varchar(256)"`
	CoAlbuminRefHigh    *string `gorm:"column:coAlbumin_ref_high;type:varchar(256)"`
	CoInr               *string `gorm:"column:coInr;type:varchar(256)"`
	CoInrFlag           *string `gorm:"column:coInr_flag;type:varchar(256)"`
	CoInrRefLow         *string `gorm:"column:coInr_ref_low;type:varchar(256)"`
	CoInrRefHigh        *string `gorm:"column:coInr_ref_high;type:varchar(256)"`
	CoLactateMmolL      *string `gorm:"column:coLactate_mmol_L;type:varchar(256)"`
	CoLactateFlag       *string `gorm:"column:coLactate_flag;type:varchar(256)"`
	CoLactateRefLow     *string `gorm:"column:coLactate_ref_low;type:varchar(256)"`
	CoLactateRefHigh    *string `gorm:"column:coLactate_ref_high;type:varchar(256)"`
}

func (TBImportLabsData) TableName() string {
	return "tbImportLabsData"
}
