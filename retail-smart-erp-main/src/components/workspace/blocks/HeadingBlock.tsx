'use client'

import type { HeadingBlock as HeadingBlockType } from '@/lib/workspace/types'

export function HeadingBlock({ block }: { block: HeadingBlockType }) {
  const { text, level } = block.data
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4'

  const styles = {
    2: 'text-lg font-bold text-gray-900 dark:text-white',
    3: 'text-base font-semibold text-gray-800 dark:text-gray-100',
    4: 'text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider',
  }

  return <Tag className={styles[level]}>{text}</Tag>
}
