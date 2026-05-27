import type { SourceVerdict } from "../signals/confluenceEngine";
import {
  buildDefaultNewsQuery,
  type CandleOverlayAnnotation,
  type NewsEventKind,
  type NewsImpactEvent,
  type NewsImpactResult,
  type NewsQueryParams,
  type NewsSentiment,
  type NormalizedNewsArticle
} from "./newsContract";
import { fetchNewsData } from "./newsDataService";

const POSITIVE_TERMS = [
  "beat", "beats", "growth", "grows", "gain", "gains", "surge", "surges", "rise", "rises",
  "rally", "bullish", "upgrade", "upside", "strong", "record", "profit", "profits", "revenue",
  "earnings", "approval", "approved", "partnership", "launch", "expands", "momentum", "buyback",
  "outperform", "optimistic", "resilient", "recover", "recovery"
];

const NEGATIVE_TERMS = [
  "miss", "misses", "fall", "falls", "drop", "drops", "plunge", "plunges", "decline", "declines",
  "bearish", "downgrade", "downside", "weak", "loss", "losses", "lawsuit", "investigation", "fine",
  "recall", "risk", "risks", "cuts", "cut", "delay", "delays", "volatility", "cautious", "probe",
  "warning", "slump", "pressure", "concern", "concerns", "bear market", "trouble"
];

const EVENT_IMPACT_MULTIPLIER: Record<NewsEventKind, number> = {
  EARNINGS: 1.25,
  REGULATORY: 1.2,
  MACRO: 1.15,
  INSTITUTIONAL_FLOW: 1.1,
  OPEN_INTEREST: 1.1,
  ANALYST_RATING: 1.05,
  CORPORATE_ACTION: 1.05,
  MARKET_NEWS: 1,
  UNKNOWN: 0.85
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueMatches(text: string, terms: string[]): string[] {
  const matches = new Set<string>();

  for (const term of terms) {
    const pattern = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) matches.add(term);
  }

  return [...matches];
}

function sentimentLabel(score: number): NewsSentiment {
  if (score > 0.15) return "POSITIVE";
  if (score < -0.15) return "NEGATIVE";
  return "NEUTRAL";
}

function verdictFromScore(score: number): SourceVerdict["verdict"] {
  if (score > 0.18) return "BUY";
  if (score < -0.18) return "SELL";
  return "HOLD";
}

function calculateRecencyBoost(publishedAt: string): number {
  const ageMs = Date.now() - Date.parse(publishedAt);
  const ageHours = ageMs / 3_600_000;

  if (!Number.isFinite(ageHours) || ageHours < 0) return 1;
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.85;
  if (ageHours <= 168) return 0.7;
  return 0.55;
}

function scoreArticle(symbol: string, article: NormalizedNewsArticle): NewsImpactEvent {
  const text = `${article.title} ${article.summary}`.toLowerCase();
  const matchedPositiveTerms = uniqueMatches(text, POSITIVE_TERMS);
  const matchedNegativeTerms = uniqueMatches(text, NEGATIVE_TERMS);

  const positive = matchedPositiveTerms.length;
  const negative = matchedNegativeTerms.length;
  const denominator = Math.max(1, positive + negative);
  const rawSentimentScore = (positive - negative) / denominator;
  const sentimentScore = clamp(Number(rawSentimentScore.toFixed(3)), -1, 1);

  const mentionsTicker = text.includes(symbol.toLowerCase());
  const mentionsCompany = Boolean(article.raw && JSON.stringify(article.raw).toLowerCase().includes(symbol.toLowerCase()));
  const relevanceScore = clamp((mentionsTicker ? 1 : 0.65) + (mentionsCompany ? 0.1 : 0), 0.35, 1);

  const eventMultiplier = EVENT_IMPACT_MULTIPLIER[article.eventKind] ?? 1;
  const recencyBoost = calculateRecencyBoost(article.publishedAt);
  const impactScore = clamp(Number((sentimentScore * relevanceScore * eventMultiplier * recencyBoost).toFixed(3)), -1, 1);

  const confidence = clamp(
    Number((0.35 + Math.abs(sentimentScore) * 0.35 + relevanceScore * 0.2 + recencyBoost * 0.1).toFixed(3)),
    0.35,
    0.95
  );

  return {
    ...article,
    sentiment: sentimentLabel(sentimentScore),
    sentimentScore,
    relevanceScore,
    impactScore,
    confidence,
    matchedPositiveTerms,
    matchedNegativeTerms
  };
}

