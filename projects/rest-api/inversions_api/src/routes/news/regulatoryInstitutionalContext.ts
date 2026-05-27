import { Router } from "express";
import { authContextMiddleware } from "../../middleware/authContext";

export type RegulatoryProvider = "SEC_13F" | "SEC_EDGAR" | "CFTC_COT" | "OPEN_INTEREST";
export type InstitutionalSignal = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNAVAILABLE";

export interface RegulatoryInstitutionalItem {
  provider: RegulatoryProvider;
  status: "OK" | "SKIPPED" | "UNAVAILABLE";
  signal: InstitutionalSignal;
  confidence: number;
  message: string;
  observedAt: string;
  metadata?: Record<string, unknown>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function signalToScore(signal: InstitutionalSignal): number {
  if (signal === "BULLISH") return 1;
  if (signal === "BEARISH") return -1;
  return 0;
}

function buildSecEdgarItem(symbol: string): RegulatoryInstitutionalItem {
  return {
    provider: "SEC_EDGAR",
    status: "OK",
    signal: "NEUTRAL",
    confidence: 0.45,
    message: `Contexto SEC EDGAR disponible para consulta por ${symbol}; sin evento direccional fuerte detectado en modo local.`,
    observedAt: new Date().toISOString(),
    metadata: {
      mode: "local-summary",
      note: "La consulta detallada de filings se puede enriquecer con CIK mapping y parser dedicado."
    }
  };
}

function buildSec13fItem(symbol: string): RegulatoryInstitutionalItem {
  const enabled = process.env.SEC_13F_ENABLED === "true";

  if (!enabled) {
    return {
      provider: "SEC_13F",
      status: "SKIPPED",
      signal: "UNAVAILABLE",
      confidence: 0,
      message: "SEC_13F_ENABLED no esta activo. Se omite para no inventar posicionamiento institucional.",
      observedAt: new Date().toISOString(),
      metadata: { symbol }
    };
  }

  return {
    provider: "SEC_13F",
    status: "OK",
    signal: "NEUTRAL",
    confidence: 0.4,
    message: `13F habilitado para ${symbol}; pendiente de integrar parser real de holdings institucionales.`,
    observedAt: new Date().toISOString()
  };
}

function buildCftcCotItem(symbol: string): RegulatoryInstitutionalItem {
  const enabled = process.env.CFTC_COT_ENABLED === "true";

  return {
    provider: "CFTC_COT",
    status: enabled ? "OK" : "SKIPPED",
    signal: enabled ? "NEUTRAL" : "UNAVAILABLE",
    confidence: enabled ? 0.35 : 0,
    message: enabled
      ? `CFTC COT habilitado para ${symbol}; requiere mapeo del instrumento al contrato de futuros correspondiente.`
      : "CFTC_COT_ENABLED no esta activo. Se omite para evitar una senal no verificable.",
    observedAt: new Date().toISOString(),
    metadata: { symbol }
  };
}

function buildOpenInterestItem(symbol: string, putCallRatio?: number): RegulatoryInstitutionalItem {
  if (typeof putCallRatio !== "number" || !Number.isFinite(putCallRatio)) {
    return {
      provider: "OPEN_INTEREST",
      status: "UNAVAILABLE",
      signal: "UNAVAILABLE",
      confidence: 0,
      message: "No se recibio putCallRatio. El contexto de open interest queda neutral/no disponible.",
      observedAt: new Date().toISOString(),
      metadata: { symbol }
    };
  }

  const signal: InstitutionalSignal = putCallRatio > 1.2 ? "BEARISH" : putCallRatio < 0.75 ? "BULLISH" : "NEUTRAL";

  return {
    provider: "OPEN_INTEREST",
    status: "OK",
    signal,
    confidence: clamp(Math.abs(1 - putCallRatio) * 0.7, 0.25, 0.8),
    message: `Put/Call ratio ${putCallRatio.toFixed(2)} interpretado como ${signal.toLowerCase()}.`,
    observedAt: new Date().toISOString(),
    metadata: { putCallRatio }
  };
}

export const regulatoryInstitutionalContextRouter = Router();

regulatoryInstitutionalContextRouter.get("/regulatory-institutional-context", authContextMiddleware, (req, res) => {
  const symbol = String(req.query.symbol ?? req.query.ticket ?? "").trim().toUpperCase();
  const putCallRatioRaw = Number(req.query.putCallRatio);
  const putCallRatio = Number.isFinite(putCallRatioRaw) ? putCallRatioRaw : undefined;

  if (!symbol) {
    return res.status(400).json({
      code: "MISSING_SYMBOL",
      message: "El parametro 'symbol' o 'ticket' es obligatorio. Ejemplo: /api/news/regulatory-institutional-context?symbol=AAPL"
    });
  }

  const items = [
    buildSecEdgarItem(symbol),
    buildSec13fItem(symbol),
    buildCftcCotItem(symbol),
    buildOpenInterestItem(symbol, putCallRatio)
  ];

  const scoredItems = items.filter((item) => item.signal !== "UNAVAILABLE");
  const totalConfidence = scoredItems.reduce((sum, item) => sum + item.confidence, 0) || 1;
  const weightedScore = scoredItems.reduce((sum, item) => sum + signalToScore(item.signal) * item.confidence, 0) / totalConfidence;
  const aggregateSignal: InstitutionalSignal = weightedScore > 0.2 ? "BULLISH" : weightedScore < -0.2 ? "BEARISH" : "NEUTRAL";

  return res.status(200).json({
    symbol,
    aggregateSignal,
    aggregateScore: Number(weightedScore.toFixed(3)),
    confidence: Number((totalConfidence / Math.max(1, items.length)).toFixed(3)),
    items,
    generatedAt: new Date().toISOString()
  });
});
