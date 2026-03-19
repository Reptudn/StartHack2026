"use client"

import { useState, useEffect } from "react"
import { 
  Card, 
  CardBody, 
  CardHeader, 
  Button, 
  Chip, 
  Progress,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Input,
  Spinner,
  Code
} from "@heroui/react"
import { AlertTriangle, CheckCircle, Info, XCircle, ChevronDown, BarChart3, Check, X, Edit2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { getFileValidation, resolveValidationError, type ValidationError, type ApiFile } from "../api"

interface FileValidationViewProps {
  fileId: number
}

export default function FileValidationView({ fileId }: FileValidationViewProps) {
  const [data, setData] = useState<{ file: ApiFile; errors: ValidationError[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [resolvingId, setResolvingId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [manualValue, setManualValue] = useState("")

  useEffect(() => {
    if (isExpanded && !data) {
      setLoading(true)
      getFileValidation(fileId)
        .then(setData)
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [fileId, isExpanded, data])

  const handleResolve = async (errorId: number, status: string, val?: string) => {
    setResolvingId(errorId)
    try {
      const updated = await resolveValidationError(errorId, status, val)
      setData(prev => {
        if (!prev) return null
        return {
          ...prev,
          errors: prev.errors.map(err => err.id === errorId ? updated : err)
        }
      })
      setEditingId(null)
      setManualValue("")
    } catch (err: any) {
      alert("Failed to resolve error: " + err.message)
    } finally {
      setResolvingId(null)
    }
  }

  if (!isExpanded) {
    return (
      <Button 
        variant="flat" 
        color="primary"
        onPress={() => setIsExpanded(true)}
        startContent={<BarChart3 className="h-4 w-4" />}
        endContent={<ChevronDown className="h-4 w-4" />}
        className="font-bold w-full sm:w-auto"
      >
        View Validation Details
      </Button>
    )
  }

  return (
    <Card className="border-none shadow-md bg-content1 mt-4 animate-in fade-in slide-in-from-top-4 duration-500">
      <CardHeader className="pb-4 border-b border-divider flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <p className="text-lg font-bold">Validation & Quality Report</p>
        </div>
        <Button 
          isIconOnly 
          variant="light" 
          size="sm" 
          onPress={() => setIsExpanded(false)}
        >
          <X className="h-5 w-5" />
        </Button>
      </CardHeader>

      <CardBody className="p-0 sm:p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 gap-4">
            <Spinner color="primary" size="lg" />
            <p className="text-default-500 font-medium">Crunching validation metadata...</p>
          </div>
        ) : error ? (
          <div className="p-8">
            <Card className="bg-danger/10 border-none">
              <CardBody className="flex flex-row items-center gap-3 text-danger font-bold">
                <AlertTriangle className="h-5 w-5" />
                {error}
              </CardBody>
            </Card>
          </div>
        ) : data ? (
          <div className="space-y-8 p-4 sm:p-0">
            {/* Quality Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-content2/50 border-none shadow-none">
                <CardBody className="p-6 flex flex-col items-center justify-center gap-4">
                   <div className="relative h-32 w-32 flex items-center justify-center">
                    <svg className="h-full w-full" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="45" fill="none" className="stroke-default-200" strokeWidth="8" />
                      <circle 
                        cx="50" 
                        cy="50" 
                        r="45" 
                        fill="none" 
                        className={cn("stroke-primary transition-all duration-1000", `stroke-${getScoreColor(data.file.quality_score ?? 0)}`)}
                        strokeWidth="8"
                        strokeDasharray={`${(data.file.quality_score ?? 0) * 2.827} 282.7`}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={cn("text-4xl font-bold", `text-${getScoreColor(data.file.quality_score ?? 0)}`)}>
                        {(data.file.quality_score ?? 0).toFixed(0)}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-default-400">Quality Score</span>
                    </div>
                  </div>
                  <Progress 
                    aria-label="Quality score small"
                    value={data.file.quality_score ?? 0} 
                    color={getScoreColor(data.file.quality_score ?? 0)}
                    size="sm"
                    className="max-w-xs mt-2"
                  />
                </CardBody>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <MetricCard label="Completeness" value={data.file.completeness ?? 0} />
                <MetricCard label="Accuracy" value={data.file.accuracy ?? 0} />
                <MetricCard label="Consistency" value={data.file.consistency ?? 0} />
                <MetricCard label="Timeliness" value={data.file.timeliness ?? 0} />
              </div>
            </div>

            {/* Errors Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-base font-bold">Variable Status & AI Corrections</p>
                {data.errors.length === 0 && (
                  <Chip color="success" variant="flat" startContent={<CheckCircle className="h-3 w-3" />}> Clean </Chip>
                )}
              </div>

              {data.errors.length === 0 ? (
                <div className="bg-success/5 border border-success/10 p-6 rounded-2xl flex items-center justify-center gap-3 text-success">
                  <CheckCircle className="h-6 w-6" />
                  <p className="font-bold">Perfect structural & semantic integrity maintained.</p>
                </div>
              ) : (
                <Table 
                  aria-label="Validation Errors"
                  shadow="none"
                  className="border border-divider rounded-2xl"
                  removeWrapper
                >
                  <TableHeader>
                    <TableColumn className="bg-content2/50 font-bold text-xs">Row</TableColumn>
                    <TableColumn className="bg-content2/50 font-bold text-xs uppercase">Variable</TableColumn>
                    <TableColumn className="bg-content2/50 font-bold text-xs uppercase">Issue Identified</TableColumn>
                    <TableColumn className="bg-content2/50 font-bold text-xs uppercase">Original</TableColumn>
                    <TableColumn className="bg-content2/50 font-bold text-xs uppercase">AI Suggestion</TableColumn>
                    <TableColumn className="bg-content2/50 font-bold text-xs uppercase text-right">Actions</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {data.errors.map((err) => (
                      <TableRow key={err.id} className="border-b border-divider last:border-none">
                        <TableCell><span className="text-default-400 font-mono">#{err.row_number}</span></TableCell>
                        <TableCell><span className="font-bold text-sm">{err.column_name}</span></TableCell>
                        <TableCell>
                          <Chip 
                            color={getSeverityColor(err.severity)} 
                            variant="flat" 
                            size="sm" 
                            className="font-bold text-[10px] h-6"
                            startContent={getSeverityIcon(err.severity)}
                          >
                            {err.error_type}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          <Code color="default" className="text-xs font-mono">{err.original_value || "NULL"}</Code>
                        </TableCell>
                        <TableCell>
                          {editingId === err.id ? (
                            <div className="flex items-center gap-1">
                              <Input 
                                size="sm"
                                variant="bordered"
                                className="w-24"
                                value={manualValue}
                                onChange={(e) => setManualValue(e.target.value)}
                                autoFocus
                              />
                              <Button isIconOnly size="sm" color="success" variant="flat" onPress={() => handleResolve(err.id, "accepted", manualValue)}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button isIconOnly size="sm" color="danger" variant="flat" onPress={() => setEditingId(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Code color="success" className="text-xs font-mono font-bold">
                              {err.manual_value || err.suggested_value || "-"}
                            </Code>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {err.resolved !== "pending" ? (
                            <Chip 
                              color={err.resolved === "accepted" ? "success" : "default"} 
                              variant="flat" 
                              size="sm" 
                              className="font-bold"
                            >
                              {err.resolved === "accepted" ? "Fixed" : "Ignored"}
                            </Chip>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button 
                                isIconOnly 
                                size="sm" 
                                color="success" 
                                variant="flat" 
                                onPress={() => handleResolve(err.id, "accepted", err.suggested_value)}
                                isDisabled={resolvingId === err.id}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button 
                                isIconOnly 
                                size="sm" 
                                color="primary" 
                                variant="flat" 
                                onPress={() => {
                                  setEditingId(err.id)
                                  setManualValue(err.suggested_value || err.original_value || "")
                                }}
                                isDisabled={resolvingId === err.id}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button 
                                isIconOnly 
                                size="sm" 
                                color="danger" 
                                variant="flat" 
                                onPress={() => handleResolve(err.id, "rejected")}
                                isDisabled={resolvingId === err.id}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "success" : value >= 50 ? "warning" : "danger"
  
  return (
    <Card className="bg-content2/50 border-none shadow-none">
      <CardBody className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-default-500">{label}</span>
          <span className={cn("text-sm font-bold", `text-${color}`)}>{value.toFixed(0)}%</span>
        </div>
        <Progress 
          aria-label={label}
          value={value} 
          color={color}
          size="sm"
          className="w-full"
        />
      </CardBody>
    </Card>
  )
}

function getScoreColor(score: number) {
  if (score >= 80) return "success"
  if (score >= 50) return "warning"
  return "danger"
}

function getSeverityColor(severity: string): "danger" | "warning" | "primary" | "default" {
  switch (severity) {
    case "error": return "danger"
    case "warning": return "warning"
    case "info": return "primary"
    default: return "default"
  }
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case "error": return <XCircle className="h-3 w-3" />
    case "warning": return <AlertTriangle className="h-3 w-3" />
    case "info": return <Info className="h-3 w-3" />
    default: return null
  }
}
