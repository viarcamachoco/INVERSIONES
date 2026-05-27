import React, { useCallback, useEffect, useState } from "react";
import {
  getTeam06MarketSnapshot,
  getTeam06NewsConfluence,
  getTeam06RegulatoryContext,
  getTeam06SpreadDemo,
  type Team06MarketSnapshot,
  type Team06NewsResponse,
  type Team06RegulatoryResponse,
  type Team06SpreadMetrics,
  type Team06SpreadDemoResponse
} from "../../services/team06/team06Api";

interface Team06PanelProps {
  symbol: string;
  timeframe: string;
}

function formatPct(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  return `${Math.round(value * 100)}%`;
}

function formatMoney(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  return `$${value.toFixed(2)}`;
}

function trendLabel(trend?: string): string {
  switch (trend) {
    case "UPTREND":
      return "Alcista";
    case "DOWNTREND":
      return "Bajista";
    case "RANGE":
      return "Rango";
    default:
      return "Desconocida";
  }
}

function sentimentBadge(sentiment?: string): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: "999px",
    padding: "0.15rem 0.55rem",
    fontSize: "0.72rem",
    fontWeight: 700,
    border: "1px solid var(--color-border)"
  };

  if (sentiment === "POSITIVE" || sentiment === "BULLISH" || sentiment === "ACCEPTABLE") {
    return { ...base, color: "var(--color-buy)", background: "rgba(63, 185, 80, 0.08)" };
  }

  if (sentiment === "NEGATIVE" || sentiment === "BEARISH" || sentiment === "REJECT") {
    return { ...base, color: "var(--color-sell)", background: "rgba(248, 81, 73, 0.08)" };
  }

  return { ...base, color: "var(--color-text-muted)", background: "var(--color-surface-raised)" };
}

function SmallMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.5rem" }}>
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontWeight: 700, marginTop: "0.15rem" }}>{value}</div>
    </div>
  );
}

function ReadOnlyField({ label, value, helper }: { label: string; value: React.ReactNode; helper?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.72rem", color: "var(--color-text-muted)", marginBottom: "0.25rem", fontWeight: 700 }}>{label}</label>
      <div style={{
        width: "100%",
        minHeight: "34px",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface-raised)",
        color: "var(--color-text)",
        display: "flex",
        alignItems: "center",
        padding: "0 0.65rem",
        fontWeight: 700
      }}>
        {value}
      </div>
      {helper ? <div style={{ marginTop: "0.2rem", color: "var(--color-text-muted)", fontSize: "0.68rem" }}>{helper}</div> : null}
    </div>
  );
}

function SpreadCard({ title, metrics }: { title: string; metrics?: Team06SpreadMetrics }) {
  if (!metrics) {
    return <div style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>Sin datos de spread.</div>;
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.75rem", display: "grid", gap: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
        <strong>{title}</strong>
        <span style={sentimentBadge(metrics.recommendation)}>{metrics.recommendation}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem" }}>
        <SmallMetric label="Prima neta" value={formatMoney(metrics.netPremium)} />
        <SmallMetric label="Break-even" value={formatMoney(metrics.breakEven)} />
        <SmallMetric label="Ganancia max" value={formatMoney(metrics.maxProfit)} />
        <SmallMetric label="Pérdida max" value={formatMoney(metrics.maxLoss)} />
      </div>

      <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", lineHeight: 1.45 }}>
        {metrics.rationale}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.4rem", fontSize: "0.72rem" }}>
        <span>R/R: <strong>{metrics.riskRewardRatio}</strong></span>
        <span>Riesgo cap.: <strong>{metrics.capitalAtRiskPct}%</strong></span>
        <span>Issues: <strong>{metrics.issues.length}</strong></span>
      </div>
    </div>
  );
}

