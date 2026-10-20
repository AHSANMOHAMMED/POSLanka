import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native'
import { router } from 'expo-router'
import { THEME } from '../src/lib/theme'
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal'

interface StockMovement {
  id: string
  sku: string
  itemName: string
  batchNo: string
  type: 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER'
  quantity: number
  balanceAfter: number
  location: string
  timestamp: string
}

const SAMPLE_MOVEMENTS: StockMovement[] = [
  {
    id: '1',
    sku: 'DAIR-1049',
    itemName: 'Anchor Full Cream Milk Powder 400g',
    batchNo: 'BAT-2026-X81',
    type: 'IN',
    quantity: 120,
    balanceAfter: 284,
    location: 'Aisle 03 • Bay B',
    timestamp: 'Today, 11:20 AM',
  },
  {
    id: '2',
    sku: 'BISK-0021',
    itemName: 'Munchee Super Cream Cracker 490g',
    batchNo: 'BAT-2026-B12',
    type: 'OUT',
    quantity: -4,
    balanceAfter: 42,
    location: 'Register #02 POS',
    timestamp: 'Today, 11:14 AM',
  },
  {
    id: '3',
    sku: 'BEV-4410',
    itemName: 'Dilmah Premium Ceylon Tea 100 Bags',
    batchNo: 'BAT-2026-T90',
    type: 'TRANSFER',
    quantity: -25,
    balanceAfter: 75,
    location: 'Transfer to Kandy WH-KND01',
    timestamp: 'Today, 10:45 AM',
  },
  {
    id: '4',
    sku: 'SNK-0841',
    itemName: 'Maliban Gold Marie 300g',
    batchNo: 'BAT-2026-M04',
    type: 'ADJUST',
    quantity: -2,
    balanceAfter: 18,
    location: 'Damaged Packaging Write-off',
    timestamp: 'Today, 09:30 AM',
  },
]

