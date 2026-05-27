import { Router } from "express";
import { authContextMiddleware } from "../../middleware/authContext";
import { evaluateNewsImpact } from "../../modules/news/newsImpactEngine";
import type { NewsProviderId, NewsQueryParams } from "../../modules/news/newsContract";

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

function parseProviders(value: unknown): NewsProviderId[] | undefined {
  if (!value) return undefined;

  const providers = String(value)
    .split(",")
    .map((provider) => provider.trim())
    .filter((provider): provider is NewsProviderId => VALID_PROVIDERS.has(provider as NewsProviderId));

  return providers.length > 0 ? providers : undefined;
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
      includeFallback: req.query.includeFallback !== "false"
    };

    const result = await evaluateNewsImpact(query, limit);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});
