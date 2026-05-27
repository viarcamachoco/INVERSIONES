import { getAuthHeaders } from "../signals/signalApi";

export interface Team06NewsArticle {
  id: string;
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  impactScore?: number;
  confidence?: number;
  matchedPositiveTerms?: string[];
  matchedNegativeTerms?: string[];
}

export interface Team06TechnicalCorrelation {
  scenario?: string;
  bias?: string;
  confidence?: number;
  continuationProbability?: number;
  reversalProbability?: number;
  nearestSupport?: number;
  nearestResistance?: number;
  rationale?: string;
}

export interface Team06NewsResponse {
  symbol: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  impactScore: number;
  confidence: number;
  articles?: Team06NewsArticle[];
  events?: Team06NewsArticle[];
  diagnostics?: Array<{ provider: string; status: string; items?: number; message?: string }>;
  technicalCorrelation?: Team06TechnicalCorrelation;
  sourceVerdict?: {
    sourceId: string;
    verdict: "BUY" | "SELL" | "HOLD";
    confidence: number;
    rationale: string;
  };
}

export interface Team06RegulatoryItem {
  provider: string;
  status: string;
  signal: string;
  confidence: number;
  message: string;
}

export interface Team06RegulatoryResponse {
  symbol: string;
  aggregateSignal: string;
  aggregateScore: number;
  confidence: number;
  items: Team06RegulatoryItem[];
  generatedAt: string;
}

export interface Team06SpreadMetrics {
  symbol: string;
  kind: string;
  direction: string;
  netPremium: number;
  maxProfit: number;
  maxLoss: number;
  breakEven: number;
  riskRewardRatio: number;
  capitalAtRiskPct: number;
  marginRequired: number;
  stopLossLevel: number;
  targetProfitLevel: number;
  recommendation: "ACCEPTABLE" | "WATCH" | "REJECT";
  rationale: string;
  payoff: Array<{ underlyingPrice: number; pnl: number }>;
  issues: Array<{ field: string; message: string; severity: string }>;
  generatedAt: string;
}

export interface Team06SpreadDemoResponse {
  symbol: string;
  underlyingPrice: number;
  debit: Team06SpreadMetrics;
  credit: Team06SpreadMetrics;
  generatedAt: string;
}

export interface Team06RealMarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Team06MarketSnapshot {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  trend: "UPTREND" | "DOWNTREND" | "RANGE" | "UNKNOWN";
  supports: number[];
  resistances: number[];
  source: string;
  isRealMarketData: boolean;
  currency?: string;
  exchangeName?: string;
  marketTime?: string;
  generatedAt: string;
  candles?: Team06RealMarketCandle[];
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });

  return query.toString();
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(`Error consultando ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getTeam06MarketSnapshot(params: {
  symbol: string;
  timeframe?: string;
}): Promise<Team06MarketSnapshot> {
  const query = buildQuery({
    symbol: params.symbol,
    timeframe: params.timeframe,
    range: "3mo",
    interval: "1d"
  });

  return getJson<Team06MarketSnapshot>(`/api/news/market-snapshot?${query}`);
}

export async function getTeam06NewsConfluence(params: {
  symbol: string;
  timeframe?: string;
  limit?: number;
  currentPrice?: number;
  supports?: string;
  resistances?: string;
  trend?: string;
}): Promise<Team06NewsResponse> {
  const query = buildQuery({
    symbol: params.symbol,
    timeframe: params.timeframe,
    limit: params.limit ?? 5,
    currentPrice: params.currentPrice,
    supports: params.supports,
    resistances: params.resistances,
    trend: params.trend
  });

  return getJson<Team06NewsResponse>(`/api/news/confluence?${query}`);
}

export async function getTeam06RegulatoryContext(params: {
  symbol: string;
  putCallRatio?: number;
}): Promise<Team06RegulatoryResponse> {
  const query = buildQuery({
    symbol: params.symbol,
    putCallRatio: params.putCallRatio
  });

  return getJson<Team06RegulatoryResponse>(`/api/news/regulatory-institutional-context?${query}`);
}

export async function getTeam06SpreadDemo(params: {
  symbol: string;
  underlyingPrice?: number;
}): Promise<Team06SpreadDemoResponse> {
  const query = buildQuery({
    symbol: params.symbol,
    underlyingPrice: params.underlyingPrice
  });

  return getJson<Team06SpreadDemoResponse>(`/api/strategies/spreads/demo?${query}`);
}
