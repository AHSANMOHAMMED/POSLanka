'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Radio,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Receipt,
  DollarSign,
  Zap,
  ShoppingBag,
  CheckCircle2,
  Building,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'

type Transaction = {
  id: string
  receiptHash: string
  time: string
  merchant: string
  slug: string
  province: string
  sector: 'Supermarket' | 'Auto Care' | 'Textiles' | 'Dining' | 'Healthcare'
  till: string
  cashier: string
  itemCount: number
  paymentMethod: 'LankaQR' | 'VISA' | 'Mastercard' | 'Cash' | 'Koko'
  ramisStatus: 'Fiscalized' | 'Pending' | 'Exempt'
  amount: number
}

const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-101',
    receiptHash: 'REC-CMB-89412',
    time: '14:52:18',
    merchant: 'Keells Super - Crescat Boulevard',
    slug: 'keells-crescat',
    province: 'Western',
    sector: 'Supermarket',
    till: 'POS-04',
    cashier: 'N. Perera',
    itemCount: 14,
    paymentMethod: 'LankaQR',
    ramisStatus: 'Fiscalized',
    amount: 14250.0,
  },
  {
    id: 'tx-102',
    receiptHash: 'REC-KND-39211',
    time: '14:52:14',
    merchant: 'Cargills Food City - Kandy City Centre',
    slug: 'cargills-kcc',
    province: 'Central',
    sector: 'Supermarket',
    till: 'POS-02',
    cashier: 'M. Bandara',
    itemCount: 8,
    paymentMethod: 'VISA',
    ramisStatus: 'Fiscalized',
    amount: 8940.0,
  },
  {
    id: 'tx-103',
    receiptHash: 'REC-GLL-58291',
    time: '14:52:09',
    merchant: 'Toyota Lanka Auto Service - Galle',
    slug: 'toyota-galle',
    province: 'Southern',
    sector: 'Auto Care',
    till: 'POS-01',
    cashier: 'K. Silva',
    itemCount: 3,
    paymentMethod: 'Mastercard',
    ramisStatus: 'Fiscalized',
    amount: 84500.0,
  },
  {
    id: 'tx-104',
    receiptHash: 'REC-CMB-77128',
    time: '14:52:05',
    merchant: 'Odel Department Store - Colombo 07',
    slug: 'odel-alexandra',
    province: 'Western',
    sector: 'Textiles',
    till: 'POS-08',
    cashier: 'S. Fernando',
    itemCount: 5,
    paymentMethod: 'Koko',
    ramisStatus: 'Fiscalized',
    amount: 28400.0,
  },
  {
    id: 'tx-105',
    receiptHash: 'REC-NEG-11942',
    time: '14:51:58',
    merchant: 'Perera & Sons Bakery - Negombo',
    slug: 'p-and-s-negombo',
    province: 'Western',
    sector: 'Dining',
    till: 'POS-03',
    cashier: 'R. Jayawardena',
    itemCount: 4,
    paymentMethod: 'Cash',
    ramisStatus: 'Fiscalized',
    amount: 2150.0,
  },
  {
    id: 'tx-106',
    receiptHash: 'REC-KUR-90214',
    time: '14:51:51',
    merchant: 'Asiri Health Pharmacy - Kurunegala',
    slug: 'asiri-pharmacy',
    province: 'North Western',
    sector: 'Healthcare',
    till: 'POS-01',
    cashier: 'T. Dissanayake',
    itemCount: 6,
    paymentMethod: 'LankaQR',
    ramisStatus: 'Fiscalized',
    amount: 6720.0,
  },
]

