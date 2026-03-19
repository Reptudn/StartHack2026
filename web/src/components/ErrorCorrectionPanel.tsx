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
  TableCell
} from "@heroui/react"
import { X, Check, AlertTriangle, CheckCircle } from "lucide-react"
import type { UploadedFile, FileError } from "./FileUpload"
import { cn } from "@/lib/utils"

interface ErrorCorrectionPanelProps {
  file: UploadedFile
  onClose: () => void
  onResolve: (fileId: string, errorId: string, action: "accepted" | "rejected") => void
}

export function ErrorCorrectionPanel({ file, onClose, onResolve }: ErrorCorrectionPanelProps) {
  const pendingErrors = file.errors.filter((e: FileError) => e.resolved === "pending")
  const resolvedErrors = file.errors.filter((e: FileError) => e.resolved !== "pending")

  return (
    <Card className="border border-primary/20 bg-card shadow-md ring-1 ring-primary/10 rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="pb-4 border-b border-border">
        <div className="flex items-center justify-between w-full">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-lg font-bold">Error Correction</p>
                <p className="text-sm text-muted-foreground">{file.name}</p>
              </div>
            </div>
          </div>
          <Button isIconOnly variant="light" size="sm" onPress={onClose} className="hover:bg-muted">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {file.errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <CheckCircle className="h-10 w-10 text-primary" />
            </div>
            <p className="font-bold text-xl">No errors found</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs">
              This file passed all validation checks and is ready for mapping
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Chip 
                variant="flat" 
                size="sm" 
                className="bg-destructive/10 text-destructive font-semibold"
              >
                {pendingErrors.length} Pending
              </Chip>
              <Chip 
                variant="flat" 
                size="sm" 
                className="bg-primary/10 text-primary font-semibold"
              >
                {resolvedErrors.length} Resolved
              </Chip>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table 
                aria-label="Error Correction Table"
                shadow="none"
                removeWrapper
                classNames={{
                  th: "bg-muted/30 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-4",
                  td: "py-4"
                }}
              >
                <TableHeader>
                  <TableColumn className="w-20">Row</TableColumn>
                  <TableColumn>Column</TableColumn>
                  <TableColumn>Original Value</TableColumn>
                  <TableColumn>Suggested Fix</TableColumn>
                  <TableColumn className="text-right">Action</TableColumn>
                </TableHeader>
                <TableBody>
                  {[...pendingErrors, ...resolvedErrors].map((error) => (
                    <TableRow
                      key={error.id}
                      className={cn(
                        "transition-all duration-200 border-b border-border last:border-none",
                        error.resolved !== "pending" && "opacity-50"
                      )}
                    >
                      <TableCell>
                        <Chip 
                          variant="flat" 
                          size="sm" 
                          className="font-mono font-semibold bg-muted/50"
                        >
                          #{error.row}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-sm">{error.column}</span>
                      </TableCell>
                      <TableCell>
                        <code className="px-2.5 py-1.5 rounded-lg bg-destructive/10 text-destructive text-sm font-mono font-medium">
                          {error.originalValue}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-mono font-medium">
                          {error.suggestedValue}
                        </code>
                      </TableCell>
                      <TableCell className="text-right">
                        {error.resolved === "pending" ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              color="primary"
                              variant="flat"
                              size="sm"
                              className="font-semibold h-8 bg-primary/10 text-primary hover:bg-primary/20"
                              onPress={() => onResolve(file.id, error.id, "accepted")}
                              startContent={<Check className="h-3.5 w-3.5" />}
                            >
                              Accept
                            </Button>
                            <Button
                              color="danger"
                              variant="flat"
                              size="sm"
                              className="font-semibold h-8 bg-destructive/10 text-destructive hover:bg-destructive/20"
                              onPress={() => onResolve(file.id, error.id, "rejected")}
                              startContent={<X className="h-3.5 w-3.5" />}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <Chip
                            variant="flat"
                            size="sm"
                            className={cn(
                              "font-semibold",
                              error.resolved === "accepted"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {error.resolved === "accepted" ? "Accepted" : "Rejected"}
                          </Chip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {pendingErrors.length === 0 && resolvedErrors.length > 0 && (
              <div className="flex items-center justify-center gap-3 p-4 rounded-xl bg-primary/10 text-primary border border-primary/20 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <CheckCircle className="h-5 w-5" />
                <p className="font-semibold">All errors have been reviewed</p>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
