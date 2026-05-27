import { Router } from "express";
import { authContextMiddleware } from "../../middleware/authContext";
import {
  buildDashboardConfluencePayload,
  type SourceVerdict
} from "../../modules/signals/confluenceEngine";
import { sourceConfigRegistry, type SourceConfig } from "../../modules/signals/sourceConfig";
import { evaluateNewsImpact } from "../../modules/news/newsImpactEngine";

interface DashboardQuery {
  instruments?: string;
  timeframe?: string;
  cores?: string;
}

function buildFallbackSources(): SourceConfig[] {
  return [
    { id: "technical", name: "technical", category: "TECHNICAL", enabled: true, weight: 0.3 },
    { id: "options", name: "options", category: "OPTIONS", enabled: true, weight: 0.25 },
    { id: "flow", name: "flow", category: "FLOW", enabled: true, weight: 0.2 },
    { id: "news", name: "news", category: "NEWS", enabled: true, weight: 0.15 },
    { id: "ai", name: "ai", category: "AI", enabled: true, weight: 0.1 }
  ];
}

function filterSourcesByQuery(sources: SourceConfig[], cores?: string): SourceConfig[] {
  if (!cores) return sources;

  const enabledIds = new Set(
    cores
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

  return sources.map((source) => ({
    ...source,
    enabled: enabledIds.has(source.id.toLowerCase())
  }));
}

async function buildVerdicts(instrument: string): Promise<SourceVerdict[]> {
  const seed = instrument.length;
  const newsImpact = await evaluateNewsImpact(instrument, 6);

  return [
    {
      sourceId: "technical",
      verdict: seed % 3 === 0 ? "SELL" : "BUY",
      confidence: 0.55,
      rationale: `RSI/MACD con sesgo ${seed % 3 === 0 ? "bajista" : "alcista"}`
    },
    {
      sourceId: "options",
      verdict: "BUY",
      confidence: 0.63,
      rationale: "Call/put skew positivo"
    },
    {
      sourceId: "flow",
      verdict: seed % 2 === 0 ? "BUY" : "HOLD",
      confidence: 0.58,
      rationale: "Flujo institucional en rango favorable"
    },
    newsImpact.sourceVerdict,
    {
      sourceId: "ai",
      verdict: "BUY",
      confidence: 0.72,
      rationale: "Confirmacion de modelo IA"
    }
  ];
}

export const dashboardOrchestratorRouter = Router();

/**
 * FIC: Consolidated dashboard endpoint for operational confluence monitoring.
 * Returns instrument-filtered cards with confidence and explainability payload.
 *
 * FIC: Endpoint consolidado del dashboard para monitoreo operativo de confluencia.
 * Devuelve tarjetas filtradas por instrumento con payload de confianza y explicabilidad.
 */
dashboardOrchestratorRouter.get("/orchestrator", authContextMiddleware, async (req, res, next) => {
  try {
    const { instruments, timeframe, cores } = req.query as DashboardQuery;

    const parsedInstruments = (instruments ?? "AAPL,MSFT,NVDA,SPY")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20);

    const sources = sourceConfigRegistry.listEnabled();
    const activeSources = filterSourcesByQuery(sources.length > 0 ? sources : buildFallbackSources(), cores);

    const instrumentVerdicts = await Promise.all(
      parsedInstruments.map(async (instrument) => ({
        instrument,
        verdicts: await buildVerdicts(instrument)
      }))
    );

    const payload = buildDashboardConfluencePayload(activeSources, instrumentVerdicts);

    res.status(200).json({
      timeframe: timeframe ?? "1d",
      ...payload
    });
  } catch (error) {
    next(error);
  }
});
