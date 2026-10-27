'use client'

/**
 * Running timer (kept on the server: one per user, survives reloads and devices).
 * Start needs a project (and optionally a task); stop turns it into a timesheet entry.
 */
import { useCallback, useEffect, useState } from 'react'
import { Play, Square, X, Timer } from 'lucide-react'
import { btnPrimary, btnSecondary, card, input, readJson } from '@/components/recurring-invoices/ui'

interface Running { id: string; projectId: string; projectName: string; taskName: string | null; startTime: string; notes: string | null }
interface ProjectOption { id: string; name: string; tasks?: Array<{ id: string; name: string; isActive: boolean }> }

const pad = (n: number) => String(n).padStart(2, '0')
function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export function TimerBar({ projects, fixedProjectId, onChange }: { projects: ProjectOption[]; fixedProjectId?: string; onChange?: () => void }) {
  const [running, setRunning] = useState<Running | null>(null)
  const [skew, setSkew] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [projectId, setProjectId] = useState(fixedProjectId || '')
  const [taskId, setTaskId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/time-entries/timer')
    if (!res.ok) return
    const d = await res.json()
    setRunning(d.timer)
    if (d.serverTime) setSkew(Date.parse(d.serverTime) - Date.now())
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  async function act(action: 'start' | 'stop' | 'discard') {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/time-entries/timer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'start' ? { action, projectId, taskId: taskId || null, notes: notes || null } : { action, notes: notes || undefined }),
      })
      const d = await readJson(res)
      if (!res.ok) setError(String(d.error || 'Failed'))
      else { setNotes(''); onChange?.() }
      await load()
    } finally { setBusy(false) }
  }

  const project = projects.find((p) => p.id === (fixedProjectId || projectId))
  return (
    <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
      <Timer size={16} className={running ? 'text-green-600 animate-pulse' : 'text-gray-400'} aria-hidden />
      {running ? (
        <>
          <span className="font-mono text-lg font-semibold dark:text-white" aria-live="polite">{elapsed(now + skew - Date.parse(running.startTime))}</span>
          <span className="text-sm text-gray-600 dark:text-gray-300">{running.projectName}{running.taskName ? ` · ${running.taskName}` : ''}</span>
          <input aria-label="Timer notes" className={`${input} w-56`} placeholder={running.notes || 'What did you work on?'} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className={btnPrimary} disabled={busy} onClick={() => act('stop')}><Square size={14} /> Stop</button>
          <button className={btnSecondary} disabled={busy} onClick={() => { if (confirm('Discard this timer without logging the time?')) act('discard') }} aria-label="Discard timer"><X size={14} /></button>
        </>
      ) : (
        <>
          {!fixedProjectId && (
            <select aria-label="Project" className={`${input} w-56`} value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId('') }}>
              <option value="">Project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {project?.tasks && project.tasks.length > 0 && (
            <select aria-label="Task" className={`${input} w-48`} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No task</option>
              {project.tasks.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <input aria-label="Timer notes" className={`${input} w-56`} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className={btnPrimary} disabled={busy || !(fixedProjectId || projectId)} onClick={() => act('start')}><Play size={14} /> Start timer</button>
        </>
      )}
      {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
    </div>
  )
}
