"use client"

import { useState, useEffect } from "react"
import { 
  Card, 
  CardBody, 
  CardHeader, 
  Button, 
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Select,
  SelectItem
} from "@heroui/react"
import { Brain, ArrowRight, Check, Pencil, CheckCircle, AlertCircle, Loader2, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { getSchema, importFile, getMappingDiagnostics } from '../api'
import type { MLMapping, SchemaTable, MappingDiagnosticsResponse, MappingDiagnosticError } from '../api'

interface ColumnMapping {
  file_column: string
  db_column: string
  confidence: "high" | "medium" | "low" | "manual"
}

interface FileOption {
  id: string
  name: string
}

interface MappingResultProps {
  mapping: MLMapping
  files: FileOption[]
  selectedFileId: string | null
  onFileSelect: (fileId: string) => void
}

function getConfidenceChip(confidence: ColumnMapping["confidence"]) {
  const variants = {
    high: "bg-primary/10 text-primary",
    manual: "bg-chart-2/10 text-chart-2",
    medium: "bg-chart-3/10 text-chart-3",
    low: "bg-destructive/10 text-destructive",
  }

  return (
    <Chip variant="flat" size="sm" className={cn("capitalize font-semibold", variants[confidence])}>
      {confidence}
    </Chip>
  )
}

export function MappingResult({ 
  mapping, 
  files,
  selectedFileId,
  onFileSelect,
}: MappingResultProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedMapping, setEditedMapping] = useState<MLMapping>(mapping)
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle")
  const [importMessage, setImportMessage] = useState("")
  const [schemas, setSchemas] = useState<SchemaTable[]>([])
  const [diagnostics, setDiagnostics] = useState<MappingDiagnosticsResponse | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)

  // Load schemas on mount
  useEffect(() => {
    getSchema().then(setSchemas).catch(console.error)
  }, [])

  // Reset edited mapping when mapping prop changes
  useEffect(() => {
    setEditedMapping(mapping)
  }, [mapping])

  useEffect(() => {
    if (!selectedFileId) return
    setDiagnosticsLoading(true)
    setDiagnosticsError(null)
    getMappingDiagnostics(parseInt(selectedFileId))
      .then(setDiagnostics)
      .catch((err) => setDiagnosticsError(err instanceof Error ? err.message : "Failed to load diagnostics"))
      .finally(() => setDiagnosticsLoading(false))
  }, [selectedFileId])

  const highCount = editedMapping.column_mappings.filter(
    (m) => m.confidence === "high" || m.confidence === "manual"
  ).length
  const totalMapped = editedMapping.column_mappings.length
  const totalUnmapped = editedMapping.unmapped_columns.length

  const handleTableChange = (value: React.ChangeEvent<HTMLSelectElement>) => {
    setEditedMapping((prev) => ({ ...prev, target_table: value.target.value }))
  }

  const handleColumnChange = (fileCol: string, newDbCol: string) => {
    setEditedMapping((prev) => ({
      ...prev,
      column_mappings: prev.column_mappings.map((cm) =>
        cm.file_column === fileCol
          ? { ...cm, db_column: newDbCol, confidence: "manual" }
          : cm
      ),
    }))
  }

  const handleApprove = async () => {
    if (!selectedFileId) return
    
    setIsImporting(true)
    setImportStatus("idle")
    try {
      const res = await importFile(parseInt(selectedFileId), editedMapping)
      setImportStatus("success")
      setImportMessage(`Successfully imported ${res.rows_inserted} rows!`)
      setIsEditing(false)
    } catch (err) {
      setImportStatus("error")
      setImportMessage(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsImporting(false)
    }
  }

  const currentSchema = schemas.find((s) => s.name === editedMapping.target_table)
  const sortedFileColumns = diagnostics?.file_columns ? [...diagnostics.file_columns].sort() : []
  const mappingErrors = diagnostics?.errors || []
  const errorCount = mappingErrors.filter((e) => e.severity === "error").length
  const warningCount = mappingErrors.filter((e) => e.severity === "warning").length

  // Check if mapping failed
  const isMappingFailed = !editedMapping.target_table || 
    editedMapping.target_table.includes("unknown") || 
    editedMapping.target_table.includes("error")

  return (
    <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="pb-4 border-b border-border">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full">
          <div className="space-y-3 w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <p className="text-lg font-bold">AI Mapping Result</p>
            </div>
            <Select 
              aria-label="Select file"
              placeholder="Select a file to map..."
              selectedKeys={selectedFileId ? [selectedFileId] : []}
              onChange={(e) => onFileSelect(e.target.value)}
              className="max-w-[280px]"
              variant="bordered"
              size="sm"
              classNames={{
                trigger: "bg-card border-border data-[hover=true]:border-primary",
                value: "text-foreground",
                listboxWrapper: "bg-card",
                popoverContent: "bg-card border border-border",
              }}
            >
              {files.map((file) => (
                <SelectItem key={file.id} textValue={file.name}>
                  {file.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="flex flex-col items-end gap-3 w-full sm:w-auto">
            {isEditing ? (
              <Select 
                aria-label="Target table"
                placeholder="Select table..."
                selectedKeys={[editedMapping.target_table]}
                onChange={handleTableChange}
                className="w-[200px]"
                variant="bordered"
                size="sm"
                classNames={{
                  trigger: "bg-card border-border data-[hover=true]:border-primary",
                  value: "text-foreground",
                  listboxWrapper: "bg-card",
                  popoverContent: "bg-card border border-border",
                }}
              >
                {schemas.map((s) => (
                  <SelectItem key={s.name} textValue={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </Select>
            ) : (
              <Chip variant="flat" className={cn(
                "font-medium",
                isMappingFailed
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-foreground"
              )}>
                {isMappingFailed
                  ? "Mapping Failed" 
                  : editedMapping.target_table}
              </Chip>
            )}
            {importStatus !== "success" && (
              <Button
                variant="bordered"
                size="sm"
                onPress={() => setIsEditing(!isEditing)}
                startContent={<Pencil className="h-3.5 w-3.5" />}
                className="font-medium"
              >
                {isEditing ? "Cancel" : "Edit Mapping"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-6">
        {/* Stats */}
        <div className="flex flex-wrap items-center gap-3">
          <Chip variant="flat" size="sm" className="bg-primary/10 text-primary font-semibold">
            {totalMapped} Mapped
          </Chip>
          <Chip variant="flat" size="sm" className="bg-chart-2/10 text-chart-2 font-semibold">
            {highCount} High Confidence
          </Chip>
          {totalUnmapped > 0 && (
            <Chip variant="flat" size="sm" className="bg-chart-3/10 text-chart-3 font-semibold">
              {totalUnmapped} Unmapped
            </Chip>
          )}
          {mapping.confidence !== undefined && (
            <Chip 
              variant="flat" 
              size="sm" 
              className={cn(
                "font-semibold",
                mapping.confidence >= 0.8 ? "bg-primary/10 text-primary" :
                mapping.confidence >= 0.5 ? "bg-chart-3/10 text-chart-3" :
                "bg-destructive/10 text-destructive"
              )}
            >
              {Math.round(mapping.confidence * 100)}% Confidence
            </Chip>
          )}
          {mapping.cache_hit && (
            <Chip variant="flat" size="sm" className="bg-chart-2/10 text-chart-2 font-semibold">
              Cache Hit
            </Chip>
          )}
        </div>

        {/* Mapping Table */}
        {totalMapped > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table 
              aria-label="Column Mapping Table"
              shadow="none"
              removeWrapper
              classNames={{
                th: "bg-muted/30 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-4",
                td: "py-4"
              }}
            >
              <TableHeader>
                <TableColumn>File Column</TableColumn>
                <TableColumn className="w-12">{" "}</TableColumn>
                <TableColumn>Database Column</TableColumn>
                <TableColumn className="text-right">Confidence</TableColumn>
              </TableHeader>
              <TableBody>
                {editedMapping.column_mappings.map((cm, i) => (
                  <TableRow key={i} className="border-b border-border last:border-none">
                    <TableCell>
                      <code className="px-2.5 py-1.5 rounded-lg bg-muted text-sm font-mono">
                        {cm.file_column}
                      </code>
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Select
                          aria-label="Select database column"
                          selectedKeys={[cm.db_column]}
                          onChange={(e) => handleColumnChange(cm.file_column, e.target.value)}
                          variant="bordered"
                          size="sm"
                          className="max-w-[200px]"
                          classNames={{
                            trigger: "bg-card border-border",
                            value: "text-foreground",
                            listboxWrapper: "bg-card",
                            popoverContent: "bg-card border border-border",
                          }}
                        >
                          {[
                            <SelectItem key="unknown" textValue="-- Ignore --">-- Ignore --</SelectItem>,
                            ...(currentSchema?.columns || []).map((col) => (
                              <SelectItem key={col} textValue={col}>
                                {col}
                              </SelectItem>
                            ))
                          ]}
                        </Select>
                      ) : (
                        <code className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-mono">
                          {cm.db_column}
                        </code>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {getConfidenceChip(cm.confidence as ColumnMapping["confidence"])}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Unmapped Columns */}
        {totalUnmapped > 0 && (
          <div className="space-y-3 p-4 rounded-xl bg-chart-3/5 border border-chart-3/20">
            <div className="flex items-center gap-2 text-chart-3">
              <AlertCircle className="h-4 w-4" />
              <span className="font-semibold text-sm">Unmapped Columns</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {editedMapping.unmapped_columns.map((col, i) => (
                <Chip key={i} variant="flat" size="sm" className="bg-chart-3/10 text-chart-3 font-medium">
                  {col}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* File Columns & Mapping Diagnostics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <p className="font-semibold">File Columns</p>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {diagnosticsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading columns...
                </div>
              ) : diagnosticsError ? (
                <div className="text-destructive text-sm font-medium">{diagnosticsError}</div>
              ) : sortedFileColumns.length === 0 ? (
                <div className="text-muted-foreground text-sm">No columns found.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sortedFileColumns.map((col) => (
                    <Chip key={col} variant="flat" size="sm" className="bg-muted/50 text-foreground font-medium">
                      {col}
                    </Chip>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="border border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-chart-3" />
                  <p className="font-semibold">Mapping Diagnostics</p>
                </div>
                <div className="flex items-center gap-2">
                  {errorCount > 0 && (
                    <Chip size="sm" variant="flat" className="bg-destructive/10 text-destructive font-semibold">
                      {errorCount} errors
                    </Chip>
                  )}
                  {warningCount > 0 && (
                    <Chip size="sm" variant="flat" className="bg-chart-3/10 text-chart-3 font-semibold">
                      {warningCount} warnings
                    </Chip>
                  )}
                  {errorCount === 0 && warningCount === 0 && (
                    <Chip size="sm" variant="flat" className="bg-primary/10 text-primary font-semibold">
                      Clean
                    </Chip>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {diagnosticsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading diagnostics...
                </div>
              ) : diagnosticsError ? (
                <div className="text-destructive text-sm font-medium">{diagnosticsError}</div>
              ) : mappingErrors.length === 0 ? (
                <div className="text-muted-foreground text-sm">No mapping issues detected.</div>
              ) : (
                <div className="space-y-2">
                  {mappingErrors.map((err: MappingDiagnosticError, idx) => (
                    <div
                      key={`${err.type}-${idx}`}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border",
                        err.severity === "error"
                          ? "border-destructive/20 bg-destructive/5 text-destructive"
                          : err.severity === "warning"
                          ? "border-chart-3/20 bg-chart-3/5 text-chart-3"
                          : "border-primary/20 bg-primary/5 text-primary"
                      )}
                    >
                      <div className="mt-0.5">
                        {err.severity === "error" ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{err.message}</p>
                        <div className="text-xs text-muted-foreground mt-1">
                          {err.file_column && <span>File: <code>{err.file_column}</code> </span>}
                          {err.db_column && <span>DB: <code>{err.db_column}</code> </span>}
                          {err.target_table && <span>Table: <code>{err.target_table}</code></span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Import Status & Button */}
        <div className="pt-4 border-t border-border space-y-4">
          {importMessage && (
            <div
              className={cn(
                "flex items-center gap-3 p-4 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-300",
                importStatus === "success"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20"
              )}
            >
              {importStatus === "success" ? (
                <CheckCircle className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
              <span className="font-semibold">{importMessage}</span>
            </div>
          )}

          {importStatus !== "success" && !isMappingFailed && (
            <div className="flex justify-end">
              <Button
                color="primary"
                onPress={handleApprove}
                isDisabled={isImporting}
                className="font-semibold gap-2"
                startContent={!isImporting && <Check className="h-4 w-4" />}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  "Approve & Import"
                )}
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

export default MappingResult
