"use client"

import { useState, useEffect } from 'react'
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Button,
  Input,
  Chip,
  useDisclosure,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@heroui/react'
import { Pencil, Trash2, Check, X, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getTableData, updateTableRow, deleteTableRow } from '../api'
import type { TableDataResponse } from '../api'

export function TableDataViewer({ tableName }: { tableName: string }) {
  const [data, setData] = useState<TableDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})
  const [deleteRowId, setDeleteRowId] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { isOpen: isDeleteModalOpen, onOpen: onDeleteModalOpen, onClose: onDeleteModalClose } = useDisclosure()

  useEffect(() => {
    loadData()
  }, [tableName, page])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)
      const result = await getTableData(tableName, { page, limit: 50 })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(row: Record<string, unknown>) {
    setEditingRow(row.id as number)
    setEditForm({ ...row })
  }

  async function saveEdit() {
    if (!editingRow) return
    try {
      await updateTableRow(tableName, editingRow, editForm)
      setEditingRow(null)
      setEditForm({})
      loadData()
    } catch (err) {
      alert('Failed to update row: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  function cancelEdit() {
    setEditingRow(null)
    setEditForm({})
  }

  function confirmDelete(id: number) {
    setDeleteRowId(id)
    onDeleteModalOpen()
  }

  async function handleDelete() {
    if (!deleteRowId) return
    setIsDeleting(true)
    try {
      await deleteTableRow(tableName, deleteRowId)
      setDeleteRowId(null)
      onDeleteModalClose()
      loadData()
    } catch (err) {
      alert('Failed to delete row: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setIsDeleting(false)
    }
  }

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 0

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading table data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-destructive">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm font-medium">{error}</p>
        <Button size="sm" variant="bordered" onPress={loadData}>
          Retry
        </Button>
      </div>
    )
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-muted-foreground">No data in this table yet.</p>
        <Button size="sm" variant="bordered" onPress={loadData}>
          Refresh
        </Button>
      </div>
    )
  }

  const columns = Object.keys(data.rows[0] || {}).filter(col => col !== 'id')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Chip variant="flat" size="sm" className="bg-primary/10 text-primary font-semibold">
            {data.total} Total Rows
          </Chip>
          <Chip variant="flat" size="sm" className="bg-muted text-muted-foreground font-semibold">
            Page {page} of {totalPages || 1}
          </Chip>
        </div>
        <Button size="sm" variant="bordered" onPress={loadData}>
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table 
          aria-label="Table Data" 
          shadow="none" 
          removeWrapper
          classNames={{
            th: "bg-muted/30 text-muted-foreground font-semibold text-xs uppercase tracking-wide py-4",
            td: "py-4"
          }}
        >
          <TableHeader>
            {columns.map(col => (
              <TableColumn key={col}>
                <code className="text-xs">{col}</code>
              </TableColumn>
            ))}
            <TableColumn className="text-right w-32">Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {data.rows.map(row => (
              <TableRow key={row.id}>
                {columns.map(col => (
                  <TableCell key={col}>
                    {editingRow === row.id ? (
                      <Input
                        size="sm"
                        variant="bordered"
                        value={String(row[col] ?? '')}
                        onChange={(e) => setEditForm(prev => ({ ...prev, [col]: e.target.value }))}
                        classNames={{
                          input: "text-sm",
                          inputWrapper: "min-w-[100px]"
                        }}
                      />
                    ) : (
                      <code className="text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] block">
                        {row[col] === null || row[col] === undefined ? (
                          <span className="text-muted-foreground italic">NULL</span>
                        ) : String(row[col])}
                      </code>
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  {editingRow === row.id ? (
                    <div className="flex justify-end gap-1">
                      <Button 
                        isIconOnly 
                        color="success" 
                        size="sm" 
                        onPress={saveEdit}
                        className="text-success-foreground"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button 
                        isIconOnly 
                        color="danger" 
                        variant="light" 
                        size="sm" 
                        onPress={cancelEdit}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button 
                        isIconOnly 
                        variant="light" 
                        size="sm" 
                        onPress={() => startEdit(row)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button 
                        isIconOnly 
                        variant="light" 
                        color="danger" 
                        size="sm" 
                        onPress={() => confirmDelete(row.id as number)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-center gap-2">
        <Button 
          size="sm" 
          variant="bordered" 
          isDisabled={page <= 1} 
          onPress={() => setPage(p => p - 1)}
        >
          Previous
        </Button>
        <Button 
          size="sm" 
          variant="bordered" 
          isDisabled={page >= totalPages} 
          onPress={() => setPage(p => p + 1)}
        >
          Next
        </Button>
      </div>

      <Modal isOpen={isDeleteModalOpen} onClose={onDeleteModalClose}>
        <ModalContent>
          <ModalHeader>Delete Row</ModalHeader>
          <ModalBody>
            <p>Are you sure you want to delete this row? This action cannot be undone.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onDeleteModalClose}>
              Cancel
            </Button>
            <Button 
              color="danger" 
              onPress={handleDelete}
              isDisabled={isDeleting}
              startContent={isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