function buildOverlayAnnotation(event: NewsImpactEvent): CandleOverlayAnnotation {
  return {
    id: `news-${event.id}`,
    symbol: event.symbol,
    timestamp: event.publishedAt,
    label: `${event.sentiment}: ${event.title}`.slice(0, 140),
    sentiment: event.sentiment,
    impactScore: event.impactScore,
    confidence: event.confidence,
    eventKind: event.eventKind,
    url: event.url || undefined
  };
}

function aggregateImpact(events: NewsImpactEvent[]): { impactScore: number; confidence: number; sentiment: NewsSentiment } {
  if (events.length === 0) {
    return { impactScore: 0, confidence: 0.35, sentiment: "NEUTRAL" };
  }

  const totalWeight = events.reduce((sum, event) => sum + event.relevanceScore * event.confidence, 0) || 1;
  const weightedImpact = events.reduce(
    (sum, event) => sum + event.impactScore * event.relevanceScore * event.confidence,
    0
  ) / totalWeight;

  const avgConfidence = events.reduce((sum, event) => sum + event.confidence, 0) / events.length;
  const articleVolumeBoost = Math.min(events.length, 10) * 0.015;

  const impactScore = clamp(Number(weightedImpact.toFixed(3)), -1, 1);
  const confidence = clamp(Number((avgConfidence + articleVolumeBoost).toFixed(3)), 0.35, 0.95);

  return {
    impactScore,
    confidence,
    sentiment: sentimentLabel(impactScore)
  };
}

function buildRationale(result: Pick<NewsImpactResult, "sentiment" | "impactScore" | "events">): string {
  if (result.events.length === 0) {
    return "Sin noticias reales suficientes para este instrumento. Señal neutral por seguridad.";
  }

  const topEvents = result.events
    .slice(0, 3)
    .map((event) => `“${event.title}”`)
    .join(" | ");

  return `Sentimiento ${result.sentiment.toLowerCase()} por noticias. Impacto ${result.impactScore.toFixed(2)}. Titulares: ${topEvents}`;
}

function normalizeInput(input: string | NewsQueryParams, limit = 8): NewsQueryParams {
  if (typeof input === "string") return buildDefaultNewsQuery(input, limit);

  return {
    ...input,
    limit: input.limit ?? limit,
    includeFallback: input.includeFallback ?? false,
    instrument: {
      ...input.instrument,
      ticker: input.instrument.ticker.trim().toUpperCase()
    }
  };
}

export async function evaluateNewsImpact(input: string | NewsQueryParams, limit = 8): Promise<NewsImpactResult> {
  const query = normalizeInput(input, limit);
  const data = await fetchNewsData(query);
  const symbol = query.instrument.ticker;
  const events = data.articles.map((article) => scoreArticle(symbol, article));
  const aggregate = aggregateImpact(events);
  const overlayAnnotations = events.map(buildOverlayAnnotation);

  const sourceVerdict = {
    sourceId: "news" as const,
    verdict: verdictFromScore(aggregate.impactScore),
    confidence: aggregate.confidence,
    rationale: buildRationale({
      sentiment: aggregate.sentiment,
      impactScore: aggregate.impactScore,
      events
    })
  };

  return {
    symbol,
    sentiment: aggregate.sentiment,
    impactScore: aggregate.impactScore,
    confidence: aggregate.confidence,
    events,
    articles: events,
    overlayAnnotations,
    diagnostics: data.diagnostics,
    generatedAt: new Date().toISOString(),
    sourceVerdict
  };
}
