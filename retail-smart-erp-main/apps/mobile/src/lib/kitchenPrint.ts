// Kitchen tickets on the mobile POS (restaurant businesses). Prints on the kitchen-role printer
// with the pure builder in ./kitchenTicket (byte-identical to the web KOT). No kitchen printer
// configured → skipped silently. The hook remembers what was already sent for the current cart
// (keyed by its clientSaleId), so "Send to kitchen" prints only new lines, "+n" increases and
// VOID lines, and completing the sale prints whatever is still unsent.
import { useCallback, useRef } from 'react'
import { Alert } from 'react-native'
import { getPrinterForRole, printBytes } from './printer'
import {
  applyKitchenPlan,
  buildKitchenTicket,
  isEmptyKitchenPlan,
  kitchenPlanTicketItems,
  planKitchenSend,
  type KitchenSentMap,
  type KitchenTicketInput,
} from './kitchenTicket'

export type KitchenPrintResult = 'printed' | 'skipped' | 'failed'

export async function printKitchenTicketMobile(input: KitchenTicketInput): Promise<KitchenPrintResult> {
  if (!input.items.length) return 'skipped'
  try {
    const p = await getPrinterForRole('kitchen')
    if (!p || p.transport === 'none') return 'skipped'
    await printBytes(buildKitchenTicket(input, { paperWidth: p.paperWidth }), p)
    return 'printed'
  } catch (e) {
    console.warn('Kitchen ticket print failed:', e instanceof Error ? e.message : String(e))
    return 'failed'
  }
}

interface KitchenCartLike {
  id: string
  itemId?: string
  name: string
  quantity: number
}

export function useKitchenTickets(opts: { enabled: boolean; orderKey: string | null; server?: string | null }) {
  const state = useRef<{ key: string | null; sent: KitchenSentMap }>({ key: null, sent: {} })

  const send = useCallback(
    async (cart: KitchenCartLike[], mode: 'manual' | 'sale'): Promise<KitchenPrintResult> => {
      if (!opts.enabled) return 'skipped'
      const key = opts.orderKey
      if (state.current.key !== key) state.current = { key, sent: {} }
      const plan = planKitchenSend(
        cart.filter((c) => c.quantity > 0).map((c) => ({ cartLineId: c.id, itemId: c.itemId || c.id, name: c.name, quantity: c.quantity })),
        state.current.sent
      )
      // Sale completed: this cart is done, whatever happens with the print.
      const sentBefore = state.current.sent
      if (mode === 'sale') state.current = { key: null, sent: {} }
      if (isEmptyKitchenPlan(plan)) {
        if (mode === 'manual') Alert.alert('Kitchen', 'Nothing new to send to the kitchen.')
        return 'skipped'
      }
      const result = await printKitchenTicketMobile({
        orderNo: (key || 'ORDER').slice(0, 8).toUpperCase(),
        server: opts.server || null,
        time: new Date(),
        items: kitchenPlanTicketItems(plan),
      })
      if (mode === 'manual') {
        if (result === 'printed' && state.current.key === key) state.current = { key, sent: applyKitchenPlan(sentBefore, plan) }
        if (result === 'failed') Alert.alert('Kitchen', 'The kitchen ticket did not print. Check the kitchen printer and try again.')
      }
      return result
    },
    [opts.enabled, opts.orderKey, opts.server]
  )

  return { enabled: opts.enabled, send }
}
