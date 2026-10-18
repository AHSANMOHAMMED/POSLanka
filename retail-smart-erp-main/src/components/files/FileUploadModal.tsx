'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Upload, X, File, Loader2, CheckCircle2, AlertCircle, ImageIcon, FileText, FileSpreadsheet, Camera, Video, Square, Circle } from 'lucide-react'
import { useIsTouchDevice } from '@/hooks/useResponsive'

interface FileUploadModalProps {
  isOpen: boolean
  onClose: () => void
  folderId?: string | null
  onUploaded?: () => void
}

interface UploadEntry {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  errorMessage?: string
}

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

function uploadFileWithProgress(
  file: File,
  options: { isPrivate: boolean; folderId?: string | null; category?: string; description?: string },
  onProgress: (percent: number) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)
    if (options.isPrivate) formData.append('isPrivate', 'true')
    if (options.folderId) formData.append('folderId', options.folderId)
    if (options.category) formData.append('category', options.category)
    if (options.description) formData.append('description', options.description)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true })
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          resolve({ ok: false, error: err.error || 'Upload failed' })
        } catch {
          resolve({ ok: false, error: 'Upload failed' })
        }
      }
    }
    xhr.onerror = () => resolve({ ok: false, error: 'Network error' })
    xhr.open('POST', '/api/files')
    xhr.send(formData)
  })
}

