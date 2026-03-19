"use client"

import { useRef, useState, useCallback } from "react"
import { Card, CardBody, CardHeader, Chip } from "@heroui/react"
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, Loader2, FileSearch, Tags, ArrowRightLeft } from "lucide-react"
import { cn } from "@/lib/utils"

export type ProcessingStep = 'extracting' | 'inspecting' | 'classifying' | 'mapping' | 'completed' | 'failed' | null

export interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  status: "processing" | "valid" | "error" | "warning"
  errorCount: number
  completeness: number
  columnsMapped: string[]
  errors: FileError[]
}

export interface FileError {
  id: string
  column: string
  row: number
  originalValue: string
  suggestedValue: string
  resolved: "pending" | "accepted" | "rejected"
}

interface FileUploadProps {
  files: UploadedFile[]
  onFilesUploaded: (files: File[]) => void
  isUploading?: boolean
  uploadStep?: ProcessingStep
}

const STEPS: { key: ProcessingStep; label: string; icon: React.ElementType }[] = [
  { key: 'extracting', label: 'Extract', icon: Upload },
  { key: 'inspecting', label: 'Inspect', icon: FileSearch },
  { key: 'classifying', label: 'Classify', icon: Tags },
  { key: 'mapping', label: 'Map', icon: ArrowRightLeft },
]

function getStepIndex(step: ProcessingStep): number {
  if (!step || step === 'failed') return -1
  if (step === 'completed') return STEPS.length
  return STEPS.findIndex(s => s.key === step)
}

function ProcessingSteps({ currentStep }: { currentStep: ProcessingStep }) {
  const currentIndex = getStepIndex(currentStep)
  const progress = currentStep === 'completed' ? 100 : currentStep === 'failed' ? 0 : ((currentIndex + 1) / STEPS.length) * 100

  return (
    <div className="w-full space-y-4">
      {/* Step dots with labels */}
      <div className="flex items-center justify-between relative">
        {/* Connection line behind dots */}
        <div className="absolute top-3 left-6 right-6 h-0.5 bg-muted" />
        <div 
          className="absolute top-3 left-6 h-0.5 bg-primary transition-all duration-500 ease-out"
          style={{ width: `calc(${Math.max(0, (currentIndex / (STEPS.length - 1)) * 100)}% - 48px)` }}
        />
        
        {STEPS.map((step, index) => {
          const isCompleted = currentIndex > index || currentStep === 'completed'
          const isCurrent = currentIndex === index
          const isPending = currentIndex < index && currentStep !== 'completed'
          const Icon = step.icon

          return (
            <div key={step.key} className="flex flex-col items-center gap-2 z-10">
              <div
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center transition-all duration-300",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground animate-pulse ring-4 ring-primary/30",
                  isPending && "bg-muted text-muted-foreground",
                  currentStep === 'failed' && isCurrent && "bg-destructive text-destructive-foreground"
                )}
              >
                {isCompleted ? (
                  <CheckCircle className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  isCompleted && "text-primary",
                  isCurrent && "text-primary font-semibold",
                  isPending && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            currentStep === 'failed' ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / 1048576).toFixed(1) + " MB"
}

function getStatusIcon(status: UploadedFile["status"]) {
  switch (status) {
    case "valid":
      return <CheckCircle className="h-4 w-4 text-primary" />
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-chart-3" />
    case "processing":
      return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
  }
}

function getStatusChip(status: UploadedFile["status"], errorCount: number) {
  switch (status) {
    case "valid":
      return <Chip variant="flat" size="sm" className="bg-primary/10 text-primary font-medium">Valid</Chip>
    case "error":
      return <Chip variant="flat" size="sm" className="bg-destructive/10 text-destructive font-medium">
        {errorCount} Error{errorCount !== 1 ? "s" : ""}
      </Chip>
    case "warning":
      return <Chip variant="flat" size="sm" className="bg-chart-3/10 text-chart-3 font-medium">Warning</Chip>
    case "processing":
      return <Chip variant="flat" size="sm" className="bg-muted text-muted-foreground font-medium">Processing...</Chip>
  }
}

export function FileUpload({ files, onFilesUploaded, isUploading = false, uploadStep = null }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length > 0) {
        onFilesUploaded(droppedFiles)
      }
    },
    [onFilesUploaded]
  )

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length > 0) {
      onFilesUploaded(selectedFiles)
    }
    e.target.value = ""
  }

  return (
    <div className="space-y-6">
      <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <CardHeader className="pb-4 border-b border-border">
          <p className="text-lg font-semibold">Upload Medical Data</p>
        </CardHeader>
        <CardBody>
          <div
            className={cn(
              "relative border-2 border-dashed rounded-xl p-10 transition-all duration-200 cursor-pointer group",
              "hover:border-primary/50 hover:bg-primary/5",
              isDragOver && "border-primary bg-primary/10 scale-[0.99]",
              isUploading && "pointer-events-none opacity-60"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            role="button"
            tabIndex={0}
            aria-label="Upload files by dropping or clicking"
          >
            <div className="flex flex-col items-center gap-4 text-center">
              {isUploading ? (
                <>
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                  <div className="w-full max-w-md">
                    <p className="font-semibold text-lg mb-1">Processing files...</p>
                    <p className="text-sm text-muted-foreground mb-6">
                      Analyzing and mapping your data with AI
                    </p>
                    <ProcessingSteps currentStep={uploadStep} />
                  </div>
                </>
              ) : (
                <>
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 group-hover:scale-110 transition-all duration-200">
                    <Upload className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">
                      Drop your files here or{" "}
                      <span className="text-primary font-bold">browse</span>
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Supports CSV, XLSX, PDF, TXT
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    {["CSV", "XLSX", "PDF", "TXT"].map((format) => (
                      <Chip 
                        key={format} 
                        variant="flat" 
                        size="sm" 
                        className="bg-muted/50 text-muted-foreground font-medium text-xs"
                      >
                        {format}
                      </Chip>
                    ))}
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".csv,.xlsx,.xls,.pdf,.txt"
              onChange={handleFileInput}
            />
          </div>
        </CardBody>
      </Card>

      {files.length > 0 && (
        <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center justify-between w-full">
              <p className="text-lg font-semibold">
                Uploaded Files
              </p>
              <Chip variant="flat" className="bg-primary/10 text-primary font-semibold">
                {files.length} file{files.length !== 1 ? "s" : ""}
              </Chip>
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-4 p-4 rounded-xl bg-muted/30 border border-transparent hover:border-border hover:bg-muted/50 transition-all duration-200 cursor-pointer"
                >
                  <div className="h-11 w-11 rounded-xl bg-card border border-border flex items-center justify-center">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(file.status)}
                    {getStatusChip(file.status, file.errorCount)}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
