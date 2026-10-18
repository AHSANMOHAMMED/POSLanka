'use client'

import { useState } from 'react'
import { Download, AlertCircle } from 'lucide-react'

interface VideoPlayerProps {
  filePath: string
  fileName: string
  fileType: string
}

export default function VideoPlayer({ filePath, fileName, fileType }: VideoPlayerProps) {
  const [error, setError] = useState(false)

  // Some formats have no browser support
  const unsupportedFormats = ['video/x-msvideo', 'video/x-matroska']
  const isKnownUnsupported = unsupportedFormats.includes(fileType) ||
    fileName.endsWith('.avi') || fileName.endsWith('.mkv')

  if (isKnownUnsupported || error) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <AlertCircle size={48} className="text-amber-400 mb-4" />
        <p className="text-lg mb-2">Video format not supported in browser</p>
        <p className="text-sm text-gray-400 mb-4">
          {fileType || fileName.split('.').pop()?.toUpperCase()} files cannot be played in the browser. Please download to view.
        </p>
        <a
          href={filePath}
          download={fileName}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition flex items-center gap-2"
        >
          <Download size={16} />
          Download {fileName}
        </a>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl mx-auto flex items-center justify-center p-4">
      <video
        src={filePath}
        controls
        controlsList="nodownload"
        className="max-w-full max-h-[calc(100vh-10rem)] rounded shadow-lg bg-black"
        onError={() => setError(true)}
      >
        Your browser does not support this video format.
      </video>
    </div>
  )
}