function getFileTypeIcon(file: File) {
  const type = file.type
  if (type.startsWith('image/')) return <ImageIcon size={16} className="text-blue-500" />
  if (type.startsWith('video/')) return <Video size={16} className="text-purple-500" />
  if (type === 'application/pdf') return <FileText size={16} className="text-red-500" />
  if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv'))
    return <FileSpreadsheet size={16} className="text-green-500" />
  return <File size={16} className="text-gray-400 dark:text-gray-500" />
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function FileUploadModal({ isOpen, onClose, folderId, onUploaded }: FileUploadModalProps) {
  const [uploadQueue, setUploadQueue] = useState<UploadEntry[]>([])
  const [isPrivate, setIsPrivate] = useState(false)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Camera state
  const isTouch = useIsTouchDevice()
  const cameraPhotoRef = useRef<HTMLInputElement>(null)
  const cameraVideoRef = useRef<HTMLInputElement>(null)
  const [showWebcam, setShowWebcam] = useState(false)
  const [webcamMode, setWebcamMode] = useState<'photo' | 'video'>('photo')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recordingSize, setRecordingSize] = useState(0)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up webcam on close
  useEffect(() => {
    if (!isOpen) {
      stopWebcam()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  function handleFiles(fileList: FileList) {
    const newEntries: UploadEntry[] = []
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} exceeds 100MB limit`)
      } else {
        newEntries.push({ file, progress: 0, status: 'pending' })
      }
    }
    if (newEntries.length > 0) {
      setUploadQueue(prev => [...prev, ...newEntries])
    }
  }

  function removeFile(index: number) {
    setUploadQueue(prev => prev.filter((_, i) => i !== index))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [])

  // --- Webcam functions (desktop) ---

  async function startWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: webcamMode === 'video',
      })
      streamRef.current = stream
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream
        videoPreviewRef.current.play()
      }
      setShowWebcam(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        toast.error('Camera access denied. Please allow camera in browser settings.')
      } else if (err.name === 'NotFoundError') {
        toast.error('No camera found on this device.')
      } else {
        toast.error('Failed to access camera.')
      }
    }
  }

  function stopWebcam() {
    if (isRecording) {
      stopRecording()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setShowWebcam(false)
    setIsRecording(false)
    setRecordingTime(0)
    setRecordingSize(0)
  }

  function capturePhoto() {
    if (!videoPreviewRef.current || !streamRef.current) return
    const video = videoPreviewRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new window.File([blob], `photo-${timestamp}.jpg`, { type: 'image/jpeg' })
      handleFiles(createFileList([file]))
      toast.success('Photo captured')
    }, 'image/jpeg', 0.92)
  }

  function startRecording() {
    if (!streamRef.current) return
    // Need audio for video recording — restart stream if audio wasn't requested
    const hasAudio = streamRef.current.getAudioTracks().length > 0
    if (!hasAudio) {
      // Restart with audio
      streamRef.current.getTracks().forEach(t => t.stop())
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      }).then((stream) => {
        streamRef.current = stream
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream
          videoPreviewRef.current.play()
        }
        beginRecording(stream)
      }).catch(() => {
        // Try without audio
        if (streamRef.current) beginRecording(streamRef.current)
      })
      return
    }
    beginRecording(streamRef.current)
  }

  function beginRecording(stream: MediaStream) {
    chunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4'

    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data)
        const totalSize = chunksRef.current.reduce((sum, c) => sum + c.size, 0)
        setRecordingSize(totalSize)
        // Auto-stop if approaching 100MB
        if (totalSize >= MAX_FILE_SIZE * 0.95) {
          toast.warning('Approaching 100MB limit, stopping recording...')
          stopRecording()
        }
      }
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const ext = mimeType.includes('webm') ? 'webm' : 'mp4'
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new window.File([blob], `video-${timestamp}.${ext}`, { type: mimeType })
      if (file.size > MAX_FILE_SIZE) {
        toast.error('Video exceeds 100MB limit')
      } else {
        handleFiles(createFileList([file]))
        toast.success(`Video recorded (${formatSize(file.size)})`)
      }
      chunksRef.current = []
    }

    recorder.start(1000) // Collect data every second for size tracking
    setIsRecording(true)
    setRecordingTime(0)
    setRecordingSize(0)

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1)
    }, 1000)
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsRecording(false)
  }

  // Helper to create a FileList-like from File array
  function createFileList(files: File[]): FileList {
    const dt = new DataTransfer()
    files.forEach(f => dt.items.add(f))
    return dt.files
  }

  async function handleUpload() {
    if (uploadQueue.length === 0) return

    setUploading(true)
    let successCount = 0

    for (let i = 0; i < uploadQueue.length; i++) {
      if (uploadQueue[i].status === 'done') {
        successCount++
        continue
      }

      setUploadQueue(prev => prev.map((entry, idx) =>
        idx === i ? { ...entry, status: 'uploading', progress: 0 } : entry
      ))

      const result = await uploadFileWithProgress(
        uploadQueue[i].file,
        { isPrivate, folderId: folderId || undefined, category: category || undefined, description: description || undefined },
        (percent) => {
          setUploadQueue(prev => prev.map((entry, idx) =>
            idx === i ? { ...entry, progress: percent } : entry
          ))
        }
      )

      setUploadQueue(prev => prev.map((entry, idx) =>
        idx === i ? {
          ...entry,
          status: result.ok ? 'done' : 'error',
          progress: result.ok ? 100 : entry.progress,
          errorMessage: result.error,
        } : entry
      ))

      if (result.ok) {
        successCount++
      } else {
        toast.error(`Failed: ${uploadQueue[i].file.name}`)
      }
    }

    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file${successCount !== 1 ? 's' : ''}`)
      onUploaded?.()
      if (successCount === uploadQueue.length) {
        handleClose()
      }
    }
    setUploading(false)
  }

  function handleClose() {
    if (uploading) return
    stopWebcam()
    setUploadQueue([])
    setIsPrivate(false)
    setCategory('')
    setDescription('')
    onClose()
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const totalSize = uploadQueue.reduce((sum, e) => sum + e.file.size, 0)
  const overallProgress = uploadQueue.length === 0 ? 0 :
    Math.round(uploadQueue.reduce((sum, e) => sum + e.progress, 0) / uploadQueue.length)
  const doneCount = uploadQueue.filter(e => e.status === 'done').length
  const errorCount = uploadQueue.filter(e => e.status === 'error').length

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Upload Files" size="xl">
      <ModalBody>
        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-md p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/30 rounded-md flex items-center justify-center mx-auto mb-3">
            <Upload size={24} className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Drag & drop files here or click to browse
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Max 100MB per file</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {/* Camera capture buttons */}
        {!showWebcam && (
          <div className="flex gap-2">
            {isTouch ? (
              <>
                {/* Mobile/Tablet: native camera via capture attribute */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); cameraPhotoRef.current?.click() }}
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <Camera size={16} />
                  Take Photo
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); cameraVideoRef.current?.click() }}
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <Video size={16} />
                  Record Video
                  <span className="text-xs text-gray-400 dark:text-gray-500">(max 100MB)</span>
                </button>
                {/* Hidden native camera inputs */}
                <input
                  ref={cameraPhotoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                <input
                  ref={cameraVideoRef}
                  type="file"
                  accept="video/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </>
            ) : (
              <>
                {/* Desktop: webcam via getUserMedia */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setWebcamMode('photo')
                    startWebcam()
                  }}
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <Camera size={16} />
                  Take Photo
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setWebcamMode('video')
                    startWebcam()
                  }}
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <Video size={16} />
                  Record Video
                  <span className="text-xs text-gray-400 dark:text-gray-500">(max 100MB)</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Desktop webcam preview */}
        {showWebcam && (
          <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden bg-black">
            <div className="relative">
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-64 object-contain bg-black"
              />
              {/* Recording indicator */}
              {isRecording && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/70 text-white px-3 py-1.5 rounded-full text-xs">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  REC {formatDuration(recordingTime)}
                  <span className="text-gray-300">({formatSize(recordingSize)} / 100MB)</span>
                </div>
              )}
            </div>

            {/* Webcam controls */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (webcamMode !== 'photo') {
                      setWebcamMode('photo')
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    webcamMode === 'photo'
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  Photo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (webcamMode !== 'video') {
                      setWebcamMode('video')
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    webcamMode === 'video'
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  Video
                </button>
              </div>

              <div className="flex items-center gap-2">
                {webcamMode === 'photo' ? (
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Circle size={14} />
                    Capture
                  </button>
                ) : isRecording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                  >
                    <Square size={14} />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                  >
                    <Circle size={14} className="fill-current" />
                    Record
                  </button>
                )}
                <button
                  type="button"
                  onClick={stopWebcam}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload queue */}
        {uploadQueue.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {uploadQueue.length} file{uploadQueue.length !== 1 ? 's' : ''} ({formatSize(totalSize)})
              </span>
              {uploading && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {doneCount}/{uploadQueue.length} completed
                  {errorCount > 0 && ` (${errorCount} failed)`}
                </span>
              )}
            </div>

            <div className="space-y-1 max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded">
              {uploadQueue.map((entry, i) => (
                <div
                  key={`${entry.file.name}-${i}`}
                  className={`flex items-center gap-3 px-3 py-2.5 ${
                    i > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''
                  } ${entry.status === 'error' ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}
                >
                  {/* File type icon */}
                  <span className="flex-shrink-0">{getFileTypeIcon(entry.file)}</span>

                  {/* Name + progress */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-900 dark:text-white truncate">{entry.file.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {formatSize(entry.file.size)}
                      </span>
                    </div>

                    {/* Per-file progress bar */}
                    {(entry.status === 'uploading' || entry.status === 'done' || entry.status === 'error') && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              entry.status === 'error'
                                ? 'bg-red-500'
                                : entry.status === 'done'
                                  ? 'bg-green-500'
                                  : 'bg-blue-500'
                            }`}
                            style={{ width: `${entry.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500 w-8 text-right flex-shrink-0">
                          {entry.progress}%
                        </span>
                      </div>
                    )}

                    {/* Error message */}
                    {entry.status === 'error' && entry.errorMessage && (
                      <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{entry.errorMessage}</p>
                    )}
                  </div>

                  {/* Status / remove button */}
                  <div className="flex-shrink-0">
                    {entry.status === 'done' ? (
                      <CheckCircle2 size={18} className="text-green-500" />
                    ) : entry.status === 'error' ? (
                      <AlertCircle size={18} className="text-red-500" />
                    ) : entry.status === 'uploading' ? (
                      <Loader2 size={18} className="text-blue-500 animate-spin" />
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                        className="p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Options */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. damage, document"
              className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={uploading}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
                disabled={uploading}
              />
              Private file
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={uploading}
          />
        </div>

        {/* Overall progress bar */}
        {uploading && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Overall Progress</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{overallProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button
          onClick={handleClose}
          disabled={uploading}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleUpload}
          disabled={uploading || uploadQueue.length === 0}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {uploading && <Loader2 size={14} className="animate-spin" />}
          {uploading
            ? `Uploading... ${overallProgress}%`
            : `Upload ${uploadQueue.length > 0 ? `(${uploadQueue.length})` : ''}`
          }
        </button>
      </ModalFooter>
    </Modal>
  )
}
