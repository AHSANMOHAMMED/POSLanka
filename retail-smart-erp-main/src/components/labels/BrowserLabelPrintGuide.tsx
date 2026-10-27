'use client'

/**
 * Short checklist shown before labels go to Chrome's print dialog (L6).
 *
 * Chrome prints one page per sticker row at exactly <roll width> x <label
 * height>; the printer driver must have that paper size, or the printer feeds
 * several stickers per page. Three steps, once per printer: install the
 * driver for the printer model, set the paper size, then the Chrome options.
 */
import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { stickerRollWidthMm, type StickerSetup } from '@/lib/labels/sticker-stock'

const HIDE_KEY = 'sky_label_dialog_guide_hidden'

const sizeKey = (s: StickerSetup) => `${stickerRollWidthMm(s)}x${s.labelHeightMm}`

/** True when the user ticked "don't show again" for this page size. */
export function browserGuideHidden(setup: StickerSetup): boolean {
  try {
    return (JSON.parse(localStorage.getItem(HIDE_KEY) || '[]') as string[]).includes(sizeKey(setup))
  } catch {
    return false
  }
}

function hideGuide(setup: StickerSetup) {
  try {
    const list = JSON.parse(localStorage.getItem(HIDE_KEY) || '[]') as string[]
    if (!list.includes(sizeKey(setup))) localStorage.setItem(HIDE_KEY, JSON.stringify([...list, sizeKey(setup)].slice(-20)))
  } catch {
    /* private mode */
  }
}

export interface BrowserLabelPrintGuideProps {
  isOpen: boolean
  setup: StickerSetup
  /** Physical rows (= pages) of this job. */
  rows: number
  /** Continuous roll (printer can't find the gaps): the page already includes the gap, media type Continuous. */
  continuous?: boolean
  onClose: () => void
  onContinue: () => void
  onAlignmentTest: () => void
}

export function BrowserLabelPrintGuide({ isOpen, setup, rows, continuous, onClose, onContinue, onAlignmentTest }: BrowserLabelPrintGuideProps) {
  const [dontShow, setDontShow] = useState(false)
  const W = stickerRollWidthMm(setup)
  const H = setup.labelHeightMm
  const gap = setup.rowGapMm
  const paper = `${W} x ${H} mm`
  const go = () => {
    if (dontShow) hideGuide(setup)
    onContinue()
  }
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Print with Chrome"
      size="2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            Done, don&apos;t show again
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onAlignmentTest} className="px-3 py-2 text-sm border rounded bg-white hover:bg-gray-50 font-medium">
              Test print (2 rows)
            </button>
            <button type="button" onClick={go} className="px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 font-medium flex items-center gap-1.5">
              <Printer size={15} /> Print
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-gray-800 dark:text-gray-200">
        <p className="text-gray-600 dark:text-gray-400">
          {rows} page{rows === 1 ? '' : 's'} of <b>{paper}</b>, one row of {setup.columns} sticker{setup.columns === 1 ? '' : 's'} per page. Set up once per printer:
        </p>
        <ol className="list-decimal ml-5 space-y-2">
          <li>
            <b>Install the driver</b> for your printer model from the maker&apos;s website (Xprinter, TSC, Zebra, Godex ...).
          </li>
          <li>
            <b>Set the paper size</b> in the driver to <b>{W} mm wide x {H} mm high</b>,{' '}
            {continuous ? (
              <>
                media type <b>Continuous</b> (not labels with gaps), and make it the default.
              </>
            ) : (
              <>labels with gaps (gap {gap} mm), and make it the default.</>
            )}
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              Windows: Settings → Printers → your printer → Printing preferences → Page Setup / Stock → New. Mac: in Chrome press ⌥⌘P → Paper Size →
              Manage Custom Sizes.
            </div>
          </li>
          <li>
            <b>In Chrome&apos;s print window</b>: pick the printer, click <b>More settings</b>, then Paper size <b>{paper}</b>, Margins <b>None</b>, Scale{' '}
            <b>Default</b>, untick <b>Headers and footers</b>.
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              If {paper} is not in Chrome&apos;s Paper size list, it is missing in the driver: do step 2 first. Chrome cannot make new paper sizes.
            </div>
          </li>
        </ol>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Not sure? Use <b>Test print</b>: stickers numbered {Array.from({ length: setup.columns * 2 }, (_, i) => i + 1).join(', ')} must come out in order.
          If not, fix the paper size in step 2.
        </p>
      </div>
    </Modal>
  )
}
