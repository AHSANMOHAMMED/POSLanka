'use client'

/**
 * Checklist shown before labels go to Chrome's print dialog (L6).
 *
 * Chrome lays out one page per sticker row at exactly <roll width> x <label
 * height>, but the printer DRIVER decides the paper: if its paper size is not
 * that size (Zebra default 4x6 in, 2x1 in ...) the printer feeds several
 * stickers per page - blank stickers, labels out of order. Software in the
 * browser cannot change the driver, so this panel tells the user exactly
 * what to set (once), offers a 2-row alignment test, and recommends the
 * direct (raw) path when the print agent is available.
 */
import { useState } from 'react'
import { AlertTriangle, Printer, Zap } from 'lucide-react'
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
  agentAvailable?: boolean
  onClose: () => void
  onContinue: () => void
  onAlignmentTest: () => void
}

export function BrowserLabelPrintGuide({ isOpen, setup, rows, agentAvailable, onClose, onContinue, onAlignmentTest }: BrowserLabelPrintGuideProps) {
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
      title="Before the print dialog: paper size"
      size="2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            Done - don&apos;t show again for {paper}
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onAlignmentTest} className="px-3 py-2 text-sm border rounded bg-white hover:bg-gray-50 font-medium">
              Print alignment test (2 rows)
            </button>
            <button type="button" onClick={go} className="px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 font-medium flex items-center gap-1.5">
              <Printer size={15} /> Open print dialog
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-gray-800 dark:text-gray-200">
        {agentAvailable ? (
          <div className="p-2.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 text-xs flex gap-2">
            <Zap size={14} className="shrink-0 mt-0.5" />
            <span>
              The print agent is running on this PC: use <b>Print directly</b> (Printer box) instead - no dialog and no paper-size setup needed.
            </span>
          </div>
        ) : (
          <div className="p-2.5 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              The dialog prints {rows} page{rows === 1 ? '' : 's'} of exactly <b>{paper}</b> (one row of {setup.columns} sticker{setup.columns === 1 ? '' : 's'} each).
              If the printer driver&apos;s paper is a different size (Zebra default 4 x 6 in, 2 x 1 in ...) the printer feeds several stickers per page: blank
              stickers and labels out of order. Set the paper size once:
            </span>
          </div>
        )}

        <ol className="list-decimal ml-5 space-y-2">
          <li>
            <b>Printer driver</b>: create a paper / stock of <b>{W} mm wide x {H} mm high</b> (the whole row, not one sticker), media{' '}
            <b>Labels with gaps</b> (gap / web sensing), gap <b>{gap} mm</b>, and make it the default. Once per printer, on any computer:
            <ul className="list-disc ml-5 mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
              <li>
                <b>Windows:</b> Settings → Printers &amp; scanners → your label printer → <i>Printing preferences</i> (brand steps below).
              </li>
              <li>
                <b>Mac:</b> in Chrome press <b>⌥⌘P</b> (Print using system dialog) → Paper Size → <i>Manage Custom Sizes…</i> → <b>+</b> → Width {W} mm,
                Height {H} mm, all margins 0 → OK, choose it and <i>Presets → Save Current Settings as Preset</i>.
              </li>
              <li>
                <b>Linux:</b> open <code>http://localhost:631/printers</code> → your printer → <i>Set Default Options</i> → Media Size <b>Custom {W} x {H} mm</b>{' '}
                (or run <code>lpoptions -p PRINTER -o media=Custom.{W}x{H}mm</code>), media type Labels with gaps.
              </li>
              <li>
                <b>Zebra (ZDesigner driver):</b> Printing Preferences → Page Setup → Stocks → <i>New</i> → Width {W} mm, Height {H} mm, Type &quot;Label with gaps&quot;,
                Gap {gap} mm → OK, then pick it as the stock. Advanced Setup → keep speed 4, darkness ~20.
              </li>
              <li>
                <b>Xprinter / TSC / DBL / Gprinter:</b> Printing Preferences → Page Setup → <i>New</i> (or &quot;Stock&quot;) → name &quot;{paper}&quot;, width {W}, height {H} →
                Media: &quot;Labels with gaps&quot;, gap {gap} mm, offset 0 → OK and select it. Then run the printer&apos;s <i>Calibrate</i> (or hold FEED until it
                feeds one label).
              </li>
            </ul>
          </li>
          <li>
            <b>Chrome print window:</b> Destination = the label printer → More settings → Paper size = <b>{paper}</b>, Margins = <b>None</b>, Scale ={' '}
            <b>Default (100)</b>, Pages per sheet = 1, <b>untick Headers and footers</b>.
          </li>
          <li>
            Print the <b>alignment test</b> first: 2 rows numbered {Array.from({ length: setup.columns * 2 }, (_, i) => i + 1).join(', ')} in order, each with a
            border just inside the sticker. If the numbers are out of order or stickers are skipped, the paper size (step 1) is not right yet.
          </li>
        </ol>
      </div>
    </Modal>
  )
}
