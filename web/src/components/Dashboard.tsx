"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { StatsCards } from "./StatsCards"
import { FileUpload } from "./FileUpload"
import { DataQualityTable } from "./DataQualityTable"
import { ErrorCorrectionPanel } from "./ErrorCorrectionPanel"
import { MappingResult } from "./MappingResult"
import {
  Button,
  Chip,
  Card,
  CardBody,
  CardHeader,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
} from "@heroui/react"
import {
  Activity,
  LayoutDashboard,
  Upload,
  FileText,
  FolderOpen,
  Clock,
  RefreshCw,
  AlertCircle,
  Brain,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  uploadFiles as apiUpload,
  getFiles,
  healthCheck,
  subscribeToProgress,
  getJobProgress,
  reprocessFile,
} from "../api"
import type { ApiFile, MLMapping, JobProgress } from "../api"
import type { ProcessingStep } from "./FileUpload"

interface UploadResult {
  file: ApiFile
  mapping?: MLMapping
}

interface FileProgressMap {
  [fileId: number]: JobProgress
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [results, setResults] = useState<UploadResult[]>([])
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [importingFileId, setImportingFileId] = useState<string | null>(null)
  const [uploadStep, setUploadStep] = useState<ProcessingStep>(null)
  const [fileProgress, setFileProgress] = useState<FileProgressMap>({})
  const [reprocessing, setReprocessing] = useState<Set<number>>(new Set())

  const activeSubscriptions = useRef<Map<number, () => void>>(new Map())

  const startPollingFile = useCallback((fileId: number, jobId: string) => {
    if (activeSubscriptions.current.has(fileId)) return

    getJobProgress(jobId).then((p) => {
      if (p && (p.stage === "done" || p.stage === "error")) {
        setFileProgress((prev) => ({ ...prev, [fileId]: p }))
        return
      }

      if (p) {
        setFileProgress((prev) => ({ ...prev, [fileId]: p }))
      }

      const unsub = subscribeToProgress(
        jobId,
        (progress) => {
          setFileProgress((prev) => ({ ...prev, [fileId]: progress }))
          // loadFiles() wird hier NICHT aufgerufen, um Race Conditions zu vermeiden
        },
        () => {
          // SSE-Verbindung geschlossen - nur aufräumen, kein loadFiles()
          // Das verhindert Duplikate bei Page Reload
          activeSubscriptions.current.delete(fileId)
        },
      )
      activeSubscriptions.current.set(fileId, unsub)
    })
  }, [])

  const loadFiles = useCallback(async () => {
    try {
      const apiFiles = await getFiles()
      const converted: UploadResult[] = apiFiles.map((f) => {
        let mapping: MLMapping | undefined
        if (f.mapping_result && f.mapping_result !== "{}") {
          try {
            mapping = typeof f.mapping_result === "string" ? JSON.parse(f.mapping_result) : f.mapping_result
          } catch {
            // ignore
          }
        }
        return { file: f, mapping }
      })
      // Dedupe by filename (API is source of truth, newest files first)
      setResults((prev) => {
        const fileMap = new Map<string, UploadResult>()
        // First add all API files (newest first due to API ordering)
        converted.forEach((r) => fileMap.set(r.file.filename, r))
        // Then filter out duplicates from prev that are still in API
        const prevFiltered = prev.filter((r) => {
          // Keep prev file if it's not in the API response
          const existsInApi = apiFiles.some((f) => f.filename === r.file.filename)
          return !existsInApi
        })
        // Merge: API files override local state
        const merged = [...Array.from(fileMap.values()), ...prevFiltered]
        return merged
      })

      for (const f of apiFiles) {
        if (f.status === "processing" && f.job_id) {
          startPollingFile(f.id, f.job_id)
        }
      }
    } catch (err) {
      console.error("Failed to load files:", err)
    }
  }, [startPollingFile])

  useEffect(() => {
    return () => {
      activeSubscriptions.current.forEach((unsub) => unsub())
      activeSubscriptions.current.clear()
    }
  }, [])

  useEffect(() => {
    healthCheck().then((online) => {
      setIsBackendOnline(online)
      if (online) loadFiles()
    })
  }, [loadFiles])

