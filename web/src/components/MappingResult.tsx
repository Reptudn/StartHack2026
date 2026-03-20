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
  SelectItem,
} from "@heroui/react"
import {
  Brain,
  ArrowRight,
  Check,
  Pencil,
  CheckCircle,
  AlertCircle,
  Loader2,
  Database,
  Ban,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSchema, importFile, getMappingDiagnostics } from "../api"
import type { MLMapping, SchemaTable, MappingDiagnosticsResponse, MappingDiagnosticError } from "../api"
import { TableDataViewer } from "./TableDataViewer"

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
  onImportSuccess?: () => void
  fileStatus?: string
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

export function MappingResult({ mapping, files, selectedFileId, onFileSelect, onImportSuccess, fileStatus }: MappingResultProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedMapping, setEditedMapping] = useState<MLMapping>(mapping)
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle")
  const [importMessage, setImportMessage] = useState("")
  const [importDetails, setImportDetails] = useState<{ inserted: number; skipped: number } | null>(null)
  const [schemas, setSchemas] = useState<SchemaTable[]>([])
  const [diagnostics, setDiagnostics] = useState<MappingDiagnosticsResponse | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"mapping" | "data">("mapping")

  useEffect(() => {
    getSchema().then(setSchemas).catch(console.error)
  }, [])

  useEffect(() => {
    setEditedMapping(mapping)
    setImportStatus("idle")
    setImportMessage("")
    setImportDetails(null)
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

  // Computed values
  const activeMappings = editedMapping.column_mappings.filter(
    (m) => m.db_column && m.db_column !== "unknown" && m.db_column !== "",
  )
  const ignoredMappings = editedMapping.column_mappings.filter(
    (m) => m.db_column === "unknown" || m.db_column === "",
  )
  const highCount = activeMappings.filter(
    (m) => m.confidence === "high" || m.confidence === "manual",
  ).length
  const totalUnmapped = editedMapping.unmapped_columns.length

  const handleTableChange = (value: React.ChangeEvent<HTMLSelectElement>) => {
    setEditedMapping((prev) => ({ ...prev, target_table: value.target.value }))
  }

  const handleColumnChange = (fileCol: string, newDbCol: string) => {
    setEditedMapping((prev) => {
      const isInMappings = prev.column_mappings.some((cm) => cm.file_column === fileCol)

      let newMappings = [...prev.column_mappings]
      if (isInMappings) {
        newMappings = newMappings.map((cm) =>
          cm.file_column === fileCol
            ? { ...cm, db_column: newDbCol, confidence: "manual" as const }
            : cm,
        )
      } else {
        // Mapping an unmapped column
        newMappings.push({
          file_column: fileCol,
          db_column: newDbCol,
          confidence: "manual" as const,
        })
      }

      // Update unmapped_columns: remove if now mapped
      const mappedCols = new Set(
        newMappings
          .filter((cm) => cm.db_column && cm.db_column !== "unknown" && cm.db_column !== "")
          .map((cm) => cm.file_column),
      )
      const newUnmapped = prev.unmapped_columns.filter((col) => !mappedCols.has(col))

      return {
        ...prev,
        column_mappings: newMappings,
        unmapped_columns: newUnmapped,
      }
    })
  }

  const handleApprove = async () => {
    if (!selectedFileId) return

    setIsImporting(true)
    setImportStatus("idle")
    try {
      const res = await importFile(parseInt(selectedFileId), editedMapping)
      setImportStatus("success")
      setImportDetails({ inserted: res.rows_inserted, skipped: res.rows_skipped })
      setImportMessage(
        res.rows_skipped > 0
          ? `Imported ${res.rows_inserted} rows (${res.rows_skipped} rows skipped — missing required fields)`
          : `Successfully imported ${res.rows_inserted} rows`,
      )
      setIsEditing(false)
      onImportSuccess?.()
    } catch (err) {
      setImportStatus("error")
      setImportMessage(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsImporting(false)
    }
  }

  const currentSchema = schemas.find((s) => s.name === editedMapping.target_table)
  const mappingErrors = diagnostics?.errors || []
  const errorCount = mappingErrors.filter((e) => e.severity === "error").length
  const warningCount = mappingErrors.filter((e) => e.severity === "warning").length

  const isMappingFailed =
    !editedMapping.target_table ||
    editedMapping.target_table.includes("unknown") ||
    editedMapping.target_table.includes("error") ||
    editedMapping.target_table === "UNKNOWN"

  const isAlreadyImported = fileStatus === "imported"

  return (
    <Card className="border border-border bg-card shadow-sm rounded-2xl">
      <CardHeader className="pb-4 border-b border-border">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full">
          <div className="space-y-3 w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold">AI Mapping Result</p>
                {mapping.reasoning && (
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{mapping.reasoning}</p>
                )}
              </div>
            </div>
            {files.length > 1 && (
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
            )}
          </div>
          <div className="flex flex-col items-end gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              {isAlreadyImported && (
                <Chip variant="flat" size="sm" className="bg-primary/10 text-primary font-semibold">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Imported
                </Chip>
              )}
              {isEditing ? (
                <Select
                  aria-label="Target table"
                  placeholder="Select table..."
                  selectedKeys={editedMapping.target_table ? [editedMapping.target_table] : []}
                  onChange={handleTableChange}
                  className="w-[260px]"
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
                <Chip
                  variant="flat"
                  className={cn(
                    "font-medium",
                    isMappingFailed ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
                  )}
                >
                  {isMappingFailed ? "No Target Table" : editedMapping.target_table}
                </Chip>
              )}
            </div>
            {importStatus !== "success" && !isAlreadyImported && (
              <Button
                variant="bordered"
                size="sm"
                onPress={() => setIsEditing(!isEditing)}
                startContent={isEditing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                className="font-medium"
              >
                {isEditing ? "Cancel Editing" : "Edit Mapping"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <div className="flex gap-1 px-6 pt-4 border-b border-border bg-muted/10">
        <button
          onClick={() => setActiveTab("mapping")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 font-medium text-sm rounded-t-lg transition-all",
            activeTab === "mapping"
              ? "bg-card text-primary border-t-2 border-x border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <Brain className="h-4 w-4" />
          Mapping
        </button>
        <button
          onClick={() => setActiveTab("data")}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 font-medium text-sm rounded-t-lg transition-all",
            activeTab === "data"
              ? "bg-card text-primary border-t-2 border-x border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <Database className="h-4 w-4" />
          Imported Data
        </button>
      </div>

      <CardBody className="space-y-6">
        {activeTab === "mapping" ? (
        <>
        {/* Summary Stats */}
        <div className="flex flex-wrap items-center gap-3">
          <Chip variant="flat" size="sm" className="bg-primary/10 text-primary font-semibold">
            {activeMappings.length} Mapped
          </Chip>
          <Chip variant="flat" size="sm" className="bg-chart-2/10 text-chart-2 font-semibold">
            {highCount} High Confidence
          </Chip>
          {ignoredMappings.length > 0 && (
            <Chip variant="flat" size="sm" className="bg-muted text-muted-foreground font-semibold">
              {ignoredMappings.length} Ignored
            </Chip>
          )}
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
                mapping.confidence >= 0.8
                  ? "bg-primary/10 text-primary"
                  : mapping.confidence >= 0.5
                    ? "bg-chart-3/10 text-chart-3"
                    : "bg-destructive/10 text-destructive",
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

        {/* Mapping Failed Warning */}
        {isMappingFailed && !isEditing && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-destructive">Classification failed</p>
              <p className="text-sm text-muted-foreground mt-1">
                The AI could not determine the target table for this file. Click &ldquo;Edit Mapping&rdquo; to manually select a target table and adjust column mappings, then import.
              </p>
            </div>
          </div>
        )}

        {/* Active Mappings Table */}
        {activeMappings.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Column Mappings</p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table
                aria-label="Column Mapping Table"
                shadow="none"
                removeWrapper
                classNames={{
                  th: "bg-muted/30 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-3",
                  td: "py-3",
                }}
              >
                <TableHeader>
                  <TableColumn>File Column</TableColumn>
                  <TableColumn className="w-12">{" "}</TableColumn>
                  <TableColumn>Database Column</TableColumn>
                  <TableColumn className="text-right">Confidence</TableColumn>
                </TableHeader>
                <TableBody>
                  {activeMappings.map((cm, i) => (
                    <TableRow key={`active-${i}`} className="border-b border-border last:border-none">
                      <TableCell>
                        <code className="px-2.5 py-1.5 rounded-lg bg-muted text-sm font-mono">{cm.file_column}</code>
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-primary" />
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Select
                            aria-label="Select database column"
                            selectedKeys={[cm.db_column]}
                            onChange={(e) => handleColumnChange(cm.file_column, e.target.value)}
                            variant="bordered"
                            size="sm"
                            className="min-w-[240px]"
                            classNames={{
                              trigger: "bg-card border-border",
                              value: "text-foreground",
                              listboxWrapper: "bg-card",
                              popoverContent: "bg-card border border-border",
                            }}
                          >
                            {[
                              <SelectItem key="unknown" textValue="-- Ignore --">
                                -- Ignore --
                              </SelectItem>,
                              ...(currentSchema?.columns || []).map((col) => (
                                <SelectItem key={col} textValue={col}>
                                  {col}
                                </SelectItem>
                              )),
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
          </div>
        )}

        {/* Ignored Columns */}
        {ignoredMappings.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Ignored Columns</p>
            <div className="rounded-xl border border-border overflow-hidden">
              {isEditing ? (
                <Table
                  aria-label="Ignored Columns Table"
                  shadow="none"
                  removeWrapper
                  classNames={{
                    th: "bg-muted/30 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-3",
                    td: "py-3",
                  }}
                >
                  <TableHeader>
                    <TableColumn>File Column</TableColumn>
                    <TableColumn className="w-12">{" "}</TableColumn>
                    <TableColumn>Database Column</TableColumn>
                    <TableColumn className="text-right">Status</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {ignoredMappings.map((cm, i) => (
                      <TableRow key={`ignored-${i}`} className="border-b border-border last:border-none opacity-70">
                        <TableCell>
                          <code className="px-2.5 py-1.5 rounded-lg bg-muted text-sm font-mono text-muted-foreground">{cm.file_column}</code>
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                        </TableCell>
                        <TableCell>
                          <Select
                            aria-label="Select database column"
                            selectedKeys={["unknown"]}
                            onChange={(e) => handleColumnChange(cm.file_column, e.target.value)}
                            variant="bordered"
                            size="sm"
                            className="min-w-[240px]"
                            classNames={{
                              trigger: "bg-card border-border",
                              value: "text-foreground",
                              listboxWrapper: "bg-card",
                              popoverContent: "bg-card border border-border",
                            }}
                          >
                            {[
                              <SelectItem key="unknown" textValue="-- Ignore --">
                                -- Ignore --
                              </SelectItem>,
                              ...(currentSchema?.columns || []).map((col) => (
                                <SelectItem key={col} textValue={col}>
                                  {col}
                                </SelectItem>
                              )),
                            ]}
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Chip variant="flat" size="sm" className="bg-muted text-muted-foreground font-semibold">
                            <Ban className="h-3 w-3 mr-1" />
                            Ignored
                          </Chip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-4 flex flex-wrap gap-2">
                  {ignoredMappings.map((cm, i) => (
                    <Chip key={i} variant="flat" size="sm" className="bg-muted/50 text-muted-foreground font-medium line-through">
                      {cm.file_column}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Unmapped Columns */}
        {totalUnmapped > 0 && (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Unmapped Columns</p>
            {isEditing ? (
              <div className="rounded-xl border border-chart-3/20 overflow-hidden">
                <Table
                  aria-label="Unmapped Columns Table"
                  shadow="none"
                  removeWrapper
                  classNames={{
                    th: "bg-chart-3/5 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-3",
                    td: "py-3",
                  }}
                >
                  <TableHeader>
                    <TableColumn>File Column</TableColumn>
                    <TableColumn className="w-12">{" "}</TableColumn>
                    <TableColumn>Map To</TableColumn>
                    <TableColumn className="text-right">Status</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {editedMapping.unmapped_columns.map((col, i) => (
                      <TableRow key={`unmapped-${i}`} className="border-b border-border last:border-none">
                        <TableCell>
                          <code className="px-2.5 py-1.5 rounded-lg bg-chart-3/10 text-chart-3 text-sm font-mono">{col}</code>
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                        </TableCell>
                        <TableCell>
                          <Select
                            aria-label="Select database column"
                            placeholder="Select column..."
                            onChange={(e) => handleColumnChange(col, e.target.value)}
                            variant="bordered"
                            size="sm"
                            className="min-w-[240px]"
                            classNames={{
                              trigger: "bg-card border-border",
                              value: "text-foreground",
                              listboxWrapper: "bg-card",
                              popoverContent: "bg-card border border-border",
                            }}
                          >
                            {[
                              <SelectItem key="unknown" textValue="-- Ignore --">
                                -- Ignore --
                              </SelectItem>,
                              ...(currentSchema?.columns || []).map((c) => (
                                <SelectItem key={c} textValue={c}>
                                  {c}
                                </SelectItem>
                              )),
                            ]}
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Chip variant="flat" size="sm" className="bg-chart-3/10 text-chart-3 font-semibold">
                            Unmapped
                          </Chip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="space-y-3 p-4 rounded-xl bg-chart-3/5 border border-chart-3/20">
                <div className="flex items-center gap-2 text-chart-3">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-semibold text-sm">{totalUnmapped} columns not mapped — these will not be imported</span>
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
          </div>
        )}

        {/* Diagnostics */}
        {(mappingErrors.length > 0 || diagnosticsLoading) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Diagnostics</p>
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
              </div>
            </div>
            {diagnosticsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading diagnostics...
              </div>
            ) : diagnosticsError ? (
              <div className="text-destructive text-sm font-medium p-4">{diagnosticsError}</div>
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
                          : "border-primary/20 bg-primary/5 text-primary",
                    )}
                  >
                    <div className="mt-0.5">
                      <AlertCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{err.message}</p>
                      <div className="text-xs text-muted-foreground mt-1">
                        {err.file_column && (
                          <span>
                            File: <code>{err.file_column}</code>{" "}
                          </span>
                        )}
                        {err.db_column && (
                          <span>
                            DB: <code>{err.db_column}</code>{" "}
                          </span>
                        )}
                        {err.target_table && (
                          <span>
                            Table: <code>{err.target_table}</code>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Import Section */}
        <div className="pt-4 border-t border-border space-y-4">
          {importMessage && (
            <div
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-300",
                importStatus === "success"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20",
              )}
            >
              {importStatus === "success" ? <CheckCircle className="h-5 w-5 mt-0.5" /> : <AlertCircle className="h-5 w-5 mt-0.5" />}
              <div>
                <span className="font-semibold">{importMessage}</span>
                {importStatus === "success" && importDetails && (
                  <div className="flex gap-4 mt-2 text-sm">
                    <span className="text-primary">{importDetails.inserted} rows inserted</span>
                    {importDetails.skipped > 0 && (
                      <span className="text-chart-3">{importDetails.skipped} rows skipped</span>
                    )}
                  </div>
                )}
                {importStatus === "error" && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Check that the target table is correct and column mappings match the database schema. You can edit the mapping and try again.
                  </p>
                )}
              </div>
            </div>
          )}

          {importStatus !== "success" && !isAlreadyImported && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {isMappingFailed && !isEditing && (
                  <span className="text-destructive">Select a target table to enable import</span>
                )}
                {!isMappingFailed && activeMappings.length === 0 && (
                  <span className="text-chart-3">No columns mapped — import will have no data</span>
                )}
              </div>
              <Button
                color="primary"
                onPress={handleApprove}
                isDisabled={isImporting || (isMappingFailed && !isEditing)}
                className="font-semibold gap-2"
                startContent={!isImporting && <Check className="h-4 w-4" />}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  `Approve & Import (${activeMappings.length} columns)`
                )}
              </Button>
            </div>
          )}
        </div>
        </>
        ) : (
          <TableDataViewer tableName={mapping.target_table} />
        )}
      </CardBody>
    </Card>
  )
}

export default MappingResult
