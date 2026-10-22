'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/page-header'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { API_SCOPES, API_SCOPE_LABELS, type ApiScope } from '@/lib/auth/api-key-scopes'

interface ApiKeyRow {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  lastUsedIp: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdByName: string | null
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : '—')

function keyStatus(k: ApiKeyRow): { label: string; cls: string } {
  if (k.revokedAt) return { label: 'Revoked', cls: 'bg-gray-100 text-gray-600' }
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return { label: 'Expired', cls: 'bg-amber-100 text-amber-800' }
  return { label: 'Active', cls: 'bg-green-100 text-green-800' }
}

export default function ApiKeysPage() {
  const { role } = useCompany()
  const allowed = role === 'owner' || role === 'manager'
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiScope[]>(['items:read', 'stock:read'])
  const [expiresInDays, setExpiresInDays] = useState('365')
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<{ name: string; key: string } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null)
  const [revoking, setRevoking] = useState(false)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/api-keys')
      if (res.ok) setKeys(await res.json())
    } catch (error) {
      console.error('Error fetching API keys:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) void fetchKeys()
    else setLoading(false)
  }, [allowed, fetchKeys])

  async function handleCreate() {
    if (!name.trim() || scopes.length === 0) {
      toast.error('Enter a name and select at least one scope')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes, expiresInDays: expiresInDays ? Number(expiresInDays) : undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to create API key')
        return
      }
      setShowCreate(false)
      setName('')
      setSecret({ name: data.name, key: data.secret })
      void fetchKeys()
    } catch {
      toast.error('Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      const res = await fetch(`/api/settings/api-keys/${revokeTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(`API key "${revokeTarget.name}" revoked`)
        void fetchKeys()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to revoke API key')
      }
    } finally {
      setRevoking(false)
      setRevokeTarget(null)
    }
  }

  function toggleScope(s: ApiScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <Breadcrumb items={[{ label: 'Settings' }, { label: 'API Keys' }]} />
        <p className="mt-6 text-sm text-gray-600">Only the owner or a manager can manage API keys.</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'API Keys' }]} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Keys let other systems (web shop, accounting, BI) use the POSLanka API at <code className="font-mono">/api/v1</code>.
            A key acts with the permissions of the person who created it and stops working if it is revoked,
            expires, or that person is deactivated. See docs/API.md.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
        >
          <Plus size={16} /> New API key
        </button>
      </div>

      <div className="bg-white rounded border overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">API keys</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Key</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Scopes</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Last used</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Expires</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No API keys yet</td></tr>
              ) : keys.map((k) => {
                const st = keyStatus(k)
                return (
                  <tr key={k.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{k.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{k.keyPrefix}_…</td>
                    <td className="px-4 py-3 text-xs">{k.scopes.join(', ')}</td>
                    <td className="px-4 py-3 text-xs">{fmt(k.createdAt)}<div className="text-gray-500">{k.createdByName || ''}</div></td>
                    <td className="px-4 py-3 text-xs">{fmt(k.lastUsedAt)}<div className="text-gray-500">{k.lastUsedIp || ''}</div></td>
                    <td className="px-4 py-3 text-xs">{k.expiresAt ? fmt(k.expiresAt) : 'Never'}</td>
                    <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      {!k.revokedAt && (
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(k)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50"
                        >
                          <Trash2 size={12} /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="New API key"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50">Cancel</button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Create key
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="api-key-name" className="block text-sm font-medium mb-1">Name</label>
            <input
              id="api-key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Web shop"
              className="w-full px-3 py-2 border rounded text-sm"
            />
          </div>
          <fieldset>
            <legend className="block text-sm font-medium mb-1">Scopes</legend>
            <div className="grid grid-cols-2 gap-2">
              {API_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                  <span>{API_SCOPE_LABELS[s]} <code className="text-xs text-gray-500">{s}</code></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="api-key-expiry" className="block text-sm font-medium mb-1">Expires</label>
            <select id="api-key-expiry" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className="w-full px-3 py-2 border rounded text-sm">
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
              <option value="">Never</option>
            </select>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!secret} onClose={() => setSecret(null)} title="Copy your API key now" size="lg">
        {secret && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              This is the only time the key for <strong>{secret.name}</strong> is shown. Store it in the other
              system&apos;s secret settings; POSLanka keeps only a hash and cannot show it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-gray-50 border rounded font-mono text-xs break-all">{secret.key}</code>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(secret.key).then(() => toast.success('Copied')) }}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded border hover:bg-gray-50"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
        title="Revoke API key?"
        message={revokeTarget ? `Systems using "${revokeTarget.name}" (${revokeTarget.keyPrefix}) will stop working immediately. This cannot be undone.` : ''}
        confirmText="Revoke"
        variant="danger"
        processing={revoking}
      />
    </div>
  )
}