  const handleRetry = async (fileId: number) => {
    setReprocessing((prev) => new Set(prev).add(fileId))
    try {
      const res = await reprocessFile(fileId)
      startPollingFile(fileId, res.job_id)
      setResults((prev) =>
        prev.map((r) =>
          r.file.id === fileId
            ? { ...r, file: { ...r.file, status: "processing" }, mapping: undefined }
            : r,
        ),
      )
    } catch (err) {
      console.error("Retry failed:", err)
    } finally {
      setReprocessing((prev) => {
        const next = new Set(prev)
        next.delete(fileId)
        return next
      })
    }
  }

  const handleImportSuccess = useCallback(() => {
    setImportingFileId(null)
    loadFiles()
  }, [loadFiles])

  const handleOpenMappingModal = useCallback((fileId: string) => {
    setImportingFileId(fileId)
  }, [])

  const handleFilesUploaded = useCallback(
    async (newFiles: File[]) => {
      if (!isBackendOnline) return
      setIsUploading(true)
      setUploadStep("extracting")

      try {
        const uploadResults = await apiUpload(newFiles, true)

        const converted: UploadResult[] = uploadResults.map((r) => ({
          file: r.file,
          mapping: r.mapping,
        }))
        setResults((prev) => {
          const existingFiles = new Set(prev.map((r) => r.file.filename))
          const unique = converted.filter((r) => !existingFiles.has(r.file.filename))
          // New files go to the front, API order preserved
          return [...unique, ...prev]
        })

        // Track first file's progress for upload step indicator
        const firstResult = uploadResults[0]
        if (firstResult?.job_id) {
          const unsub = subscribeToProgress(
            firstResult.job_id,
            (progress) => {
              // Map SSE stage to upload step
              const stageMap: Record<string, ProcessingStep> = {
                extract: "extracting",
                inspect: "inspecting",
                classify: "classifying",
                map: "mapping",
                done: "completed",
                error: "failed",
              }
              const mappedStep = stageMap[progress.stage] || "extracting"
              setUploadStep(mappedStep)

              if (progress.stage === "done") {
                setTimeout(() => {
                  setUploadStep(null)
                  setIsUploading(false)
                }, 1500)
                unsub()
              } else if (progress.stage === "error") {
                setTimeout(() => {
                  setUploadStep(null)
                  setIsUploading(false)
                }, 2000)
                unsub()
              }
            },
            () => {
              // SSE closed - ensure we're in completed state
              setUploadStep("completed")
              setTimeout(() => {
                setUploadStep(null)
                setIsUploading(false)
              }, 1500)
            },
          )
        } else {
          // No job_id - immediate completion
          setUploadStep("completed")
          setTimeout(() => setUploadStep(null), 1500)
          setIsUploading(false)
        }

        // Start polling for all files
        for (const result of uploadResults) {
          if (result.job_id) {
            startPollingFile(result.file.id, result.job_id)
          }
        }
      } catch (err) {
        setUploadStep("failed")
        console.error("Upload failed:", err)
        setTimeout(() => setUploadStep(null), 2000)
        setIsUploading(false)
      }
    },
    [isBackendOnline, startPollingFile],
  )

  const totalFiles = results.length
  const validFiles = results.filter(
    (r) => r.file.status === "completed" || r.file.status === "mapped" || r.file.status === "imported",
  ).length
  const errorFiles = results.reduce(
    (acc, r) => acc + (r.file.status === "failed" || r.file.status === "error" ? 1 : 0),
    0,
  )

