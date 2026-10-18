'use client'

import { useState, useCallback, useMemo } from 'react'
import { EditableGrid, ColumnDef } from '@/components/ui/editable-grid'
import { LinkFieldOption } from '@/components/ui/link-field'
import { AlertModal } from '@/components/ui/alert-modal'
import { toast } from '@/components/ui/toast'

interface ServiceType {
  id: string
  name: string
  defaultHours: string | null
  defaultRate: string | null
}

interface UserInfo {
  id: string
  fullName: string
}

interface WorkOrderService {
  id: string
  serviceTypeId: string | null
  description: string | null
  hours: string
  rate: string
  amount: string
  serviceType: ServiceType | null
  technician: UserInfo | null
}

interface Technician {
  id: string
  fullName: string
}

// Grid row type - flattened for editing
interface ServiceGridRow {
  [key: string]: unknown
  id: string
  serviceTypeId: string
  serviceName: string
  technicianId: string
  technicianName: string
  hours: number
  rate: number
  amount: number
  isNew?: boolean
}

interface WorkOrderServicesGridProps {
  workOrderId: string
  services: WorkOrderService[]
  technicians: Technician[]
  canModify: boolean
  onRefresh: () => void
  onSaved?: () => void
  searchServiceTypes: (search: string) => Promise<LinkFieldOption[]>
  onCreateServiceType?: (name: string) => void
  expectedUpdatedAt?: string | null
  onConflict?: () => void
}

