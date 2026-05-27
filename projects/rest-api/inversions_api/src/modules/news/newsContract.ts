export type NewsProviderId =
  | "finnhub"
  | "newsapi"
  | "alphaVantage"
  | "polygon"
  | "secEdgar"
  | "cftcCot"
  | "yahooFinance"
  | "demoFallback";

export type NewsSentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export type NewsEventKind =
  | "EARNINGS"
  | "MACRO"
  | "REGULATORY"
  | "INSTITUTIONAL_FLOW"
  | "OPEN_INTEREST"
  | "ANALYST_RATING"
  | "CORPORATE_ACTION"
  | "MARKET_NEWS"
  | "UNKNOWN";

export interface NewsInstrumentContext {
  /** Ticker principal, por ejemplo AAPL, NVDA, SPY. */
  ticker: string;
  /** Nombre de empresa si se conoce, por ejemplo Apple Inc. */
  companyName?: string;
  /** Mercado o exchange si se conoce, por ejemplo NASDAQ o NYSE. */
  exchange?: string;
  /** Sector para enriquecer scoring y filtros. */
  sector?: string;
}

export interface NewsRelevantPeriods {
  /** Inicio del rango de analisis. */
  from?: string;
  /** Fin del rango de analisis. */
  to?: string;
  /** Fecha estimada o real de earnings relacionada al instrumento. */
  earningsDate?: string;
  /** Periodos macro relevantes: CPI, FOMC, NFP, tasas, etc. */
  macroEvents?: Array<{
    name: string;
    date: string;
    importance: "LOW" | "MEDIUM" | "HIGH";
  }>;
}

export interface NewsMarketContext {
  /** Open interest agregado o disponible para opciones del instrumento. */
  openInterest?: {
    call?: number;
    put?: number;
    putCallRatio?: number;
    expiration?: string;
  };
  /** Flujos institucionales conocidos o derivados de otra fuente del sistema. */
  institutionalFlows?: Array<{
    source: string;
    direction: "INFLOW" | "OUTFLOW" | "NEUTRAL";
    amount?: number;
    observedAt?: string;
  }>;
  /** Reportes regulatorios o institucionales usados para contexto. */
  regulatoryReports?: Array<{
    provider: "SEC_EDGAR" | "CFTC_COT" | "OTHER";
    reportType: string;
    url?: string;
    publishedAt?: string;
  }>;
}

export interface NewsQueryParams {
  instrument: NewsInstrumentContext;
  periods?: NewsRelevantPeriods;
  marketContext?: NewsMarketContext;
  providers?: NewsProviderId[];
  limit?: number;
  includeFallback?: boolean;
}

export interface NormalizedNewsArticle {
  id: string;
  provider: NewsProviderId;
  symbol: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  eventKind: NewsEventKind;
  raw?: unknown;
}

export interface NewsProviderDiagnostic {
  provider: NewsProviderId;
  status: "OK" | "SKIPPED" | "ERROR" | "RATE_LIMITED" | "FALLBACK";
  message?: string;
  items: number;
  elapsedMs?: number;
}

export interface NewsDataServiceResult {
  query: NewsQueryParams;
  articles: NormalizedNewsArticle[];
  diagnostics: NewsProviderDiagnostic[];
  fromCache: boolean;
  generatedAt: string;
}

export interface NewsImpactEvent extends NormalizedNewsArticle {
  sentiment: NewsSentiment;
  sentimentScore: number;
  relevanceScore: number;
  impactScore: number;
  confidence: number;
  matchedPositiveTerms: string[];
  matchedNegativeTerms: string[];
}

export interface CandleOverlayAnnotation {
  id: string;
  symbol: string;
  timestamp: string;
  label: string;
  sentiment: NewsSentiment;
  impactScore: number;
  confidence: number;
  eventKind: NewsEventKind;
  url?: string;
}

export interface NewsImpactResult {
  symbol: string;
  sentiment: NewsSentiment;
  impactScore: number;
  confidence: number;
  events: NewsImpactEvent[];
  articles: NewsImpactEvent[];
  overlayAnnotations: CandleOverlayAnnotation[];
  diagnostics: NewsProviderDiagnostic[];
  generatedAt: string;
  sourceVerdict: {
    sourceId: "news";
    verdict: "BUY" | "SELL" | "HOLD";
    confidence: number;
    rationale: string;
  };
}

export function buildDefaultNewsQuery(symbol: string, limit = 8): NewsQueryParams {
  return {
    instrument: {
      ticker: symbol.trim().toUpperCase()
    },
    limit,
    includeFallback: false
  };
}
