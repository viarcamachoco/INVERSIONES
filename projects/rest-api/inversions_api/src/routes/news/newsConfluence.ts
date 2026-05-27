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

export const newsConfluenceRouter = Router();

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