export default function InventoryScreen() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT' | 'ADJUST'>('ALL')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [movements] = useState<StockMovement[]>(SAMPLE_MOVEMENTS)

  const filteredMovements = movements.filter(m => {
    if (filterType !== 'ALL' && m.type !== filterType) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        m.itemName.toLowerCase().includes(q) ||
        m.sku.toLowerCase().includes(q) ||
        m.batchNo.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <View style={styles.safe}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Stock Ledger & Movements</Text>
          <Text style={styles.headerSub}>WH-COL03 • Aisle & Bin Tracker</Text>
        </View>
        <TouchableOpacity
          onPress={() => setIsScannerOpen(true)}
          style={styles.scanBtn}
        >
          <Text style={styles.scanBtnText}>[|||]</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {/* KPI Strip */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total SKUs</Text>
            <Text style={styles.kpiValue}>1,420</Text>
            <Text style={styles.kpiSub}>Active inventory</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Low Stock</Text>
            <Text style={[styles.kpiValue, { color: THEME.colors.secondaryAmber }]}>14 SKUs</Text>
            <Text style={styles.kpiSub}>Below reorder</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>GRN Pending</Text>
            <Text style={[styles.kpiValue, { color: THEME.colors.tertiary }]}>3 Loads</Text>
            <Text style={styles.kpiSub}>Inward today</Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search SKU, item name or batch..."
            placeholderTextColor={THEME.colors.textSubtle}
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Pills */}
        <View style={styles.filterRow}>
          {[
            { id: 'ALL', label: 'All Movements' },
            { id: 'IN', label: 'Stock In' },
            { id: 'OUT', label: 'POS Sales' },
            { id: 'ADJUST', label: 'Adjustments' },
          ].map(f => (
            <TouchableOpacity
              key={f.id}
              onPress={() => setFilterType(f.id as typeof filterType)}
              style={[
                styles.filterPill,
                filterType === f.id && styles.filterPillActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filterType === f.id && styles.filterPillTextActive,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Movements Feed */}
        <View style={styles.movementList}>
          {filteredMovements.map(item => (
            <View key={item.id} style={styles.movementCard}>
              <View style={styles.cardHeader}>
                <View style={styles.badgeRow}>
                  <View
                    style={[
                      styles.typeBadge,
                      item.type === 'IN' && styles.typeBadgeIn,
                      item.type === 'OUT' && styles.typeBadgeOut,
                      item.type === 'ADJUST' && styles.typeBadgeAdjust,
                      item.type === 'TRANSFER' && styles.typeBadgeTransfer,
                    ]}
                  >
                    <Text
                      style={[
                        styles.typeBadgeText,
                        item.type === 'IN' && styles.typeBadgeTextIn,
                        item.type === 'OUT' && styles.typeBadgeTextOut,
                        item.type === 'ADJUST' && styles.typeBadgeTextAdjust,
                        item.type === 'TRANSFER' && styles.typeBadgeTextTransfer,
                      ]}
                    >
                      {item.type === 'IN' && 'STOCK IN (GRN)'}
                      {item.type === 'OUT' && 'POS SALE'}
                      {item.type === 'ADJUST' && 'ADJUSTMENT'}
                      {item.type === 'TRANSFER' && 'TRANSFER'}
                    </Text>
                  </View>
                  <Text style={styles.skuText}>{item.sku}</Text>
                </View>

                <Text style={styles.timeText}>{item.timestamp}</Text>
              </View>

              <Text style={styles.itemName}>{item.itemName}</Text>

              <View style={styles.detailsRow}>
                <Text style={styles.batchText}>Batch: {item.batchNo}</Text>
                <Text style={styles.locationText}>{item.location}</Text>
              </View>

              <View style={styles.cardFooter}>
                <Text style={styles.balanceText}>
                  Balance: <Text style={styles.balanceValue}>{item.balanceAfter} units</Text>
                </Text>

                <Text
                  style={[
                    styles.quantityText,
                    item.quantity > 0 ? styles.quantityIn : styles.quantityOut,
                  ]}
                >
                  {item.quantity > 0 ? `+${item.quantity}` : `${item.quantity}`} units
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        visible={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onBarcodeScanned={(barcode) => {
          setSearchQuery(barcode)
          setIsScannerOpen(false)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: THEME.colors.surface,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: THEME.spacing.lg,
    backgroundColor: THEME.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: THEME.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  headerSub: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
  },
  scanBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: THEME.radius.md,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnText: {
    color: THEME.colors.onPrimary,
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 12,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: THEME.spacing.lg,
    paddingBottom: 40,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: THEME.spacing.md,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: THEME.colors.card,
    padding: 10,
    borderRadius: THEME.radius.lg,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  kpiLabel: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
    textTransform: 'uppercase',
  },
  kpiValue: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
    color: THEME.colors.primary,
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 9,
    color: THEME.colors.textSubtle,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: THEME.colors.card,
    borderRadius: THEME.radius.lg,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: THEME.spacing.md,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: THEME.colors.text,
  },
  clearIcon: {
    fontSize: 14,
    color: THEME.colors.textMuted,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: THEME.spacing.lg,
    flexWrap: 'wrap',
  },
  filterPill: {
    backgroundColor: THEME.colors.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: THEME.radius.full,
  },
  filterPillActive: {
    backgroundColor: THEME.colors.primary,
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.textMuted,
  },
  filterPillTextActive: {
    color: THEME.colors.onPrimary,
  },
  movementList: {
    gap: 10,
  },
  movementCard: {
    backgroundColor: THEME.colors.card,
    borderRadius: THEME.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: THEME.radius.xs,
  },
  typeBadgeIn: {
    backgroundColor: THEME.colors.tertiaryLight,
  },
  typeBadgeOut: {
    backgroundColor: THEME.colors.surfaceContainerHigh,
  },
  typeBadgeAdjust: {
    backgroundColor: THEME.colors.secondaryLight,
  },
  typeBadgeTransfer: {
    backgroundColor: '#EFF6FF',
  },
  typeBadgeText: {
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  typeBadgeTextIn: {
    color: THEME.colors.tertiary,
  },
  typeBadgeTextOut: {
    color: THEME.colors.textMuted,
  },
  typeBadgeTextAdjust: {
    color: THEME.colors.secondary,
  },
  typeBadgeTextTransfer: {
    color: '#2563EB',
  },
  skuText: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
  },
  timeText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: THEME.colors.textSubtle,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  batchText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: THEME.colors.textMuted,
  },
  locationText: {
    fontSize: 10,
    color: THEME.colors.textSubtle,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    marginTop: 2,
  },
  balanceText: {
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  balanceValue: {
    fontWeight: '700',
    color: THEME.colors.text,
    fontFamily: 'monospace',
  },
  quantityText: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  quantityIn: {
    color: THEME.colors.tertiary,
  },
  quantityOut: {
    color: THEME.colors.text,
  },
})