export function Team06Panel({ symbol, timeframe }: Team06PanelProps) {
  const [localSymbol, setLocalSymbol] = useState(symbol);
  const [putCallRatio, setPutCallRatio] = useState(0.85);
  const [marketSnapshot, setMarketSnapshot] = useState<Team06MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<Team06NewsResponse | null>(null);
  const [regulatory, setRegulatory] = useState<Team06RegulatoryResponse | null>(null);
  const [spreads, setSpreads] = useState<Team06SpreadDemoResponse | null>(null);

  useEffect(() => {
    setLocalSymbol(symbol);
  }, [symbol]);

  const refreshTeam06 = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = await getTeam06MarketSnapshot({ symbol: localSymbol, timeframe });
      setMarketSnapshot(snapshot);

      const [newsResult, regulatoryResult, spreadResult] = await Promise.all([
        getTeam06NewsConfluence({
          symbol: localSymbol,
          timeframe,
          currentPrice: snapshot.currentPrice,
          supports: snapshot.supports.join(","),
          resistances: snapshot.resistances.join(","),
          trend: snapshot.trend,
          limit: 5
        }),
        getTeam06RegulatoryContext({ symbol: localSymbol, putCallRatio }),
        getTeam06SpreadDemo({ symbol: localSymbol, underlyingPrice: snapshot.currentPrice })
      ]);

      setNews(newsResult);
      setRegulatory(regulatoryResult);
      setSpreads(spreadResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar TEAM-06");
    } finally {
      setLoading(false);
    }
  }, [localSymbol, putCallRatio, timeframe]);

  const articles = news?.articles ?? news?.events ?? [];

  return (
    <div className="card" style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h2>Panel TEAM-06</h2>
          <p style={{ margin: "0.25rem 0 0", color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
            Noticias, correlación técnica, contexto institucional y spreads de opciones.
          </p>
          <p style={{ margin: "0.25rem 0 0", color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Precio y tendencia se obtienen de datos reales de Yahoo Finance. Put/Call queda manual hasta conectar una API de opciones real.
          </p>
        </div>
        <button className="btn-primary" onClick={() => void refreshTeam06()} disabled={loading}>
          {loading ? "Cargando…" : "Actualizar TEAM-06"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.65rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.72rem", color: "var(--color-text-muted)", marginBottom: "0.25rem", fontWeight: 700 }}>Símbolo</label>
          <input value={localSymbol} onChange={(event) => setLocalSymbol(event.target.value.toUpperCase())} />
        </div>
        <ReadOnlyField label="Precio actual real" value={marketSnapshot ? `${formatMoney(marketSnapshot.currentPrice)} ${marketSnapshot.currency ?? ""}` : "N/D"} helper={marketSnapshot ? `Fuente ${marketSnapshot.source} · ${marketSnapshot.marketTime ?? marketSnapshot.generatedAt}` : "Se consulta en Yahoo Finance con el botón"} />
        <div>
          <label style={{ display: "block", fontSize: "0.72rem", color: "var(--color-text-muted)", marginBottom: "0.25rem", fontWeight: 700 }}>Put/Call ratio manual</label>
          <input type="number" step="0.05" value={putCallRatio} onChange={(event) => setPutCallRatio(Number(event.target.value))} />
        </div>
        <ReadOnlyField label="Tendencia real calculada" value={trendLabel(marketSnapshot?.trend)} helper={marketSnapshot ? `Soportes ${marketSnapshot.supports.join(", ")} · Resistencias ${marketSnapshot.resistances.join(", ")}` : "Se calcula con velas reales de Yahoo Finance"} />
      </div>

      {error ? (
        <div style={{ border: "1px solid var(--color-sell)", color: "var(--color-sell)", borderRadius: "var(--radius-sm)", padding: "0.65rem" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
        <section style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.85rem", display: "grid", gap: "0.7rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>Noticias + técnico</h3>
            <span style={sentimentBadge(news?.sentiment)}>{news?.sentiment ?? "N/D"}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
            <SmallMetric label="Impacto" value={news?.impactScore?.toFixed(3) ?? "N/D"} />
            <SmallMetric label="Confianza" value={formatPct(news?.confidence)} />
            <SmallMetric label="Señal" value={news?.sourceVerdict?.verdict ?? "N/D"} />
          </div>

          <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.6rem", fontSize: "0.78rem" }}>
            <strong>Correlación técnica:</strong>{" "}
            <span style={{ color: "var(--color-text-muted)" }}>
              {news?.technicalCorrelation?.scenario ?? "Sin escenario"} · Bias {news?.technicalCorrelation?.bias ?? "N/D"} · Continuidad {formatPct(news?.technicalCorrelation?.continuationProbability)}
            </span>
          </div>

          <div>
            <strong style={{ fontSize: "0.82rem" }}>Titulares analizados</strong>
            <ul style={{ margin: "0.45rem 0 0 1rem", padding: 0, display: "grid", gap: "0.35rem", fontSize: "0.76rem", color: "var(--color-text-muted)" }}>
              {articles.slice(0, 3).map((article) => (
                <li key={article.id}>
                  <span style={sentimentBadge(article.sentiment)}>{article.sentiment ?? "N/D"}</span>{" "}
                  {article.title}
                </li>
              ))}
              {articles.length === 0 ? <li>Sin noticias reales suficientes para este símbolo.</li> : null}
            </ul>
          </div>
        </section>

        <section style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.85rem", display: "grid", gap: "0.7rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>Regulatorio / institucional</h3>
            <span style={sentimentBadge(regulatory?.aggregateSignal)}>{regulatory?.aggregateSignal ?? "N/D"}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
            <SmallMetric label="Score" value={regulatory?.aggregateScore?.toFixed(3) ?? "N/D"} />
            <SmallMetric label="Confianza" value={formatPct(regulatory?.confidence)} />
          </div>

          <div style={{ display: "grid", gap: "0.45rem" }}>
            {(regulatory?.items ?? []).map((item) => (
              <div key={item.provider} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.5rem", fontSize: "0.76rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <strong>{item.provider}</strong>
                  <span style={sentimentBadge(item.signal)}>{item.status}</span>
                </div>
                <div style={{ color: "var(--color-text-muted)", marginTop: "0.25rem" }}>{item.message}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.85rem", display: "grid", gap: "0.7rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>Spreads</h3>
            <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>Con precio real</span>
          </div>
          <SpreadCard title="Debit Spread" metrics={spreads?.debit} />
          <SpreadCard title="Credit Spread" metrics={spreads?.credit} />
        </section>
      </div>
    </div>
  );
}