  const navItems = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "upload", label: "Upload Data", icon: Upload },
    { key: "records", label: "Health Records", icon: FolderOpen },
  ]

  const getStatusChip = (status: string, fileId?: number) => {
    const statusMap: Record<string, { className: string; label: string }> = {
      completed: { className: "bg-primary/10 text-primary", label: "Completed" },
      mapped: { className: "bg-primary/10 text-primary", label: "Mapped" },
      imported: { className: "bg-primary/10 text-primary", label: "Imported" },
      processing: { className: "bg-warning/10 text-warning", label: "Processing" },
      review: { className: "bg-chart-3/10 text-chart-3", label: "Review" },
      failed: { className: "bg-destructive/10 text-destructive", label: "Failed" },
      error: { className: "bg-destructive/10 text-destructive", label: "Error" },
    }
    const s = statusMap[status] || { className: "bg-muted text-muted-foreground", label: status }

    const progress = fileId ? fileProgress[fileId] : undefined
    const label = progress && status === "processing"
      ? `${progress.stage.charAt(0).toUpperCase() + progress.stage.slice(1)}...`
      : s.label

    return (
      <Chip variant="flat" size="sm" className={cn("font-medium", s.className)}>
        {label}
      </Chip>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground dark">
      <div className="flex">
        <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-card h-screen fixed top-0 left-0 z-20">
          <div className="p-6 border-b border-border">
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => navigate("/")}
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-all duration-200 group-hover:scale-105">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight group-hover:text-primary transition-colors">
                  HealthMap
                </span>
                <p className="text-xs text-muted-foreground">Medical Data Platform</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1">
            {navItems.map((item) => (
              <Button
                key={item.key}
                variant={activeTab === item.key ? "flat" : "light"}
                color={activeTab === item.key ? "primary" : "default"}
                className={cn(
                  "w-full justify-start gap-3 h-11 font-medium transition-all duration-200",
                  activeTab === item.key
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
                onPress={() => setActiveTab(item.key)}
                startContent={<item.icon className="h-4 w-4" />}
              >
                {item.label}
              </Button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-h-screen lg:ml-64">
          <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
            <div className="flex items-center justify-between px-6 py-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Health Data Dashboard</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Manage and analyze your clinical data imports
                </p>
              </div>
              <Chip
                variant="flat"
                color={isBackendOnline ? "success" : "danger"}
                className={cn(
                  "gap-2 font-medium",
                  isBackendOnline ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
                )}
                startContent={
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full animate-pulse",
                      isBackendOnline ? "bg-primary" : "bg-destructive",
                    )}
                  />
                }
              >
                {isBackendOnline ? "API Connected" : "API Offline"}
              </Chip>
            </div>
          </header>

          <div className="lg:hidden px-6 py-3 border-b border-border bg-card/50">
            <div className="flex gap-2 overflow-x-auto">
              {navItems.map((item) => (
                <Button
                  key={item.key}
                  variant={activeTab === item.key ? "flat" : "light"}
                  color={activeTab === item.key ? "primary" : "default"}
                  size="sm"
                  className={cn(
                    "gap-2 shrink-0",
                    activeTab === item.key && "bg-primary/10 text-primary font-semibold",
                  )}
                  onPress={() => setActiveTab(item.key)}
                  startContent={<item.icon className="h-4 w-4" />}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="p-6 space-y-6">
            {activeTab === "overview" && (
              <div className="space-y-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
                <StatsCards totalFiles={totalFiles} validFiles={validFiles} errorFiles={errorFiles} />

                <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                  <CardHeader className="flex justify-between items-center pb-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Clock className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-lg font-semibold">Recent Uploads</p>
                    </div>
                    <Button
                      variant="light"
                      color="primary"
                      size="sm"
                      onPress={() => setActiveTab("records")}
                      className="font-medium"
                    >
                      View All
                    </Button>
                  </CardHeader>
                  <CardBody className="pt-4">
                    {results.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                          <FileText className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <p className="font-semibold text-muted-foreground">No files uploaded yet</p>
                        <p className="text-sm text-muted-foreground mt-1">Upload files to see them here</p>
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {results.slice(0, 4).map((r) => (
                          <div
                            key={r.file.id}
                            className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-all duration-200 cursor-pointer border border-transparent hover:border-border"
                          >
                            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
                              <FileText className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{r.file.filename}</p>
                              <p className="text-xs text-muted-foreground">{r.file.row_count} rows processed</p>
                            </div>
                            {getStatusChip(r.file.status, r.file.id)}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardBody>
                </Card>

                <DataQualityTable
                  files={results.map((r) => ({
                    id: r.file.id.toString(),
                    name: r.file.filename,
                    size: r.file.file_size_bytes,
                    type: r.file.file_type,
                    status:
                      r.file.status === "completed" || r.file.status === "mapped" || r.file.status === "imported"
                        ? "valid"
                        : "error",
                    errorCount: r.file.status === "failed" || r.file.status === "error" ? 1 : 0,
                    completeness: 100,
                    columnsMapped: [],
                    errors: [],
                  }))}
                  onFixClick={(id) => setSelectedFileId(id)}
                  selectedFileId={selectedFileId}
                />

                {selectedFileId && results.find((r) => r.file.id.toString() === selectedFileId) && (
                  <ErrorCorrectionPanel
                    file={{
                      id: selectedFileId,
                      name: results.find((r) => r.file.id.toString() === selectedFileId)!.file.filename,
                      size: results.find((r) => r.file.id.toString() === selectedFileId)!.file.file_size_bytes,
                      type: results.find((r) => r.file.id.toString() === selectedFileId)!.file.file_type,
                      status:
                        results.find((r) => r.file.id.toString() === selectedFileId)!.file.status === "completed"
                          ? "valid"
                          : "error",
                      errorCount: 0,
                      completeness: 100,
                      columnsMapped: [],
                      errors: [],
                    }}
                    onClose={() => setSelectedFileId(null)}
                    onResolve={() => {}}
                  />
                )}
              </div>
            )}

            {activeTab === "upload" && (
              <div className="max-w-2xl mx-auto animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
                <FileUpload
                  files={results.map((r) => ({
                    id: r.file.id.toString(),
                    name: r.file.filename,
                    size: r.file.file_size_bytes,
                    type: r.file.file_type,
                    status: r.file.status === "completed" ? "valid" : r.file.status === "processing" ? "processing" : "error",
                    errorCount: 0,
                    completeness: 100,
                    columnsMapped: [],
                    errors: [],
                  }))}
                  onFilesUploaded={handleFilesUploaded}
                  isUploading={isUploading}
                  uploadStep={uploadStep}
                />
              </div>
            )}

            {activeTab === "records" && (
              <div className="space-y-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
                <DataQualityTable
                  files={results.map((r) => ({
                    id: r.file.id.toString(),
                    name: r.file.filename,
                    size: r.file.file_size_bytes,
                    type: r.file.file_type,
                    status:
                      r.file.status === "completed" || r.file.status === "mapped" || r.file.status === "imported"
                        ? "valid"
                        : r.file.status === "processing"
                          ? "processing"
                          : "error",
                    errorCount: r.file.status === "failed" || r.file.status === "error" ? 1 : 0,
                    completeness: 100,
                    columnsMapped: r.mapping ? r.mapping.column_mappings.slice(0, 3).map(cm => cm.db_column) : [],
                    errors: [],
                  }))}
                  onFixClick={(id) => setSelectedFileId(id)}
                  selectedFileId={selectedFileId}
                  onRowClick={handleOpenMappingModal}
                  activeRowId={importingFileId}
                />

                {results.filter((r) => r.file.status === "error" || r.file.status === "failed").length > 0 && (
                  <Card className="border border-destructive/20 bg-destructive/5 rounded-2xl">
                    <CardBody className="p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold text-destructive">Some files failed to process</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Click the retry button to reprocess failed files.
                          </p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            {results
                              .filter((r) => r.file.status === "error" || r.file.status === "failed")
                              .map((r) => (
                                <Button
                                  key={r.file.id}
                                  variant="bordered"
                                  size="sm"
                                  className="gap-2"
                                  isDisabled={reprocessing.has(r.file.id)}
                                  onPress={() => handleRetry(r.file.id)}
                                  startContent={
                                    <RefreshCw
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        reprocessing.has(r.file.id) && "animate-spin",
                                      )}
                                    />
                                  }
                                >
                                  {reprocessing.has(r.file.id) ? "Retrying..." : `Retry ${r.file.filename}`}
                                </Button>
                              ))}
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                )}

              </div>
            )}
          </div>

          {/* Mapping Editor Modal */}
          <Modal
            isOpen={importingFileId !== null}
            onClose={() => setImportingFileId(null)}
            size="5xl"
            scrollBehavior="inside"
            backdrop="blur"
            classNames={{
              base: "bg-card border border-border max-h-[90vh]",
              header: "border-b border-border",
              body: "p-4",
              closeButton: "text-foreground hover:bg-muted",
            }}
          >
            <ModalContent>
              {() => (
                <>
                  <ModalHeader className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Brain className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-lg font-bold">
                        Review Mapping: {importingFileId ? results.find((r) => r.file.id.toString() === importingFileId)?.file.filename : ""}
                      </p>
                      <p className="text-sm text-muted-foreground font-normal">
                        Edit column mappings and approve to import data
                      </p>
                    </div>
                  </ModalHeader>
                  <ModalBody>
                    {importingFileId && results.find((r) => r.file.id.toString() === importingFileId)?.mapping && (
                      <MappingResult
                        mapping={results.find((r) => r.file.id.toString() === importingFileId)!.mapping!}
                        files={results.map((r) => ({ id: r.file.id.toString(), name: r.file.filename }))}
                        selectedFileId={importingFileId}
                        onFileSelect={handleOpenMappingModal}
                        onImportSuccess={handleImportSuccess}
                      />
                    )}
                  </ModalBody>
                </>
              )}
            </ModalContent>
          </Modal>
        </main>
      </div>
    </div>
  )
}
