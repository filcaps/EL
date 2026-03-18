// ─── Hyperliquid raw types ────────────────────────────────────────────────────

export interface HLFill {
  coin: string
  px: string       // execution price
  sz: string       // size in base asset
  side: 'B' | 'A' // B = buy taker, A = sell taker
  time: number     // unix ms
  oid: number
  tid: number
  fee: string
  feeToken: string
  crossed: boolean // true = taker, false = maker
  hash: string
  dir: string      // e.g. "Open Long", "Close Short"
  startPosition: string
  closedPnl: string
}

export interface HLCandle {
  t: number   // open time ms
  T: number   // close time ms
  s: string   // coin
  i: string   // interval
  o: string   // open
  c: string   // close
  h: string   // high
  l: string   // low
  v: string   // volume (base)
  n: number   // num trades
}

export interface HLL2Level {
  px: string
  sz: string
  n: number
}

export interface HLL2Book {
  coin: string
  levels: [HLL2Level[], HLL2Level[]] // [bids desc, asks asc]
  time: number
}

export interface HLAssetContext {
  markPx: string
  prevDayPx: string
  dayNtlVlm: string   // 24h notional volume USD
  openInterest: string
  funding: string
  premium: string
  oraclePx: string
}

export interface HLMeta {
  universe: Array<{
    name: string
    szDecimals: number
    maxLeverage: number
    onlyIsolated?: boolean
  }>
}

export interface HLHistoricalOrder {
  coin: string
  side: 'B' | 'A'
  limitPx: string
  sz: string
  oid: number
  timestamp: number
  triggerCondition: string
  isTrigger: boolean
  triggerPx: string
  isPositionTpsl: boolean
  reduceOnly: boolean
  orderType: string
  origSz: string
  tif: string
  cloid: string | null
  status: string // "filled" | "canceled" | "open" | "rejected" | "marginCanceled"
  statusTimestamp: number
}

// ─── Hydromancer raw types ────────────────────────────────────────────────────

export interface HMSlippagePoint {
  timestamp: number
  dex: string
  coin: string
  halfSpreadBps: number
  amountUsd: number
  buySlippageBps: number | null
  sellSlippageBps: number | null
}

// ─── Computed / domain types ──────────────────────────────────────────────────

export type TradeSide = 'buy' | 'sell'

export interface TradeExecutionMetrics {
  // identity
  tid: number
  oid: number
  hash: string
  coin: string        // raw API name (e.g. "@260" for spot, "BTC" for perp)
  coinDisplay: string // human-readable name (e.g. "BTC" resolved from spot index)
  side: TradeSide
  direction: string
  isTaker: boolean

  // execution
  fillPrice: number
  size: number
  notionalUsd: number
  timestamp: number
  fee: number
  feeToken: string
  closedPnl: number

  // mid-price estimates (from 1-min candles)
  midPriceAtExecution: number | null
  midPricePlus5Min: number | null
  candleOpen: number | null

  // ── execution cost breakdown (all in bps) ────────────────────────────────
  feeBps: number

  // ── Raw Hydromancer fields (direct from slippageHistory API) ─────────────
  /**
   * Half of the quoted bid-ask spread at the time of the trade, in bps.
   * Source: Hydromancer halfSpreadBps field.
   */
  halfSpreadBps: number | null

  /**
   * Estimated buy slippage in bps at the trade notional.
   * Source: Hydromancer buySlippageBps field. Null if insufficient liquidity.
   */
  rawBuySlippageBps: number | null

  /**
   * Estimated sell slippage in bps at the trade notional.
   * Source: Hydromancer sellSlippageBps field. Null if insufficient liquidity.
   */
  rawSellSlippageBps: number | null

  // ── Derived fields (kept for summary-level aggregation) ──────────────────
  /**
   * Directional slippage for this trade (buy fills → rawBuySlippageBps, sell → rawSellSlippageBps).
   */
  slippageBps: number | null
  additionalImpactBps: number | null

  // Computed from 1-min candle OHLCV
  effectiveSpreadBps: number | null  // 2 × |fill – candle_mid| / candle_mid
  realizedSpreadBps: number | null   // 2 × side × (fill – mid+5min) / mid
  arrivalCostBps: number | null      // side × (fill – candle_open) / candle_open

  /**
   * Total execution cost in bps.
   * Taker:  slippageBps + feeBps
   * Maker: -halfSpreadBps + feeBps  (often net-negative = maker earns more than fees)
   */
  totalCostBps: number | null

  slippageSource: 'hydromancer' | 'live_book' | 'unavailable'
}

export interface AssetSummary {
  coin: string        // raw API name
  displayName: string // human-readable name
  totalTrades: number
  takerTrades: number
  makerTrades: number
  totalVolumeUsd: number
  dayVolumeUsd: number            // 24h market-wide volume from Hyperliquid metadata
  totalFeesUsd: number
  avgEffectiveSpreadBps: number | null
  avgHalfSpreadBps: number | null
  avgSlippageBps: number | null
  avgAdditionalImpactBps: number | null
  avgTotalCostBps: number | null
  avgArrivalCostBps: number | null
  worstTradeBps: number | null
  bestTradeBps: number | null
}

export interface CancelTradeRatio {
  totalOrders: number
  filledOrders: number
  cancelledOrders: number
  ratio: number
  windowDays: number              // the time window this ratio covers
}

export interface WalletSummary {
  address: string
  totalTrades: number
  totalVolumeUsd: number
  totalFeesUsd: number
  avgEffectiveSpreadBps: number | null
  avgSlippageBps: number | null
  avgTotalCostBps: number | null
  estimatedTotalCostUsd: number | null
  /** Fraction of trades (0–1) that have Hydromancer slippage data */
  slippageDataCoverage: number
  cancelTradeRatio: CancelTradeRatio | null
  assetBreakdown: AssetSummary[]
  trades: TradeExecutionMetrics[]
}

export interface OrderBookMetrics {
  coin: string
  timestamp: number
  markPrice: number
  bestBid: number
  bestAsk: number
  bidAskSpreadBps: number
  halfSpreadBps: number
  topBidSize: number
  topAskSize: number
  topOfBookDepthUsd: number
  depth10Bps: number
  depth50Bps: number
  depth100Bps: number
  depth200Bps: number
  orderBookImbalance: number
  dayVolumeUsd: number
}

export interface SlippageChartPoint {
  time: number
  buyBps: number | null
  sellBps: number | null
  halfSpreadBps: number
}

// ─── UI state ─────────────────────────────────────────────────────────────────

export type LoadingStage =
  | 'idle'
  | 'fills'
  | 'candles'
  | 'slippage'
  | 'orderbook'
  | 'computing'
  | 'done'
  | 'error'
