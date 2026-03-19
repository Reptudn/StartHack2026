"use client"

import { useState, useCallback, useEffect } from "react"
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
  CardHeader
} from "@heroui/react"
import { 
  Activity, 
  LayoutDashboard, 
  Upload, 
  FileText, 
  FolderOpen,
  Clock
} from "lucide-react"
import { cn } from "@/lib/utils"
import { uploadFiles as apiUpload, getFiles, healthCheck } from '../api'
import type { ApiFile, MLMapping } from '../api'
import type { ProcessingStep } from './FileUpload'

interface UploadResult {
  file: ApiFile
  mapping?: MLMapping
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [results, setResults] = useState<UploadResult[]>([])
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [mappingFileId, setMappingFileId] = useState<string | null>(null)
  const [uploadStep, setUploadStep] = useState<ProcessingStep>(null)

  const loadFiles = useCallback(async () => {
    try {
      const apiFiles = await getFiles()
      const converted: UploadResult[] = apiFiles.map((f) => {
        let mapping: MLMapping | undefined
        if (f.mapping_result && f.mapping_result !== '{}') {
          try {
            mapping = typeof f.mapping_result === 'string' ? JSON.parse(f.mapping_result) : f.mapping_result
          } catch { /* ignore */ }
        }
        return { file: f, mapping }
      })
      setResults(converted)
    } catch (err) {
      console.error('Failed to load files:', err)
    }
  }, [])

  useEffect(() => {
    healthCheck().then((online) => {
      setIsBackendOnline(online)
      if (online) loadFiles()
    })
  }, [loadFiles])

  const handleFilesUploaded = useCallback(async (newFiles: File[]) => {
    if (!isBackendOnline) return
    setIsUploading(true)
    setUploadStep('extracting')
    
    // Simulate step progression during upload since backend processes synchronously
    // This gives visual feedback while the request is in flight
    const stepTimers: ReturnType<typeof setTimeout>[] = []
    stepTimers.push(setTimeout(() => setUploadStep('inspecting'), 800))
    stepTimers.push(setTimeout(() => setUploadStep('classifying'), 1600))
    stepTimers.push(setTimeout(() => setUploadStep('mapping'), 2400))
    
    try {
      const uploadResults = await apiUpload(newFiles, true)
      
      // Clear timers and set completed
      stepTimers.forEach(clearTimeout)
      setUploadStep('completed')
      
      const converted: UploadResult[] = uploadResults.map((r) => ({
        file: r.file,
        mapping: r.mapping,
      }))
      setResults((prev) => [...converted, ...prev])
      
      // Reset step after a short delay so user sees "completed"
      setTimeout(() => setUploadStep(null), 1500)
    } catch (err) {
      // Clear timers and set failed
      stepTimers.forEach(clearTimeout)
      setUploadStep('failed')
      console.error('Upload failed:', err)
      
      // Reset step after a delay
      setTimeout(() => setUploadStep(null), 2000)
    } finally {
      setIsUploading(false)
    }
  }, [isBackendOnline])

  const totalFiles = results.length
  const validFiles = results.filter((r) => r.file.status === "completed").length
  const errorFiles = results.reduce((acc, r) => acc + (r.file.status === 'failed' ? 1 : 0), 0)

