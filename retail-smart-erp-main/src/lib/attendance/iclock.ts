/**
 * ZKTeco ADMS / "iclock" push protocol (ZKTeco, eSSL, Identix, Realand and other compatible
 * fingerprint / face terminals with a "Cloud server" / "ADMS" setting).
 *
 *   GET  /iclock/cdata?SN=…&options=all        handshake → options text (ATTLOGStamp, Delay, …)
 *   POST /iclock/cdata?SN=…&table=ATTLOG&Stamp=…  tab-separated punches → "OK: n"
 *   POST /iclock/cdata?SN=…&table=OPERLOG       operation log / user list → "OK: n"
 *   GET  /iclock/getrequest?SN=…                command poll → "OK" (no commands)
 *   POST /iclock/devicecmd?SN=…                 command results → "OK"
 *
 * The device is not a logged-in user: the registered serial number (attendance_devices) is what
 * maps it to a tenant. Device clocks run in local time (attendance_devices.timezone).
 */
import { localToUtc, parseLocalDateTime } from './time'

export interface AttLogRecord {
  pin: string
  local: { date: string; time: string }
  status: string
  verify: string
  workCode: string
  line: string
}

/** status 0 check-in, 1 check-out, 2 break-out, 3 break-in, 4 OT-in, 5 OT-out */
export function punchTypeFromStatus(status: string): 'in' | 'out' | 'unknown' {
  switch (String(status).trim()) {
    case '0': case '3': case '4': return 'in'
    case '1': case '2': case '5': return 'out'
    default: return 'unknown'
  }
}

/** Verify mode code → label (1 fingerprint, 15 face …); unknown codes are kept as the code. */
export function verifyLabel(code: string): string {
  const labels: Record<string, string> = {
    '0': 'password', '1': 'fingerprint', '2': 'card', '3': 'password', '4': 'card', '9': 'face', '15': 'face', '25': 'palm',
  }
  return labels[String(code).trim()] ?? String(code).trim()
}

/** Parse an ATTLOG body: one record per line, "PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify\tworkcode…" */
export function parseAttLog(body: string, maxLines = 20000): AttLogRecord[] {
  const out: AttLogRecord[] = []
  const lines = body.split(/\r?\n/)
  for (const raw of lines) {
    if (out.length >= maxLines) break
    const line = raw.trim()
    if (!line) continue
    let cells = line.split('\t').map((c) => c.trim())
    if (cells.length < 2) {
      // Some firmware separates with spaces: PIN DATE TIME STATUS VERIFY
      const m = line.match(/^(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*(\S*)\s*(\S*)\s*(\S*)/)
      if (!m) continue
      cells = [m[1], m[2], m[3], m[4], m[5]]
    }
    const pin = cells[0]
    const local = parseLocalDateTime(cells[1] || '')
    if (!pin || !local || pin.length > 50) continue
    out.push({ pin, local, status: cells[2] ?? '', verify: cells[3] ?? '', workCode: cells[4] ?? '', line: line.slice(0, 300) })
  }
  return out
}

export function attLogInstant(rec: AttLogRecord, tz: string): Date {
  return localToUtc(rec.local.date, rec.local.time, tz)
}

/** User records in an OPERLOG upload: "USER PIN=1\tName=John\tPri=0…" → { pin: name } */
export function parseOperLogUsers(body: string, max = 5000): Record<string, string> {
  const users: Record<string, string> = {}
  let n = 0
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('USER ')) continue
    const fields: Record<string, string> = {}
    for (const part of line.slice(5).split('\t')) {
      const i = part.indexOf('=')
      if (i > 0) fields[part.slice(0, i).trim()] = part.slice(i + 1).trim()
    }
    if (fields.PIN) {
      users[fields.PIN.slice(0, 50)] = (fields.Name || '').slice(0, 100)
      if (++n >= max) break
    }
  }
  return users
}

/** Count of non-empty lines (the "OK: n" answer for tables we only acknowledge). */
export function countLines(body: string): number {
  return body.split(/\r?\n/).filter((l) => l.trim()).length
}

/** Handshake answer. `attlogStamp` null = ask for every stored record (first contact / re-sync). */
export function handshakeText(sn: string, opts: { attlogStamp?: string | null; operlogStamp?: string | null; registered: boolean }): string {
  const lines = [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${opts.attlogStamp || 'None'}`,
    `OPERLOGStamp=${opts.operlogStamp || 'None'}`,
    'ATTPHOTOStamp=None',
    // Unregistered devices back off; registered ones push in real time and poll every 10 s
    `ErrorDelay=${opts.registered ? 30 : 300}`,
    `Delay=${opts.registered ? 10 : 300}`,
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser',
    'Realtime=1',
    'Encrypt=None',
    'ServerVer=2.4.1',
  ]
  return lines.join('\n') + '\n'
}

/** Serial numbers are letters / digits / - _ (device firmware sends e.g. "CKJ1234567890"). */
export function cleanSerial(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim()
  if (!s || s.length > 64 || !/^[A-Za-z0-9_.-]+$/.test(s)) return null
  return s
}