function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function WorkOrderServicesGrid({
  workOrderId,
  services,
  technicians,
  canModify,
  onRefresh,
  onSaved,
  searchServiceTypes,
  onCreateServiceType,
  expectedUpdatedAt,
  onConflict,
}: WorkOrderServicesGridProps) {
  const [updating, setUpdating] = useState(false)
  const [localData, setLocalData] = useState<ServiceGridRow[]>([])
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string; variant: 'info' | 'warning' | 'error' | 'success' }>({
    open: false,
    title: '',
    message: '',
    variant: 'info',
  })

  // Convert services to grid rows (source of truth from server)
  const serverData = useMemo((): ServiceGridRow[] => {
    return services.map(service => ({
      id: service.id,
      serviceTypeId: service.serviceTypeId || '',
      serviceName: service.serviceType?.name || service.description || 'Labor',
      technicianId: service.technician?.id || '',
      technicianName: service.technician?.fullName || '',
      hours: parseFloat(service.hours) || 0,
      rate: parseFloat(service.rate) || 0,
      amount: parseFloat(service.amount) || 0,
    }))
  }, [services])

  // Use local data if we have pending edits, otherwise use server data
  const gridData = localData.length > 0 ? localData : serverData

  // Handle local data changes (for manual save mode)
  const handleDataChange = useCallback((newData: ServiceGridRow[]) => {
    setLocalData(newData)
  }, [])

  // Technician options for select
  const technicianOptions = useMemo(() => [
    { value: '', label: 'Not assigned' },
    ...technicians.map(t => ({ value: t.id, label: t.fullName }))
  ], [technicians])

  // Column definitions
  const columns = useMemo((): ColumnDef<ServiceGridRow>[] => [
    {
      key: 'serviceName',
      label: 'Service',
      type: 'link',
      width: '35%',
      editable: canModify,
      fetchOptions: searchServiceTypes,
      onCreateNew: onCreateServiceType,
      createLabel: 'Add service type',
      placeholder: 'Search service types...',
      onChange: (value, _row, _index, option) => {
        // Use option data to populate serviceName and rate
        return {
          serviceTypeId: value as string,
          serviceName: option?.label || '',
          rate: parseFloat(option?.data?.defaultRate as string || '0'),
        }
      },
    },
    {
      key: 'technicianId',
      label: 'Technician',
      type: 'select',
      width: '20%',
      editable: canModify,
      options: technicianOptions,
    },
    {
      key: 'hours',
      label: 'Hours',
      type: 'number',
      width: '12%',
      align: 'right',
      editable: canModify,
      min: 0,
      step: 0.25,
      precision: 2,
    },
    {
      key: 'rate',
      label: 'Rate',
      type: 'currency',
      width: '15%',
      align: 'right',
      editable: canModify,
      min: 0,
      step: 0.01,
      precision: 2,
    },
    {
      key: 'amount',
      label: 'Amount',
      type: 'readonly',
      width: '18%',
      align: 'right',
      calculate: (row) => row.hours * row.rate,
      render: (value) => {
        const num = typeof value === 'number' ? value : 0
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
    },
  ], [canModify, technicianOptions, searchServiceTypes, onCreateServiceType])

  // Handle batch saving of dirty rows (manual save mode)
  const handleSaveChanges = useCallback(async (
    dirtyRows: { row: ServiceGridRow; index: number; changes: Record<string, unknown> }[],
    deletedRows?: ServiceGridRow[]
  ) => {
    setUpdating(true)
    let hasErrors = false
    let latestUpdatedAt = expectedUpdatedAt

    try {
      // Process deletions first
      if (deletedRows && deletedRows.length > 0) {
        for (const row of deletedRows) {
          if (row.id.startsWith('temp-')) continue // Skip temp rows

          const res = await fetch(`/api/work-orders/${workOrderId}/services?serviceId=${row.id}`, {
            method: 'DELETE',
          })

          if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete service', variant: 'error' })
            hasErrors = true
            break
          }
          const data = await res.json()
          if (data?.workOrderUpdatedAt) latestUpdatedAt = data.workOrderUpdatedAt
        }
      }

      // Process updates
      if (!hasErrors) {
        for (const { row, changes } of dirtyRows) {
          // Skip temp rows (new rows handled separately)
          if (row.id.startsWith('temp-')) continue

          // Validate hours
          if ('hours' in changes) {
            const hours = changes.hours as number
            if (hours <= 0) {
              setAlertModal({ open: true, title: 'Validation Error', message: 'Hours must be greater than zero', variant: 'error' })
              hasErrors = true
              break
            }
          }

          // Build update payload
          const updatePayload: Record<string, unknown> = { serviceId: row.id }
          if ('technicianId' in changes) updatePayload.technicianId = changes.technicianId || null
          if ('hours' in changes) updatePayload.hours = changes.hours
          if ('rate' in changes) updatePayload.rate = changes.rate
          if (latestUpdatedAt) updatePayload.expectedUpdatedAt = latestUpdatedAt

          const res = await fetch(`/api/work-orders/${workOrderId}/services`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload),
          })

          if (res.status === 409) {
            onConflict?.()
            setAlertModal({
              open: true,
              title: 'Conflict',
              message: 'This work order was modified by another user. Please refresh.',
              variant: 'warning'
            })
            hasErrors = true
            break
          }

          if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to update service', variant: 'error' })
            hasErrors = true
            break
          }
          const data = await res.json()
          if (data?.workOrderUpdatedAt) latestUpdatedAt = data.workOrderUpdatedAt
        }
      }

      if (!hasErrors) {
        toast.success('Services updated')
        setLocalData([]) // Clear local changes
        onRefresh()
        onSaved?.()
      } else {
        // Refresh to sync UI with server state after partial save
        onRefresh()
      }
    } catch (error) {
      console.error('Error saving services:', error)
      setAlertModal({ open: true, title: 'Error', message: 'Failed to save changes', variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }, [workOrderId, expectedUpdatedAt, onRefresh, onSaved, onConflict])

  // Handle adding new row
  const handleRowAdd = useCallback((): ServiceGridRow => {
    return {
      id: generateTempId(),
      serviceTypeId: '',
      serviceName: '',
      technicianId: '',
      technicianName: '',
      hours: 1,
      rate: 0,
      amount: 0,
      isNew: true,
    }
  }, [])

  // Handle deleting row
  const handleRowDelete = useCallback(async (row: ServiceGridRow) => {
    if (row.id.startsWith('temp-')) {
      // Just remove from local state - it's not saved yet
      return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/services?serviceId=${row.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onRefresh()
        onSaved?.()
      } else {
        const data = await res.json()
        setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete service', variant: 'error' })
      }
    } catch (error) {
      console.error('Error deleting service:', error)
      setAlertModal({ open: true, title: 'Error', message: 'Failed to delete service', variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }, [workOrderId, onRefresh, onSaved])

  // Handle grid data changes (for new rows being saved)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleGridChange = useCallback(async (newData: ServiceGridRow[]) => {
    // Find new rows that need to be saved
    const newRows = newData.filter(row => row.isNew && row.serviceTypeId && row.hours > 0)

    for (const row of newRows) {
      setUpdating(true)
      try {
        const res = await fetch(`/api/work-orders/${workOrderId}/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceTypeId: row.serviceTypeId || null,
            hours: row.hours,
            rate: row.rate,
            technicianId: row.technicianId || null,
          }),
        })
        if (res.ok) {
          onRefresh()
          onSaved?.()
        } else {
          const data = await res.json()
          setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to add service', variant: 'error' })
        }
      } catch (error) {
        console.error('Error adding service:', error)
        setAlertModal({ open: true, title: 'Error', message: 'Failed to add service', variant: 'error' })
      } finally {
        setUpdating(false)
      }
    }
  }, [workOrderId, onRefresh, onSaved])

  return (
    <>
      <EditableGrid
        columns={columns}
        data={gridData}
        onChange={handleDataChange}
        onRowAdd={canModify ? handleRowAdd : undefined}
        onRowDelete={canModify ? handleRowDelete : undefined}
        manualSave={canModify}
        onSaveChanges={handleSaveChanges}
        showRowNumbers
        showDeleteButton={canModify}
        showAddButton={canModify}
        addButtonLabel="Add Service"
        emptyMessage="No services added"
        disabled={!canModify}
        loading={updating}
        footerTotals={[
          { key: 'serviceName', label: 'Total:' },
          { key: 'amount' },
        ]}
        highlightNewRows
      />

      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ ...alertModal, open: false })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </>
  )
}
