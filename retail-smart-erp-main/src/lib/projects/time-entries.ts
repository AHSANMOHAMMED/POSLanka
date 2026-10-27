/**
 * Timesheet entry helpers (drizzle/0185). Server-only.
 */
import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { projectTasks, projects } from '@/lib/db/schema'
import { minutesBetween } from './billing'
import { colomboInstant } from './server'

export interface EntryTimes {
  startTime: Date | null
  endTime: Date | null
  durationMinutes: number
}

/** start/end (HH:MM on entryDate, Colombo) or a plain duration */
export function entryTimes(input: { entryDate: string; startTime?: string | null; endTime?: string | null; durationMinutes?: number | null }): EntryTimes {
  if (input.startTime && input.endTime) {
    return {
      startTime: colomboInstant(input.entryDate, input.startTime),
      endTime: colomboInstant(input.entryDate, input.endTime),
      durationMinutes: minutesBetween(input.startTime, input.endTime),
    }
  }
  return { startTime: null, endTime: null, durationMinutes: Math.round(input.durationMinutes || 0) }
}

/** The task must belong to the project (and be active for new time). */
export async function checkTask(db: TenantDb, projectId: string, taskId: string | null | undefined): Promise<NextResponse | null> {
  if (!taskId) return null
  const [t] = await db.select({ id: projectTasks.id, isActive: projectTasks.isActive }).from(projectTasks)
    .where(and(eq(projectTasks.id, taskId), eq(projectTasks.projectId, projectId)))
  if (!t) return NextResponse.json({ error: 'Task not found on this project' }, { status: 400 })
  if (!t.isActive) return NextResponse.json({ error: 'This task is closed' }, { status: 400 })
  return null
}

/** Time is logged only on open projects */
export async function checkProjectOpen(db: TenantDb, projectId: string): Promise<NextResponse | null> {
  const [p] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId))
  if (p && (p.status === 'completed' || p.status === 'cancelled')) {
    return NextResponse.json({ error: `This project is ${p.status}`, code: 'PROJECT_CLOSED' }, { status: 400 })
  }
  return null
}
