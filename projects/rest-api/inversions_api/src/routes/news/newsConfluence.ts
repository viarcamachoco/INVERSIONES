import { Router } from "express";
import { authContextMiddleware } from "../../middleware/authContext";
import { evaluateNewsImpact } from "../../modules/news/newsImpactEngine";
import { correlateNewsWithTechnicalStructure } from "../../modules/news/newsTechnicalCorrelation";
import type { NewsProviderId, NewsQueryParams } from "../../modules/news/newsContract";
import type { NewsTechnicalContext, TechnicalTrend } from "../../modules/news/newsTechnicalCorrelation";

const VALID_PROVIDERS = new Set<NewsProviderId>([
  "finnhub",
  "newsapi",
  "alphaVantage",
  "polygon",
  "secEdgar",
  "cftcCot",
  "yahooFinance",
  "demoFallback"
]);

const VALID_TRENDS = new Set<TechnicalTrend>(["UPTREND", "DOWNTREND", "RANGE", "UNKNOWN"]);

function parseProviders(value: unknown): NewsProviderId[] | undefined {
  if (!value) return undefined;

  const providers = String(value)
    .split(",")
    .map((provider) => provider.trim())
    .filter((provider): provider is NewsProviderId => VALID_PROVIDERS.has(provider as NewsProviderId));

  return providers.length > 0 ? providers : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumberList(value: unknown): number[] | undefined {
  if (!value) return undefined;
  const values = String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);

  return values.length > 0 ? values : undefined;
}

function parseTrend(value: unknown): TechnicalTrend | undefined {
  if (!value) return undefined;
  const trend = String(value).trim().toUpperCase() as TechnicalTrend;
  return VALID_TRENDS.has(trend) ? trend : undefined;
}

function buildTechnicalContext(symbol: string, reqQuery: Record<string, unknown>): NewsTechnicalContext | undefined {
  const currentPrice = parseNumber(reqQuery.currentPrice);
  const supports = parseNumberList(reqQuery.supports);
  const resistances = parseNumberList(reqQuery.resistances);
  const trend = parseTrend(reqQuery.trend);
  const atr = parseNumber(reqQuery.atr);
  const rsi = parseNumber(reqQuery.rsi);
  const macdHistogram = parseNumber(reqQuery.macdHistogram);
  const timeframe = reqQuery.timeframe ? String(reqQuery.timeframe) : undefined;

  const hasContext = [currentPrice, supports, resistances, trend, atr, rsi, macdHistogram, timeframe].some(
    (value) => value !== undefined
  );

  if (!hasContext) return undefined;

  return {
    symbol,
    currentPrice,
    supports,
    resistances,
    trend,
    atr,
    rsi,
    macdHistogram,
    timeframe
  };
}


interface YahooChartQuote {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
}

interface YahooChartResult {
  meta?: {
    symbol?: string;
    regularMarketPrice?: number;
    previousClose?: number;
    chartPreviousClose?: number;
    currency?: string;
    exchangeName?: string;
    regularMarketTime?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: YahooChartQuote[];
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string } | null;
  };
}

interface RealMarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inferRealMarketTrend(candles: RealMarketCandle[]): TechnicalTrend {
  if (candles.length < 50) return "UNKNOWN";

  const closes = candles.map((candle) => candle.close);
  const lastClose = closes[closes.length - 1];
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));

  if (lastClose > sma20 && sma20 >= sma50) return "UPTREND";
  if (lastClose < sma20 && sma20 <= sma50) return "DOWNTREND";
  return "RANGE";
}

function buildRealMarketLevels(candles: RealMarketCandle[], currentPrice: number) {
  const recent = candles.slice(-60);
  const lows = recent.map((candle) => candle.low).filter((value) => Number.isFinite(value));
  const highs = recent.map((candle) => candle.high).filter((value) => Number.isFinite(value));

  const supports = lows
    .filter((value) => value < currentPrice)
    .sort((a, b) => b - a)
    .slice(0, 2);

  const resistances = highs
    .filter((value) => value > currentPrice)
    .sort((a, b) => a - b)
    .slice(0, 2);

  return {
    supports: supports.map((value) => Number(value.toFixed(2))),
    resistances: resistances.map((value) => Number(value.toFixed(2)))
  };
}