  const navItems = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "upload", label: "Upload Data", icon: Upload },
    { key: "records", label: "Health Records", icon: FolderOpen },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground dark">
      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-card h-screen fixed top-0 left-0 z-20">
          {/* Logo */}
          <div className="p-6 border-b border-border">
            <div 
              className="flex items-center gap-3 cursor-pointer group" 
              onClick={() => navigate('/')}
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-all duration-200 group-hover:scale-105">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight group-hover:text-primary transition-colors">HealthMap</span>
                <p className="text-xs text-muted-foreground">Medical Data Platform</p>
              </div>
            </div>
          </div>
          
          {/* Navigation */}
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
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onPress={() => setActiveTab(item.key)}
                startContent={<item.icon className="h-4 w-4" />}
              >
                {item.label}
              </Button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-h-screen lg:ml-64">
          {/* Header */}
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
                  isBackendOnline ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                )}
                startContent={
                  <span className={cn(
                    "h-2 w-2 rounded-full animate-pulse",
                    isBackendOnline ? "bg-primary" : "bg-destructive"
                  )} />
                }
              >
                {isBackendOnline ? 'API Connected' : 'API Offline'}
              </Chip>
            </div>
          </header>

          {/* Mobile Navigation */}
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
                    activeTab === item.key && "bg-primary/10 text-primary font-semibold"
                  )}
                  onPress={() => setActiveTab(item.key)}
                  startContent={<item.icon className="h-4 w-4" />}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {activeTab === "overview" && (
              <div className="space-y-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
                <StatsCards
                  totalFiles={totalFiles}
                  validFiles={validFiles}
                  errorFiles={errorFiles}
                />

                {/* Recent Activity */}
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
                        <p className="text-sm text-muted-foreground mt-1">
                          Upload files to see them here
                        </p>
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
                              <p className="text-xs text-muted-foreground">
                                {r.file.row_count} rows processed
                              </p>
                            </div>
                            <Chip
                              variant="flat"
                              size="sm"
                              className={cn(
                                "font-medium",
                                r.file.status === "completed"
                                  ? "bg-primary/10 text-primary"
                                  : r.file.status === "failed"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-warning/10 text-warning"
                              )}
                            >
                              {r.file.status}
                            </Chip>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardBody>
                </Card>

                <DataQualityTable
                   files={results.map(r => ({
                     id: r.file.id.toString(),
                     name: r.file.filename,
                     size: r.file.file_size_bytes,
                     type: r.file.file_type,
                     status: r.file.status === 'completed' ? 'valid' : 'error',
                     errorCount: r.file.error_count ?? (r.file.status === 'failed' ? 1 : 0),
                     completeness: r.file.completeness ?? 100,
                     columnsMapped: r.file.columns_mapped ?? [], 
                     errors: []
                   }))}
                  onFixClick={(id) => setSelectedFileId(id)}
                  selectedFileId={selectedFileId}
                />

                {selectedFileId && results.find(r => r.file.id.toString() === selectedFileId) && (
                  <ErrorCorrectionPanel
                    file={{
                      id: selectedFileId,
                      name: results.find(r => r.file.id.toString() === selectedFileId)!.file.filename,
                      size: results.find(r => r.file.id.toString() === selectedFileId)!.file.file_size_bytes,
                      type: results.find(r => r.file.id.toString() === selectedFileId)!.file.file_type,
                      status: results.find(r => r.file.id.toString() === selectedFileId)!.file.status === 'completed' ? 'valid' : 'error',
                      errorCount: results.find(r => r.file.id.toString() === selectedFileId)!.file.error_count ?? 0,
                      completeness: results.find(r => r.file.id.toString() === selectedFileId)!.file.completeness ?? 100,
                      columnsMapped: results.find(r => r.file.id.toString() === selectedFileId)!.file.columns_mapped ?? [],
                      errors: []
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
                  files={results.map(r => ({ 
                    id: r.file.id.toString(), 
                    name: r.file.filename, 
                    size: r.file.file_size_bytes, 
                    type: r.file.file_type, 
                    status: r.file.status === 'completed' ? 'valid' : 'error', 
                    errorCount: r.file.error_count ?? 0, 
                    completeness: r.file.completeness ?? 100, 
                    columnsMapped: r.file.columns_mapped ?? [], 
                    errors: [] 
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
                   files={results.map(r => ({
                     id: r.file.id.toString(),
                     name: r.file.filename,
                     size: r.file.file_size_bytes,
                     type: r.file.file_type,
                     status: r.file.status === 'completed' ? 'valid' : 'error',
                     errorCount: r.file.error_count ?? (r.file.status === 'failed' ? 1 : 0),
                     completeness: r.file.completeness ?? 100,
                     columnsMapped: r.file.columns_mapped ?? [],
                     errors: []
                   }))}
                  onFixClick={(id) => setSelectedFileId(id)}
                  selectedFileId={selectedFileId}
                  onRowClick={(id) => setMappingFileId(id)}
                  activeRowId={mappingFileId}
                />

                {mappingFileId && results.find(r => r.file.id.toString() === mappingFileId)?.mapping && (
                  <MappingResult
                    mapping={results.find(r => r.file.id.toString() === mappingFileId)!.mapping!}
                    files={results.map(r => ({ id: r.file.id.toString(), name: r.file.filename }))}
                    selectedFileId={mappingFileId}
                    onFileSelect={(id) => setMappingFileId(id)}
                  />
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
