import type { CandleOverlayAnnotation, NewsImpactResult, NewsSentiment } from "./newsContract";

export type TechnicalTrend = "UPTREND" | "DOWNTREND" | "RANGE" | "UNKNOWN";
export type TechnicalCorrelationScenario = "CONTINUATION" | "REVERSAL" | "BREAKOUT_WATCH" | "RANGE_CONFIRMATION" | "NO_SIGNAL";
export type TechnicalCorrelationBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface TechnicalLevel {
  value: number;
  kind: "SUPPORT" | "RESISTANCE";
  strength?: number;
  label?: string;
}

export interface NewsTechnicalContext {
  symbol: string;
  currentPrice?: number;
  trend?: TechnicalTrend;
  supports?: number[];
  resistances?: number[];
  levels?: TechnicalLevel[];
  atr?: number;
  rsi?: number;
  macdHistogram?: number;
  timeframe?: string;
}

export interface NewsTechnicalCorrelationResult {
  symbol: string;
  bias: TechnicalCorrelationBias;
  scenario: TechnicalCorrelationScenario;
  confidence: number;
  newsImpactScore: number;
  trend: TechnicalTrend;
  nearestSupport?: number;
  nearestResistance?: number;
  distanceToSupportPct?: number;
  distanceToResistancePct?: number;
  continuationProbability: number;
  reversalProbability: number;
  rationale: string;
  overlayAnnotations: CandleOverlayAnnotation[];
  generatedAt: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sentimentBias(sentiment: NewsSentiment, impactScore: number): TechnicalCorrelationBias {
  if (sentiment === "POSITIVE" || impactScore > 0.15) return "BULLISH";
  if (sentiment === "NEGATIVE" || impactScore < -0.15) return "BEARISH";
  return "NEUTRAL";
}

function inferTrend(context?: NewsTechnicalContext): TechnicalTrend {
  if (context?.trend) return context.trend;
  if (typeof context?.macdHistogram === "number" && context.macdHistogram > 0.05) return "UPTREND";
  if (typeof context?.macdHistogram === "number" && context.macdHistogram < -0.05) return "DOWNTREND";
  if (typeof context?.rsi === "number" && context.rsi >= 58) return "UPTREND";
  if (typeof context?.rsi === "number" && context.rsi <= 42) return "DOWNTREND";
  return "UNKNOWN";
}

function nearestBelow(price: number, levels: number[]): number | undefined {
  return levels.filter((level) => level <= price).sort((a, b) => b - a)[0];
}

function nearestAbove(price: number, levels: number[]): number | undefined {
  return levels.filter((level) => level >= price).sort((a, b) => a - b)[0];
}

function pctDistance(price: number, level?: number): number | undefined {
  if (!level || price <= 0) return undefined;
  return Number((((price - level) / price) * 100).toFixed(2));
}

function normalizeLevels(context?: NewsTechnicalContext): { supports: number[]; resistances: number[] } {
  const explicitSupports = context?.supports ?? [];
  const explicitResistances = context?.resistances ?? [];
  const levelSupports = (context?.levels ?? [])
    .filter((level) => level.kind === "SUPPORT")
    .map((level) => level.value);
  const levelResistances = (context?.levels ?? [])
    .filter((level) => level.kind === "RESISTANCE")
    .map((level) => level.value);

  return {
    supports: [...new Set([...explicitSupports, ...levelSupports])].filter(Number.isFinite),
    resistances: [...new Set([...explicitResistances, ...levelResistances])].filter(Number.isFinite)
  };
}

function resolveScenario(
  bias: TechnicalCorrelationBias,
  trend: TechnicalTrend,
  distanceToSupportPct?: number,
  distanceToResistancePct?: number
): TechnicalCorrelationScenario {
  if (bias === "NEUTRAL") return trend === "RANGE" ? "RANGE_CONFIRMATION" : "NO_SIGNAL";

  const nearResistance = typeof distanceToResistancePct === "number" && Math.abs(distanceToResistancePct) <= 2;
  const nearSupport = typeof distanceToSupportPct === "number" && Math.abs(distanceToSupportPct) <= 2;

  if (bias === "BULLISH" && trend === "UPTREND") return nearResistance ? "BREAKOUT_WATCH" : "CONTINUATION";
  if (bias === "BEARISH" && trend === "DOWNTREND") return nearSupport ? "BREAKOUT_WATCH" : "CONTINUATION";
  if (bias === "BULLISH" && trend === "DOWNTREND") return "REVERSAL";
  if (bias === "BEARISH" && trend === "UPTREND") return "REVERSAL";
  return "RANGE_CONFIRMATION";
}

function buildRationale(result: Omit<NewsTechnicalCorrelationResult, "rationale" | "generatedAt" | "overlayAnnotations">): string {
  const levelText = [
    typeof result.nearestSupport === "number" ? `soporte cercano ${result.nearestSupport}` : undefined,
    typeof result.nearestResistance === "number" ? `resistencia cercana ${result.nearestResistance}` : undefined
  ]
    .filter(Boolean)
    .join(" y ");

  return `Correlacion ${result.bias.toLowerCase()} con escenario ${result.scenario.toLowerCase()}. ` +
    `Impacto de noticias ${result.newsImpactScore.toFixed(2)}, tendencia ${result.trend.toLowerCase()}. ` +
    `${levelText || "Sin niveles tecnicos suficientes"}. ` +
    `Continuidad ${(result.continuationProbability * 100).toFixed(0)}%, reversion ${(result.reversalProbability * 100).toFixed(0)}%.`;
}

export function correlateNewsWithTechnicalStructure(
  newsImpact: NewsImpactResult,
  context?: NewsTechnicalContext
): NewsTechnicalCorrelationResult {
  const symbol = context?.symbol?.trim().toUpperCase() || newsImpact.symbol;
  const bias = sentimentBias(newsImpact.sentiment, newsImpact.impactScore);
  const trend = inferTrend(context);
  const { supports, resistances } = normalizeLevels(context);
  const currentPrice = context?.currentPrice;

  const nearestSupport = typeof currentPrice === "number" ? nearestBelow(currentPrice, supports) : undefined;
  const nearestResistance = typeof currentPrice === "number" ? nearestAbove(currentPrice, resistances) : undefined;
  const distanceToSupportPct = typeof currentPrice === "number" ? pctDistance(currentPrice, nearestSupport) : undefined;
  const distanceToResistancePct = typeof currentPrice === "number" && nearestResistance
    ? Number((((nearestResistance - currentPrice) / currentPrice) * 100).toFixed(2))
    : undefined;

  const scenario = resolveScenario(bias, trend, distanceToSupportPct, distanceToResistancePct);
  const newsStrength = Math.abs(newsImpact.impactScore);
  const trendAlignment =
    (bias === "BULLISH" && trend === "UPTREND") || (bias === "BEARISH" && trend === "DOWNTREND")
      ? 0.25
      : scenario === "REVERSAL"
        ? -0.1
        : 0;

  const levelBoost = scenario === "BREAKOUT_WATCH" ? 0.15 : scenario === "RANGE_CONFIRMATION" ? 0.05 : 0;
  const continuationProbability = clamp(0.45 + newsStrength * 0.35 + trendAlignment + levelBoost, 0.05, 0.95);
  const reversalProbability = clamp(1 - continuationProbability, 0.05, 0.95);
  const confidence = clamp(Number((newsImpact.confidence * 0.55 + continuationProbability * 0.35 + newsStrength * 0.1).toFixed(3)), 0.25, 0.95);

  const base: Omit<NewsTechnicalCorrelationResult, "rationale" | "generatedAt" | "overlayAnnotations"> = {
    symbol,
    bias,
    scenario,
    confidence,
    newsImpactScore: newsImpact.impactScore,
    trend,
    nearestSupport,
    nearestResistance,
    distanceToSupportPct,
    distanceToResistancePct,
    continuationProbability: Number(continuationProbability.toFixed(3)),
    reversalProbability: Number(reversalProbability.toFixed(3))
  };

  return {
    ...base,
    rationale: buildRationale(base),
    overlayAnnotations: newsImpact.overlayAnnotations.map((annotation) => ({
      ...annotation,
      label: `${annotation.label} | ${scenario}`.slice(0, 160)
    })),
    generatedAt: new Date().toISOString()
  };
}