function parseYahooCandles(result: YahooChartResult): RealMarketCandle[] {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];

  return timestamps
    .map((time, index) => ({
      time,
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(quote.close?.[index]),
      volume: Number(quote.volume?.[index] ?? 0)
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    );
}

function normalizeYahooSymbol(symbol: string): string {
  return encodeURIComponent(symbol.trim().toUpperCase());
}

export const newsConfluenceRouter = Router();


newsConfluenceRouter.get("/market-snapshot", authContextMiddleware, async (req, res, next) => {
  try {
    const symbol = String(req.query.symbol ?? req.query.ticket ?? "").trim().toUpperCase();
    const range = req.query.range ? String(req.query.range) : "3mo";
    const interval = req.query.interval ? String(req.query.interval) : "1d";
    const timeframe = req.query.timeframe ? String(req.query.timeframe) : interval;

    if (!symbol) {
      return res.status(400).json({
        code: "MISSING_SYMBOL",
        message: "El parametro 'symbol' o 'ticket' es obligatorio. Ejemplo: /api/news/market-snapshot?symbol=AAPL"
      });
    }

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${normalizeYahooSymbol(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const startedAt = Date.now();
    const response = await fetch(yahooUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "InversionsPWA/TEAM06 real-market-snapshot"
      }
    });

    if (!response.ok) {
      return res.status(502).json({
        code: "REAL_MARKET_PROVIDER_ERROR",
        message: `Yahoo Finance respondio ${response.status}. No se usaran precios ficticios.`,
        provider: "yahooFinance",
        symbol
      });
    }

    const payload = (await response.json()) as YahooChartResponse;
    const providerError = payload.chart?.error;
    const result = payload.chart?.result?.[0];

    if (providerError || !result) {
      return res.status(502).json({
        code: "REAL_MARKET_PROVIDER_EMPTY",
        message: providerError?.description ?? "Yahoo Finance no regreso datos suficientes. No se usaran precios ficticios.",
        provider: "yahooFinance",
        symbol
      });
    }

    const candles = parseYahooCandles(result);
    const lastCandle = candles[candles.length - 1];
    const currentPrice = Number((result.meta?.regularMarketPrice ?? lastCandle?.close ?? result.meta?.previousClose ?? 0).toFixed(2));

    if (!currentPrice || !Number.isFinite(currentPrice) || candles.length === 0) {
      return res.status(502).json({
        code: "REAL_MARKET_PRICE_UNAVAILABLE",
        message: "No se pudo obtener precio real desde Yahoo Finance. No se usaran datos demo.",
        provider: "yahooFinance",
        symbol
      });
    }

    const levels = buildRealMarketLevels(candles, currentPrice);
    const marketTime = result.meta?.regularMarketTime
      ? new Date(result.meta.regularMarketTime * 1000).toISOString()
      : new Date(lastCandle.time * 1000).toISOString();

    return res.status(200).json({
      symbol,
      timeframe,
      currentPrice,
      trend: inferRealMarketTrend(candles),
      supports: levels.supports,
      resistances: levels.resistances,
      source: "yahooFinance:chart",
      isRealMarketData: true,
      currency: result.meta?.currency ?? "USD",
      exchangeName: result.meta?.exchangeName,
      marketTime,
      elapsedMs: Date.now() - startedAt,
      candles: candles.slice(-60),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

newsConfluenceRouter.get("/confluence", authContextMiddleware, async (req, res, next) => {
  try {
    const symbol = String(req.query.symbol ?? req.query.ticket ?? "").trim().toUpperCase();
    const companyName = req.query.companyName ? String(req.query.companyName) : undefined;
    const limitRaw = Number(req.query.limit ?? 8);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(30, limitRaw)) : 8;

    if (!symbol) {
      return res.status(400).json({
        code: "MISSING_SYMBOL",
        message: "El parametro 'symbol' o 'ticket' es obligatorio. Ejemplo: /api/news/confluence?symbol=AAPL"
      });
    }

    const query: NewsQueryParams = {
      instrument: {
        ticker: symbol,
        companyName
      },
      periods: {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        earningsDate: req.query.earningsDate ? String(req.query.earningsDate) : undefined
      },
      providers: parseProviders(req.query.providers),
      limit,
      includeFallback: req.query.includeFallback === "true"
    };

    const result = await evaluateNewsImpact(query, limit);
    const technicalContext = buildTechnicalContext(symbol, req.query as Record<string, unknown>);
    const technicalCorrelation = correlateNewsWithTechnicalStructure(result, technicalContext);

    return res.status(200).json({
      ...result,
      technicalCorrelation,
      overlayAnnotations: technicalCorrelation.overlayAnnotations
    });
  } catch (error) {
    return next(error);
  }
});