const SAMPLE_MERCHANTS = [
  { name: 'Keells Super - Union Place', slug: 'keells-up', province: 'Western', sector: 'Supermarket' as const },
  { name: 'Cargills Food City - Katubedda', slug: 'cargills-kat', province: 'Western', sector: 'Supermarket' as const },
  { name: 'Singer Mega - Kandy', slug: 'singer-kandy', province: 'Central', sector: 'Textiles' as const },
  { name: 'DIMO Workshop - Matara', slug: 'dimo-matara', province: 'Southern', sector: 'Auto Care' as const },
  { name: 'Nolimit Fashion - Dehiwala', slug: 'nolimit-deh', province: 'Western', sector: 'Textiles' as const },
  { name: 'Spicy Lanka Restaurant - Ella', slug: 'spicy-ella', province: 'Uva', sector: 'Dining' as const },
  { name: 'Hemas MediClinics - Wattala', slug: 'hemas-wat', province: 'Western', sector: 'Healthcare' as const },
]

export default function RealTimeSalesWallPage() {
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS)
  const [isFrozen, setIsFrozen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [selectedSector, setSelectedSector] = useState<string>('All')
  const [selectedProvince, setSelectedProvince] = useState<string>('All')
  const [minAmount, setMinAmount] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')

  // Running live metrics
  const [receiptCount, setReceiptCount] = useState(42892)
  const [totalGmv, setTotalGmv] = useState(149210480.0)
  const [tpsVelocity, setTpsVelocity] = useState(18.4)

  // Web Audio chime for high-value transactions
  const playChime = useCallback(() => {
    if (!soundEnabled) return
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const ctx = new AudioContextClass()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime) // A5
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.25)
    } catch {
      // AudioContext not allowed or not supported
    }
  }, [soundEnabled])

  // Live incoming transaction stream generator
  useEffect(() => {
    if (isFrozen) return

    const interval = setInterval(() => {
      const now = new Date()
      const timeStr = now.toTimeString().split(' ')[0]
      const merchant = SAMPLE_MERCHANTS[Math.floor(Math.random() * SAMPLE_MERCHANTS.length)]
      const methods: ('LankaQR' | 'VISA' | 'Mastercard' | 'Cash' | 'Koko')[] = [
        'LankaQR',
        'VISA',
        'Mastercard',
        'Cash',
        'Koko',
      ]
      const method = methods[Math.floor(Math.random() * methods.length)]
      const amount = Math.floor(Math.random() * 45000) + 1250

      if (amount > 30000) {
        playChime()
      }

      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        receiptHash: `REC-${merchant.province.slice(0, 3).toUpperCase()}-${Math.floor(
          10000 + Math.random() * 90000
        )}`,
        time: timeStr,
        merchant: merchant.name,
        slug: merchant.slug,
        province: merchant.province,
        sector: merchant.sector,
        till: `POS-0${Math.floor(Math.random() * 6) + 1}`,
        cashier: 'Cashier ' + (Math.floor(Math.random() * 12) + 1),
        itemCount: Math.floor(Math.random() * 15) + 1,
        paymentMethod: method,
        ramisStatus: 'Fiscalized',
        amount,
      }

      setTransactions((prev) => [newTx, ...prev.slice(0, 49)])
      setReceiptCount((prev) => prev + 1)
      setTotalGmv((prev) => prev + amount)
      setTpsVelocity(Number((16 + Math.random() * 6).toFixed(1)))
    }, 2800)

    return () => clearInterval(interval)
  }, [isFrozen, playChime])

  // Filtered transactions
  const filtered = transactions.filter((tx) => {
    if (selectedSector !== 'All' && tx.sector !== selectedSector) return false
    if (selectedProvince !== 'All' && tx.province !== selectedProvince) return false
    if (minAmount > 0 && tx.amount < minAmount) return false
    if (
      searchQuery &&
      !tx.merchant.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !tx.receiptHash.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false
    }
    return true
  })

  return (
    <div className="space-y-6 pb-12">
      {/* Live Telemetry Status Banner (Stitch S3) */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex items-center justify-center w-3 h-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4fdbc8] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4fdbc8]"></span>
          </div>
          <div className="flex items-center gap-2 truncate">
            <span className="font-mono text-xs text-[#4fdbc8] font-bold uppercase tracking-widest">
              LIVE BROADCAST STREAM
            </span>
            <span className="text-[#3d4947]">•</span>
            <span className="font-mono text-xs text-[#bcc9c6] truncate">
              WS://LK-CENTRAL-1.SYS.STREAM
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#222a3d] border border-[#3d4947] text-[#6bd8cb] font-mono text-xs">
            <Zap className="w-3.5 h-3.5 text-[#6bd8cb]" />
            FEED LATENCY: 14ms
          </span>

          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#171f33] border border-[#2d3449] text-[#4fdbc8] font-mono text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#4fdbc8]" />
            SYNCHRONIZED
          </span>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-1.5 rounded-lg border transition-colors ${
              soundEnabled
                ? 'bg-[#6bd8cb]/20 border-[#6bd8cb] text-[#6bd8cb]'
                : 'bg-[#171f33] border-[#2d3449] text-[#879391] hover:text-white'
            }`}
            title={soundEnabled ? 'Mute Large Transaction Chime' : 'Enable Large Transaction Chime'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setIsFrozen(!isFrozen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
              isFrozen
                ? 'bg-[#ff5451] border-[#ff5451] text-white hover:bg-[#ff897d]'
                : 'bg-[#222a3d] border-[#3d4947] text-white hover:bg-[#2d3449]'
            }`}
          >
            {isFrozen ? (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume Stream</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Freeze Stream</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* KPI Ticker Metrics Grid (4 Top Highlights) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Receipts */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Total Receipts Today</span>
            <Receipt className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              {receiptCount.toLocaleString()}
            </span>
            <span className="font-mono text-xs text-[#4fdbc8] font-semibold">+18.2% vs lw</span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span>SYNC: 100%</span>
            <span>•</span>
            <span className="text-[#6bd8cb] font-semibold">ALL TILLS FISCALIZED</span>
          </div>
        </div>

        {/* Live GMV Volume */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Live GMV Volume (LKR)</span>
            <DollarSign className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-[#4fdbc8] tracking-tight">
              {totalGmv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span className="text-[#4fdbc8] font-semibold">LKR 1.84M / MIN</span>
            <span>•</span>
            <span>TARGET: 160M EOD</span>
          </div>
        </div>

        {/* Throughput Velocity */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#6bd8cb]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Throughput Velocity</span>
            <Zap className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              {tpsVelocity}
            </span>
            <span className="font-mono text-sm text-[#6bd8cb] font-semibold">tx / sec</span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span>PEAK TODAY: 29.8 tx/s</span>
            <span>•</span>
            <span className="text-[#4fdbc8]">BURST: 120 tx/s</span>
          </div>
        </div>

        {/* Average Basket Size */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm relative overflow-hidden group hover:border-[#4fdbc8]/50 transition-all">
          <div className="flex items-center justify-between text-xs text-[#879391] mb-1 font-mono uppercase font-semibold">
            <span>Average Basket Size</span>
            <ShoppingBag className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              LKR 3,478.00
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 font-mono text-[10px] text-[#bcc9c6]">
            <span className="text-[#4fdbc8] font-semibold">+4.2%</span>
            <span>•</span>
            <span>SUPERMARKET AVG: 4,120</span>
          </div>
        </div>
      </div>

      {/* Real-time Filter & Configuration Strip */}
      <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sector Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-[#879391] uppercase tracking-wider font-semibold mr-1">
              SECTOR:
            </span>
            {['All', 'Supermarket', 'Auto Care', 'Textiles', 'Dining', 'Healthcare'].map((sector) => (
              <button
                key={sector}
                type="button"
                onClick={() => setSelectedSector(sector)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedSector === sector
                    ? 'bg-[#29a195] text-[#00302b]'
                    : 'bg-[#171f33] text-[#bcc9c6] hover:bg-[#222a3d] hover:text-white border border-[#2d3449]'
                }`}
              >
                {sector}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#879391]" />
            <input
              type="text"
              placeholder="Search merchant, receipt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#060e20] border border-[#2d3449] rounded-lg text-white font-mono text-xs placeholder:text-[#879391] focus:border-[#6bd8cb] outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#2d3449]/40 text-xs">
          {/* Province Filter */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#879391] uppercase font-semibold">
              PROVINCE:
            </span>
            <select
              value={selectedProvince}
              onChange={(e) => setSelectedProvince(e.target.value)}
              className="bg-[#060e20] border border-[#2d3449] text-white text-xs rounded-lg px-2.5 py-1 outline-none font-mono"
            >
              <option value="All">All Sri Lanka</option>
              <option value="Western">Western Province (Colombo, Gampaha)</option>
              <option value="Central">Central Province (Kandy, Matale)</option>
              <option value="Southern">Southern Province (Galle, Matara)</option>
              <option value="North Western">North Western (Kurunegala)</option>
              <option value="Eastern">Eastern Province (Trincomalee)</option>
              <option value="Uva">Uva Province (Badulla, Ella)</option>
            </select>
          </div>

          {/* Min Amount Threshold */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#879391] uppercase font-semibold">
              MIN AMOUNT:
            </span>
            {[
              { label: 'All', value: 0 },
              { label: '> 5K', value: 5000 },
              { label: '> 25K', value: 25000 },
              { label: '> 50K (VIP)', value: 50000 },
            ].map((th) => (
              <button
                key={th.value}
                type="button"
                onClick={() => setMinAmount(th.value)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold transition-colors ${
                  minAmount === th.value
                    ? 'bg-[#6bd8cb] text-[#003732]'
                    : 'bg-[#171f33] text-[#bcc9c6] hover:bg-[#222a3d]'
                }`}
              >
                {th.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid: Streaming Transactions Feed (Left) & Regional Heatmap / Leaderboard (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Live Retail Transactions Feed (8 cols) */}
        <div className="xl:col-span-8 bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-md overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#2d3449] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#4fdbc8] animate-pulse" />
              <h3 className="font-bold text-base text-white">Live Retail Transaction Stream</h3>
              <span className="font-mono text-[11px] bg-[#060e20] text-[#6bd8cb] px-2 py-0.5 rounded font-bold">
                {filtered.length} active rows
              </span>
            </div>
            <div className="font-mono text-xs text-[#879391]">
              Live updates every ~3s
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#060e20] text-[#879391] font-mono text-[10px] uppercase border-b border-[#2d3449]">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Receipt / Hash</th>
                  <th className="px-4 py-3">Merchant / Outlet</th>
                  <th className="px-3 py-3">Till</th>
                  <th className="px-3 py-3">Items</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">RAMIS</th>
                  <th className="px-4 py-3 text-right">Amount (LKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3449]/40 font-mono text-xs">
                {filtered.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-[#171f33] transition-colors group animate-fade-in"
                  >
                    <td className="px-4 py-3 text-[#bcc9c6] whitespace-nowrap">{tx.time}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[#4fdbc8] font-bold group-hover:underline">
                        {tx.receiptHash}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-sans font-semibold text-white truncate max-w-[200px]">
                        {tx.merchant}
                      </div>
                      <div className="text-[10px] text-[#879391]">
                        {tx.province} • {tx.sector}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[#bcc9c6] whitespace-nowrap">{tx.till}</td>
                    <td className="px-3 py-3 text-white whitespace-nowrap">{tx.itemCount}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.paymentMethod === 'LankaQR'
                            ? 'bg-[#29a195]/20 text-[#6bd8cb] border border-[#29a195]/40'
                            : tx.paymentMethod === 'VISA' || tx.paymentMethod === 'Mastercard'
                            ? 'bg-[#04b4a2]/20 text-[#4fdbc8] border border-[#04b4a2]/40'
                            : tx.paymentMethod === 'Koko'
                            ? 'bg-[#ff5451]/20 text-[#ffb4ab] border border-[#ff5451]/40'
                            : 'bg-[#222a3d] text-[#bcc9c6]'
                        }`}
                      >
                        {tx.paymentMethod}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#4fdbc8] font-semibold">
                        <ShieldCheck className="w-3 h-3 text-[#4fdbc8]" />
                        {tx.ramisStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-bold">
                      <span
                        className={
                          tx.amount > 25000
                            ? 'text-[#6bd8cb] text-sm'
                            : 'text-white'
                        }
                      >
                        {tx.amount.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Regional Throughput Heatmap & Leaderboard (4 cols) */}
        <div className="xl:col-span-4 space-y-6">
          {/* Provincial Heatmap Distribution */}
          <div className="bg-[#131b2e] border border-[#2d3449] p-5 rounded-xl shadow-md space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d3449]/50">
              <h4 className="font-bold text-sm text-white flex items-center gap-2">
                <Building className="w-4 h-4 text-[#6bd8cb]" />
                Provincial Load Distribution
              </h4>
              <span className="font-mono text-[10px] text-[#4fdbc8] font-bold">9 PROVINCES</span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <div className="flex justify-between text-[#bcc9c6] mb-1">
                  <span>Western Province (Colombo/Gampaha)</span>
                  <span className="text-white font-bold">54%</span>
                </div>
                <div className="w-full bg-[#060e20] h-2 rounded-full overflow-hidden">
                  <div className="bg-[#6bd8cb] h-full" style={{ width: '54%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#bcc9c6] mb-1">
                  <span>Central Province (Kandy)</span>
                  <span className="text-white font-bold">18%</span>
                </div>
                <div className="w-full bg-[#060e20] h-2 rounded-full overflow-hidden">
                  <div className="bg-[#4fdbc8] h-full" style={{ width: '18%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#bcc9c6] mb-1">
                  <span>Southern Province (Galle/Matara)</span>
                  <span className="text-white font-bold">14%</span>
                </div>
                <div className="w-full bg-[#060e20] h-2 rounded-full overflow-hidden">
                  <div className="bg-[#29a195] h-full" style={{ width: '14%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#bcc9c6] mb-1">
                  <span>North Western (Kurunegala)</span>
                  <span className="text-white font-bold">8%</span>
                </div>
                <div className="w-full bg-[#060e20] h-2 rounded-full overflow-hidden">
                  <div className="bg-[#04b4a2] h-full" style={{ width: '8%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[#bcc9c6] mb-1">
                  <span>Eastern &amp; Other Provinces</span>
                  <span className="text-white font-bold">6%</span>
                </div>
                <div className="w-full bg-[#060e20] h-2 rounded-full overflow-hidden">
                  <div className="bg-[#222a3d] h-full" style={{ width: '6%' }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Top Merchant Tills Leaderboard */}
          <div className="bg-[#131b2e] border border-[#2d3449] p-5 rounded-xl shadow-md space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d3449]/50">
              <h4 className="font-bold text-sm text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#4fdbc8]" />
                Top Velocity Tills Today
              </h4>
              <span className="font-mono text-[10px] text-[#bcc9c6]">SLST 14:00-15:00</span>
            </div>

            <div className="space-y-3">
              {[
                { name: 'Keells Super - Crescat', till: 'POS-04', gmv: 'LKR 4,892,100', receipts: 482 },
                { name: 'Cargills Food City - KCC', till: 'POS-02', gmv: 'LKR 3,421,900', receipts: 394 },
                { name: 'Toyota Lanka - Galle', till: 'POS-01', gmv: 'LKR 2,980,400', receipts: 38 },
                { name: 'Odel - Colombo 07', till: 'POS-08', gmv: 'LKR 2,640,000', receipts: 142 },
              ].map((leader, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-[#060e20] border border-[#2d3449]/50 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">{leader.name}</div>
                    <div className="font-mono text-[10px] text-[#879391]">
                      Till: {leader.till} • {leader.receipts} receipts
                    </div>
                  </div>
                  <div className="font-mono text-xs text-[#6bd8cb] font-bold">
                    {leader.gmv}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
