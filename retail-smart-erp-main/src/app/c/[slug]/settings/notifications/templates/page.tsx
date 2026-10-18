'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { TemplateEditor } from '@/components/notifications'
import { usePaginatedData } from '@/hooks'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface Template {
  id: string
  name: string
  channel: 'sms' | 'email' | 'both'
  triggerEvent?: string | null
  isAutoTrigger: boolean
  smsContent?: string | null
  emailSubject?: string | null
  emailBody?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

const channelLabels: Record<string, string> = {
  sms: 'SMS Only',
  email: 'Email Only',
  both: 'SMS & Email',
}

export default function TemplatesPage() {
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [showEditor, setShowEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  const {
    data: templates,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Template>({
    endpoint: '/api/notification-templates',
    entityType: 'notification-template',
    storageKey: 'notification-templates-page-size',
    additionalParams: {
      channel: channelFilter !== 'all' ? channelFilter : '',
    },
  })

  const handleCreate = () => {
    setEditingTemplate(null)
    setShowEditor(true)
  }

  const handleEdit = (template: Template) => {
    setEditingTemplate(template)
    setShowEditor(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return

    try {
      const res = await fetch(`/api/notification-templates/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        refresh()
      }
    } catch (error) {
      console.error('Failed to delete template:', error)
    }
  }

  const handleSave = async (template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
    const isEdit = !!template.id

    const res = await fetch(
      isEdit ? `/api/notification-templates/${template.id}` : '/api/notification-templates',
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      }
    )

    if (!res.ok) {
      throw new Error('Failed to save template')
    }

    refresh()
  }

  const getChannelBadge = (channel: string) => {
    const styles: Record<string, string> = {
      sms: 'bg-blue-100 text-blue-800',
      email: 'bg-purple-100 text-purple-800',
      both: 'bg-green-100 text-green-800',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[channel]}`}>
        {channel === 'both' ? 'SMS & Email' : channel.toUpperCase()}
      </span>
    )
  }

  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Message Template"
      actionButton={{ label: 'Create Template', onClick: handleCreate }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search templates..."
      filterContent={
        <>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            {Object.entries(channelLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {channelFilter !== 'all' && (
            <button onClick={() => setChannelFilter('all')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <div className="list-container-xl">
          {loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                {search || channelFilter !== 'all' ? 'No templates match your filters' : 'No templates found'}
              </p>
              {!search && channelFilter === 'all' && (
                <Button variant="outline" className="mt-4" onClick={handleCreate}>
                  Create your first template
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y dark:divide-gray-700">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium dark:text-white">{template.name}</h3>
                      {getChannelBadge(template.channel)}
                      {template.isAutoTrigger && template.triggerEvent && (
                        <span className="px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-800">
                          Auto: {template.triggerEvent.replace('.', ' ')}
                        </span>
                      )}
                      {!template.isActive && (
                        <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">
                          Inactive
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {template.smsContent && (
                        <p className="truncate max-w-lg">
                          SMS: {template.smsContent.substring(0, 60)}...
                        </p>
                      )}
                      {template.emailSubject && (
                        <p className="truncate max-w-lg">
                          Email: {template.emailSubject}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(template)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(template.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      <TemplateEditor
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        template={editingTemplate}
        onSave={handleSave}
      />
    </ListPageLayout>
  )
}
