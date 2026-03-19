"use client"

import { Card, CardBody } from "@heroui/react"
import { FileText, CheckCircle, AlertTriangle, TrendingUp, Activity } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatsCardsProps {
  totalFiles: number
  validFiles: number
  errorFiles: number
}

export function StatsCards({ totalFiles, validFiles, errorFiles }: StatsCardsProps) {
  const successRate = totalFiles > 0 ? Math.round((validFiles / totalFiles) * 100) : 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Files */}
      <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <CardBody className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground font-medium">Total Files</p>
              <p className="text-3xl font-bold tracking-tight">{totalFiles}</p>
            </div>
            <div className="h-12 w-12 rounded-xl bg-chart-2/10 flex items-center justify-center">
              <FileText className="h-6 w-6 text-chart-2" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-primary font-medium">
              <TrendingUp className="h-3 w-3" />
              Active
            </span>
          </div>
        </CardBody>
      </Card>

      {/* Valid Files */}
      <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <CardBody className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground font-medium">Valid Files</p>
              <p className="text-3xl font-bold tracking-tight text-primary">{validFiles}</p>
            </div>
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground font-medium">Success Rate</span>
              <span className="font-bold text-primary">{successRate}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Errors Found */}
      <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <CardBody className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground font-medium">Errors Found</p>
              <p className={cn(
                "text-3xl font-bold tracking-tight",
                errorFiles > 0 ? "text-destructive" : "text-primary"
              )}>{errorFiles}</p>
            </div>
            <div className={cn(
              "h-12 w-12 rounded-xl flex items-center justify-center",
              errorFiles > 0 ? "bg-destructive/10" : "bg-primary/10"
            )}>
              <AlertTriangle className={cn(
                "h-6 w-6",
                errorFiles > 0 ? "text-destructive" : "text-primary"
              )} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs">
            {errorFiles > 0 ? (
              <span className="text-destructive font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                Requires attention
              </span>
            ) : (
              <span className="text-primary font-medium flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" />
                All clear
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Quality Score */}
      <Card className="border border-border bg-card shadow-sm rounded-2xl hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <CardBody className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground font-medium">Quality Score</p>
              <p className="text-3xl font-bold tracking-tight">
                {totalFiles > 0 ? `${Math.round(((validFiles) / totalFiles) * 100)}%` : "—"}
              </p>
            </div>
            <div className="h-12 w-12 rounded-xl bg-chart-3/10 flex items-center justify-center">
              <div className="relative">
                <svg className="h-7 w-7 text-chart-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" className="opacity-20" />
                  <circle 
                    cx="12" 
                    cy="12" 
                    r="10" 
                    strokeDasharray={`${successRate * 0.628} 100`}
                    strokeLinecap="round"
                    transform="rotate(-90 12 12)"
                    className="opacity-100"
                  />
                </svg>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3 w-3" />
            <span className="font-medium">Overall data quality</span>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
