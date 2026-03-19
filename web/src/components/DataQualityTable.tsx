"use client"

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
} from "@heroui/react"
import { Wrench, ChevronDown, ChevronUp, BarChart3, FileText } from "lucide-react"
import type { UploadedFile } from "./FileUpload"
import { cn } from "@/lib/utils"

interface DataQualityTableProps {
  files: UploadedFile[]
  onFixClick: (fileId: string) => void
  selectedFileId: string | null
  onRowClick?: (fileId: string) => void
  activeRowId?: string | null
}

function getCompletenessClass(value: number) {
  if (value >= 80) return "text-primary"
  if (value >= 50) return "text-chart-3"
  return "text-destructive"
}

function getCompletenessBarClass(value: number) {
  if (value >= 80) return "bg-primary"
  if (value >= 50) return "bg-chart-3"
  return "bg-destructive"
}

export function DataQualityTable({ files, onFixClick, selectedFileId, onRowClick, activeRowId }: DataQualityTableProps) {
  if (files.length === 0) {
    return (
      <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <p className="text-lg font-semibold">Data Quality Analysis</p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-6">
              <FileText className="h-10 w-10 text-muted-foreground" />
            </div>
            <p className="font-semibold text-lg">No files uploaded yet</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs">
              Upload files to see data quality analysis and AI-powered insights
            </p>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <p className="text-lg font-semibold">Data Quality Analysis</p>
          </div>
          <Chip variant="flat" className="bg-primary/10 text-primary font-semibold">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </Chip>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <Table 
            aria-label="Data Quality Analysis Table"
            shadow="none"
            removeWrapper
            classNames={{
              th: "bg-muted/30 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-4 first:rounded-tl-none last:rounded-tr-none",
              td: "py-4"
            }}
          >
            <TableHeader>
              <TableColumn>File Name</TableColumn>
              <TableColumn>Columns Mapped</TableColumn>
              <TableColumn>Data Completeness</TableColumn>
              <TableColumn className="text-center">Anomalies</TableColumn>
              <TableColumn className="text-right">Action</TableColumn>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow 
                  key={file.id}
                  onClick={() => onRowClick?.(file.id)}
                  className={cn(
                    "transition-all duration-200 cursor-pointer border-b border-border last:border-none",
                    "hover:bg-muted/30",
                    selectedFileId === file.id && "bg-primary/5",
                    activeRowId === file.id && "bg-primary/10 border-l-3 border-l-primary"
                  )}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <span className="font-semibold text-sm truncate max-w-[200px]">{file.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5 max-w-[220px]">
                      {file.columnsMapped.slice(0, 3).map((col: string) => (
                        <Chip 
                          key={col} 
                          variant="flat" 
                          size="sm" 
                          className="text-xs font-medium bg-muted/50 text-foreground h-6"
                        >
                          {col}
                        </Chip>
                      ))}
                      {file.columnsMapped.length > 3 && (
                        <Chip 
                          variant="flat" 
                          size="sm" 
                          className="text-xs font-medium bg-primary/10 text-primary h-6"
                        >
                          +{file.columnsMapped.length - 3}
                        </Chip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 min-w-[180px]">
                      <div className="flex-1">
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full transition-all duration-500", getCompletenessBarClass(file.completeness))}
                            style={{ width: `${file.completeness}%` }}
                          />
                        </div>
                      </div>
                      <span className={cn("text-sm font-bold tabular-nums w-12", getCompletenessClass(file.completeness))}>
                        {file.completeness}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Chip 
                      variant="flat"
                      size="sm"
                      className={cn(
                        "font-semibold",
                        file.errorCount > 0 
                          ? "bg-destructive/10 text-destructive" 
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {file.errorCount}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={file.errorCount > 0 ? "solid" : "bordered"}
                      color={file.errorCount > 0 ? "primary" : "default"}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFixClick(file.id);
                      }}
                      disabled={file.errorCount === 0}
                      className={cn(
                        "font-semibold gap-2",
                        file.errorCount === 0 && "opacity-50",
                        file.errorCount > 0 && selectedFileId !== file.id && "shadow-md hover:shadow-lg"
                      )}
                      startContent={<Wrench className="h-3.5 w-3.5" />}
                      endContent={selectedFileId === file.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    >
                      {selectedFileId === file.id ? "Close" : "Fix"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardBody>
    </Card>
  )
}
