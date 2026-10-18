'use client'

import { useState, useRef, useEffect } from 'react'
import { Upload, X, Loader2, Image as ImageIcon, Crop } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface LogoUploadProps {
  /** Current logo URL (if any) */
  currentLogoUrl?: string | null
  /** Callback when logo is successfully uploaded */
  onLogoUploaded: (logoUrl: string) => void
  /** Callback when logo is removed */
  onLogoRemoved?: () => void
  /** Whether the upload is in progress */
  uploading?: boolean
  /** Maximum file size in MB */
  maxSizeMB?: number
  /** Whether to show remove button */
  showRemoveButton?: boolean
  /** Acceptable file types */
  accept?: string
  /** Auto-upload immediately after file selection (useful in setup wizards) */
  autoUpload?: boolean
}

export function LogoUpload({
  currentLogoUrl,
  onLogoUploaded,
  onLogoRemoved,
  uploading = false,
  maxSizeMB = 2,
  showRemoveButton = true,
  accept = 'image/png,image/jpeg,image/jpg,image/webp',
  autoUpload = false,
}: LogoUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Set preview URL from current logo or selected file
  useEffect(() => {
    if (currentLogoUrl && !selectedFile) {
      setPreviewUrl(currentLogoUrl)
    } else if (selectedFile) {
      const url = URL.createObjectURL(selectedFile)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setPreviewUrl(null)
    }
  }, [currentLogoUrl, selectedFile])

  // Function to resize image on client side
  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const canvas = canvasRef.current || document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      img.onload = () => {
        URL.revokeObjectURL(img.src)
        // Calculate new dimensions (max 500px on the longest side)
        const maxDimension = 500
        let width = img.width
        let height = img.height

        if (width > height && width > maxDimension) {
          height = (height * maxDimension) / width
          width = maxDimension
        } else if (height > maxDimension) {
          width = (width * maxDimension) / height
          height = maxDimension
        }

        canvas.width = Math.round(width)
        canvas.height = Math.round(height)

        // Draw resized image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        // Convert to blob (quality param only applies to JPEG/WebP)
        const quality = ['image/jpeg', 'image/webp'].includes(file.type) ? 0.85 : undefined
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Failed to create blob'))
            }
          },
          file.type,
          quality
        )
      }

      img.onerror = () => {
        URL.revokeObjectURL(img.src)
        reject(new Error('Failed to load image'))
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const uploadFile = async (file: File) => {
    const formData = new FormData()
    formData.append('logo', file)

    try {
      const response = await fetch('/api/settings/logo', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }

      const data = await response.json()
      onLogoUploaded(data.logoUrl)
      setSelectedFile(null)
      toast.success('Logo uploaded successfully!')
    } catch (error) {
      console.error('Logo upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to upload logo')
    }
  }

  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return

    const file = fileList[0]

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: PNG, JPEG, WebP')
      return
    }

    // Validate file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024
    let finalFile = file

    if (file.size > maxSizeBytes) {
      // For images larger than max size, try to resize
      try {
        const resizedBlob = await resizeImage(file)
        finalFile = new File([resizedBlob], file.name, {
          type: file.type,
          lastModified: Date.now(),
        })
      } catch (error) {
        console.error('Failed to resize image:', error)
        toast.error(`File too large. Maximum ${maxSizeMB}MB`)
        return
      }
    }

    if (autoUpload) {
      setSelectedFile(finalFile)
      await uploadFile(finalFile)
    } else {
      setSelectedFile(finalFile)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    await uploadFile(selectedFile)
  }

  const handleRemove = async () => {
    try {
      const response = await fetch('/api/settings/logo', {
        method: 'DELETE',
      })

      if (response.ok) {
        setSelectedFile(null)
        setPreviewUrl(null)
        onLogoRemoved?.()
        toast.success('Logo removed successfully!')
      } else {
        throw new Error('Failed to remove logo')
      }
    } catch (error) {
      console.error('Logo removal error:', error)
      toast.error('Failed to remove logo')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      {/* Hidden canvas for image resizing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Preview and Upload Area */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* Preview */}
        <div className="flex-shrink-0">
          <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded flex items-center justify-center bg-gray-50 overflow-hidden">
            {previewUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt="Logo preview"
                className="w-full h-full object-contain p-2"
              />
            ) : selectedFile ? (
              <div className="text-center p-4">
                <ImageIcon size={32} className="mx-auto text-gray-400 mb-2" />
                <p className="text-xs text-gray-500 truncate">{selectedFile.name}</p>
                <p className="text-xs text-gray-400">{formatSize(selectedFile.size)}</p>
              </div>
            ) : (
              <ImageIcon size={32} className="text-gray-400" />
            )}
          </div>
        </div>

        {/* Upload Controls */}
        <div className="flex-1 space-y-4">
          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded p-6 text-center transition-colors cursor-pointer ${
              dragOver
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={28} className="mx-auto mb-3 text-gray-400" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Drag & drop or click to upload
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              PNG, JPEG, WebP • Max {maxSizeMB}MB
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Image will be automatically resized to max 500px
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />
          </div>

          {/* Selected File Info */}
          {selectedFile && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon size={16} className="text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                    {selectedFile.name}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-gray-400 hover:text-red-500"
                  disabled={uploading}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formatSize(selectedFile.size)} • Ready to upload
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {selectedFile && (
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    Upload Logo
                  </>
                )}
              </button>
            )}

            {showRemoveButton && currentLogoUrl && !selectedFile && (
              <button
                onClick={handleRemove}
                disabled={uploading}
                className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <X size={14} />
                Remove Logo
              </button>
            )}

            {!selectedFile && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm font-medium flex items-center gap-2"
              >
                <Crop size={14} />
                Choose Different File
              </button>
            )}
          </div>

          {/* Help Text */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <p className="mb-1">• Logo will appear on invoices, receipts, and reports</p>
            <p>• Recommended: Square image, transparent background, at least 200×200 pixels</p>
          </div>
        </div>
      </div>
    </div>
  )
}