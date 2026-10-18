import { create } from 'zustand'

interface FileClipboardState {
  mode: 'copy' | 'cut' | null
  fileIds: string[]
  sourceFolder: string | null

  copy: (fileIds: string[], sourceFolder: string | null) => void
  cut: (fileIds: string[], sourceFolder: string | null) => void
  clear: () => void
}

export const useFileClipboard = create<FileClipboardState>((set) => ({
  mode: null,
  fileIds: [],
  sourceFolder: null,

  copy: (fileIds, sourceFolder) => set({ mode: 'copy', fileIds, sourceFolder }),
  cut: (fileIds, sourceFolder) => set({ mode: 'cut', fileIds, sourceFolder }),
  clear: () => set({ mode: null, fileIds: [], sourceFolder: null }),
}))
