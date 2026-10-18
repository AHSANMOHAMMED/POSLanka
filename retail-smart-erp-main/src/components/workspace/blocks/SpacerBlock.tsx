'use client'

import type { SpacerBlock as SpacerBlockType } from '@/lib/workspace/types'

export function SpacerBlock({ block }: { block: SpacerBlockType }) {
  return <div style={{ height: block.data.height || 16 }} />
}
