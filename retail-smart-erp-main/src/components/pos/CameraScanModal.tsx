'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X, Flashlight, FlashlightOff, RefreshCw, CheckCircle2, AlertTriangle, Keyboard } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useEscapeKey } from '@/hooks/useEscapeKey'

/** Minimal typings for the Shape Detection API (not in lib.dom). */
interface DetectedBarcodeLike {
  rawValue: string
  format: string
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcodeLike[]>
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?(): Promise<string[]>
}

const WANTED_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'qr_code',
  'data_matrix',
  'pdf417',
  'codabar',
]

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor || null
}

export function supportsCameraScanning(): boolean {
  return (
    !!getDetectorCtor() &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
}

export interface CameraScanModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the decoded value. Return true when the code was accepted (item found). */
  onDetected: (code: string, format?: string) => Promise<boolean> | boolean
  title?: string
  /** Keep scanning after a successful detection (default true). */
  continuous?: boolean
}

type ScanResult = { code: string; ok: boolean; at: number; format?: string }

export function CameraScanModal({ isOpen, onClose, onDetected, title = 'Scan barcode', continuous = true }: CameraScanModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const busyRef = useRef(false)
  const lastSeenRef = useRef<Map<string, number>>(new Map())
  const continuousRef = useRef(continuous)
  const onDetectedRef = useRef(onDetected)
  const onCloseRef = useRef(onClose)

  const [supported, setSupported] = useState<boolean | null>(null)
  const [formats, setFormats] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [results, setResults] = useState<ScanResult[]>([])
  const [manual, setManual] = useState('')
  const [keepScanning, setKeepScanning] = useState(continuous)

  useEffect(() => {
    continuousRef.current = keepScanning
  }, [keepScanning])
  useEffect(() => {
    onDetectedRef.current = onDetected
    onCloseRef.current = onClose
  }, [onDetected, onClose])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const s = streamRef.current
    streamRef.current = null
    if (s) s.getTracks().forEach((t) => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
    setTorchOn(false)
    setTorchAvailable(false)
  }, [])

  const beep = useCallback((ok: boolean) => {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = ok ? 1800 : 400
      gain.gain.value = 0.08
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      setTimeout(() => {
        osc.stop()
        ctx.close().catch(() => {})
      }, ok ? 90 : 220)
    } catch {
      /* no audio */
    }
  }, [])

  const handleCode = useCallback(
    async (code: string, format?: string) => {
      const now = Date.now()
      const last = lastSeenRef.current.get(code) || 0
      if (now - last < 2000) return
      lastSeenRef.current.set(code, now)
      if (busyRef.current) return
      busyRef.current = true
      try {
        const ok = await onDetectedRef.current(code, format)
        beep(ok)
        setResults((prev) => [{ code, ok, at: now, format }, ...prev].slice(0, 6))
        if (ok && !continuousRef.current) {
          onCloseRef.current()
        }
      } finally {
        busyRef.current = false
      }
    },
    [beep]
  )

  const start = useCallback(
    async (deviceId?: string) => {
      stop()
      setError(null)
      const Ctor = getDetectorCtor()
      if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
        setSupported(false)
        return
      }
      setSupported(true)
      try {
        let available = WANTED_FORMATS
        if (Ctor.getSupportedFormats) {
          try {
            const sup = await Ctor.getSupportedFormats()
            available = WANTED_FORMATS.filter((f) => sup.includes(f))
          } catch {
            /* keep wanted list */
          }
        }
        setFormats(available)
        detectorRef.current = new Ctor({ formats: available.length ? available : undefined })

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        const track = stream.getVideoTracks()[0]
        try {
          const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
          setTorchAvailable(!!caps?.torch)
        } catch {
          setTorchAvailable(false)
        }
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          setCameras(devices.filter((d) => d.kind === 'videoinput'))
          const settings = track?.getSettings?.()
          if (settings?.deviceId) setCameraId(settings.deviceId)
        } catch {
          /* ignore */
        }

        timerRef.current = setInterval(async () => {
          const v = videoRef.current
          const det = detectorRef.current
          if (!v || !det || v.readyState < 2 || busyRef.current) return
          try {
            const codes = await det.detect(v)
            for (const c of codes) {
              if (c.rawValue) {
                await handleCode(c.rawValue, c.format)
                break
              }
            }
          } catch {
            /* transient decode error */
          }
        }, 180)
      } catch (e) {
        const name = e instanceof Error ? e.name : ''
        if (name === 'NotAllowedError') setError('Camera permission was denied. Allow camera access for this site and try again.')
        else if (name === 'NotFoundError') setError('No camera found on this device.')
        else setError(e instanceof Error ? e.message : 'Could not start the camera.')
      }
    },
    [stop, handleCode]
  )

  useEffect(() => {
    if (!isOpen) {
      stop()
      return
    }
    lastSeenRef.current.clear()
    setResults([])
    void start()
    return () => stop()
  }, [isOpen, start, stop])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(!torchOn)
    } catch {
      setTorchAvailable(false)
    }
  }

  const submitManual = async () => {
    const code = manual.trim()
    if (!code) return
    setManual('')
    await handleCode(code)
  }

  useEscapeKey(isOpen, onClose)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[95vh]">
        <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Camera className="w-5 h-5 text-teal-300" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-teal-300 font-bold block">Camera scanner</span>
              <h2 className="text-base font-bold leading-tight">{title}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {supported === false ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-200 flex gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Camera barcode scanning is not supported in this browser.</p>
                <p className="mt-1 text-xs">
                  It needs the BarcodeDetector API over HTTPS: Chrome or Edge on Android, ChromeOS and macOS, or Safari 17+ on
                  iOS/macOS. On Windows Chrome it is not available yet. Use a USB/Bluetooth scanner or type the code below.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
              {/* Aiming guide */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-3/4 h-1/3 border-2 border-teal-400/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
              </div>
              {error && (
                <div className="absolute inset-0 bg-black/70 text-white text-sm flex items-center justify-center p-4 text-center">
                  {error}
                </div>
              )}
              <div className="absolute bottom-2 right-2 flex gap-2">
                {torchAvailable && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className="p-2 rounded-lg bg-black/60 text-white hover:bg-black/80"
                    title="Toggle torch"
                  >
                    {torchOn ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => start(cameraId || undefined)}
                  className="p-2 rounded-lg bg-black/60 text-white hover:bg-black/80"
                  title="Restart camera"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {cameras.length > 1 && supported && (
            <select
              value={cameraId}
              onChange={(e) => {
                setCameraId(e.target.value)
                void start(e.target.value)
              }}
              className="w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5"
            >
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={keepScanning} onChange={(e) => setKeepScanning(e.target.checked)} className="rounded" />
              Keep scanning after each item
            </label>
            {formats.length > 0 && <span title={formats.join(', ')}>{formats.length} formats</span>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitManual()
            }}
            className="flex gap-2"
          >
            <FormInput
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Or type / paste a barcode"
              leftIcon={<Keyboard className="w-4 h-4" />}
              inputSize="md"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shrink-0"
            >
              Add
            </button>
          </form>

          {results.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">
              {results.map((r) => (
                <li key={`${r.code}-${r.at}`} className="flex items-center gap-2 px-3 py-1.5">
                  {r.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <span className="font-mono truncate">{r.code}</span>
                  <span className="ml-auto text-xs text-gray-400">{r.ok ? 'Added' : 'Not found'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
