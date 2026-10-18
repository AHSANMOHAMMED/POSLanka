'use client'

import type { ParagraphBlock as ParagraphBlockType } from '@/lib/workspace/types'

export function ParagraphBlock({ block }: { block: ParagraphBlockType }) {
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
      {block.data.text}
    </p>
  )
}
