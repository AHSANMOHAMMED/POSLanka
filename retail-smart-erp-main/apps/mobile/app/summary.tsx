import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native'
import { router } from 'expo-router'
import { THEME, formatLKR } from '../src/lib/theme'

export default function ManagerDailySummaryScreen() {
  const summary = {
    grossSales: 489250.0,
    netSales: 477018.75,
    transactionsCount: 142,
    avgBasketSize: 3445.42,
    ssclTax: 12231.25,
    discountsGiven: 14850.0,
    payments: [
      { method: 'Cash in Register', amount: 165400.0, pct: '34%' },
      { method: 'Visa / Mastercard (LankaPay)', amount: 242650.0, pct: '50%' },
      { method: 'LankaQR Instant (FriMi/Genie)', amount: 62200.0, pct: '13%' },
      { method: 'Customer Credit Ledger', amount: 19000.0, pct: '3%' },
    ],
    categories: [
      { name: 'Dairy & Chilled', sales: 184500.0, items: 210 },
      { name: 'Bakery & Biscuits', sales: 112400.0, items: 340 },
      { name: 'Beverages', sales: 98200.0, items: 165 },
      { name: 'Household & Cleaning', sales: 94150.0, items: 88 },
    ],
  }

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
          <Text style={styles.headerTitle}>Manager Daily Summary</Text>
          <Text style={styles.headerSub}>WH-COL03 • Today's Trading</Text>
        </View>
        <View style={styles.syncBadge}>
          <Text style={styles.syncBadgeText}>● RAMIS OK</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Gross Sales Card */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Total Gross Revenue</Text>
          <Text style={styles.heroValue}>{formatLKR(summary.grossSales)}</Text>

          <View style={styles.heroSubRow}>
            <View style={styles.heroSubItem}>
              <Text style={styles.heroSubLabel}>Transactions</Text>
              <Text style={styles.heroSubValue}>{summary.transactionsCount} bills</Text>
            </View>
            <View style={styles.heroSubItem}>
              <Text style={styles.heroSubLabel}>Avg Basket</Text>
              <Text style={styles.heroSubValue}>{formatLKR(summary.avgBasketSize)}</Text>
            </View>
            <View style={styles.heroSubItem}>
              <Text style={styles.heroSubLabel}>SSCL (2.5%)</Text>
              <Text style={styles.heroSubValue}>{formatLKR(summary.ssclTax)}</Text>
            </View>
          </View>
        </View>

        {/* Payment Tender Matrix */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tender & Settlements Breakdown</Text>
          <View style={styles.listContainer}>
            {summary.payments.map((p, idx) => (
              <View key={idx} style={styles.listItem}>
                <View>
                  <Text style={styles.itemTitle}>{p.method}</Text>
                  <Text style={styles.itemSubtitle}>{p.pct} of total volume</Text>
                </View>
                <Text style={styles.itemAmount}>{formatLKR(p.amount)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Top Department Sales */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Department Performance</Text>
          <View style={styles.listContainer}>
            {summary.categories.map((c, idx) => (
              <View key={idx} style={styles.listItem}>
                <View>
                  <Text style={styles.itemTitle}>{c.name}</Text>
                  <Text style={styles.itemSubtitle}>{c.items} units sold</Text>
                </View>
                <Text style={styles.itemAmount}>{formatLKR(c.sales)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Store Sign-Off Banner */}
        <View style={styles.closingBanner}>
          <Text style={{ fontSize: 24 }}>🛡️</Text>
          <View style={styles.closingBannerText}>
            <Text style={styles.closingTitle}>Day Trading Reconciled</Text>
            <Text style={styles.closingSubtitle}>
              All register sessions balanced. Ready for end-of-day closing entry.
            </Text>
          </View>
        </View>
      </ScrollView>
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
  syncBadge: {
    backgroundColor: THEME.colors.tertiaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: THEME.radius.sm,
  },
  syncBadgeText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: THEME.colors.tertiary,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: THEME.spacing.lg,
    paddingBottom: 40,
    gap: 16,
  },
  heroCard: {
    backgroundColor: THEME.colors.primary,
    borderRadius: THEME.radius.xl,
    padding: 20,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3,
  },
  heroLabel: {
    fontSize: 11,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '700',
  },
  heroValue: {
    fontSize: 28,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: THEME.colors.onPrimary,
    marginTop: 4,
    marginBottom: 16,
  },
  heroSubRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: 12,
  },
  heroSubItem: {
    flex: 1,
  },
  heroSubLabel: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
  },
  heroSubValue: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: THEME.colors.onPrimary,
    marginTop: 2,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.text,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
  },
  listContainer: {
    backgroundColor: THEME.colors.card,
    borderRadius: THEME.radius.lg,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  itemSubtitle: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    marginTop: 1,
  },
  itemAmount: {
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: THEME.colors.text,
  },
  closingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: THEME.colors.primaryLight,
    padding: 16,
    borderRadius: THEME.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(15, 118, 110, 0.2)',
  },
  closingBannerText: {
    flex: 1,
  },
  closingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  closingSubtitle: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
})
