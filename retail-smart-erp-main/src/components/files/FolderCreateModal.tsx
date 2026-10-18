'use client'

import { useState } from 'react'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Loader2 } from 'lucide-react'

interface FolderCreateModalProps {
  isOpen: boolean
  onClose: () => void
  parentFolderId?: string | null
  onCreated?: () => void
}

export function FolderCreateModal({ isOpen, onClose, parentFolderId, onCreated }: FolderCreateModalProps) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/files/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          folderId: parentFolderId || null,
        }),
      })

      if (res.ok) {
        toast.success('Folder created')
        onCreated?.()
        handleClose()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create folder')
      }
    } catch {
      toast.error('Failed to create folder')
    } finally {
      setCreating(false)
    }
  }

  function handleClose() {
    if (creating) return
    setName('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Folder" size="sm">
      <ModalBody>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Folder name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter folder name"
            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={handleClose}
          disabled={creating}
          className="px-4 py-2 text-sm text-gray-700 bg-white border rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {creating && <Loader2 size={14} className="animate-spin" />}
          Create
        </button>
      </ModalFooter>
    </Modal>
  )
}
