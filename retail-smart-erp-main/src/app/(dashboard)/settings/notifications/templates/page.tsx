'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { TemplateEditor } from '@/components/notifications'
import { usePaginatedData } from '@/hooks'

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

export default function TemplatesPage() {
  const router = useRouter()
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Message Templates</h1>
            <p className="text-gray-500">Create reusable templates for SMS and email</p>
          </div>
        </div>
        <Button onClick={handleCreate}>Create Template</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        >
          <option value="all">All Channels</option>
          <option value="sms">SMS Only</option>
          <option value="email">Email Only</option>
          <option value="both">Both</option>
        </select>
      </div>

      {/* Templates List */}
      <Card className="overflow-hidden">
        <div className="list-container-xl">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No templates found</p>
              <Button variant="outline" className="mt-4" onClick={handleCreate}>
                Create your first template
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="p-4 hover:bg-gray-50 flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{template.name}</h3>
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

                    <div className="mt-1 text-sm text-gray-500">
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

        {/* Pagination */}
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </Card>

      {/* Template Editor Modal */}
      <TemplateEditor
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        template={editingTemplate}
        onSave={handleSave}
      />
    </div>
  )
}
