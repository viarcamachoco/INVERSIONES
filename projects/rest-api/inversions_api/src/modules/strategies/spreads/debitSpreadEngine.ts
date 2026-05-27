import {
  buildPayoffRange,
  hasBlockingIssues,
  resolveRecommendation,
  type SpreadPayoffPoint,
  type SpreadStrategyInput,
  type SpreadStrategyMetrics,
  validateSpreadInput
} from "./spreadStrategyContract";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function callIntrinsic(price: number, strike: number): number {
  return Math.max(0, price - strike);
}

function putIntrinsic(price: number, strike: number): number {
  return Math.max(0, strike - price);
}

function payoffAtPrice(input: SpreadStrategyInput, price: number, netDebitPerShare: number): number {
  const intrinsic = input.kind === "BULL_CALL_DEBIT"
    ? callIntrinsic(price, input.longLeg.strike) - callIntrinsic(price, input.shortLeg.strike)
    : putIntrinsic(price, input.longLeg.strike) - putIntrinsic(price, input.shortLeg.strike);

  return round((intrinsic - netDebitPerShare) * 100 * input.contracts);
}

export function evaluateDebitSpread(input: SpreadStrategyInput): SpreadStrategyMetrics {
  const issues = validateSpreadInput(input);

  if (input.kind !== "BULL_CALL_DEBIT" && input.kind !== "BEAR_PUT_DEBIT") {
    issues.push({ field: "kind", message: "El motor debitSpreadEngine solo acepta Bull Call Debit o Bear Put Debit.", severity: "ERROR" });
  }

  if (input.longLeg.side !== "BUY" || input.shortLeg.side !== "SELL") {
    issues.push({ field: "legs", message: "Un debit spread requiere comprar la pierna long y vender la pierna short.", severity: "ERROR" });
  }

  if (input.kind === "BULL_CALL_DEBIT" && input.longLeg.strike >= input.shortLeg.strike) {
    issues.push({ field: "strikes", message: "Bull Call Debit: el strike comprado debe ser menor que el vendido.", severity: "ERROR" });
  }

  if (input.kind === "BEAR_PUT_DEBIT" && input.longLeg.strike <= input.shortLeg.strike) {
    issues.push({ field: "strikes", message: "Bear Put Debit: el strike comprado debe ser mayor que el vendido.", severity: "ERROR" });
  }

  const width = Math.abs(input.shortLeg.strike - input.longLeg.strike);
  const netDebitPerShare = input.longLeg.premium - input.shortLeg.premium;

  if (netDebitPerShare <= 0) {
    issues.push({ field: "premium", message: "Un debit spread debe tener costo neto positivo.", severity: "ERROR" });
  }

  if (hasBlockingIssues(issues)) {
    return {
      symbol: input.symbol.toUpperCase(),
      kind: input.kind,
      direction: input.direction,
      netPremium: round(netDebitPerShare * 100 * input.contracts),
      maxProfit: 0,
      maxLoss: 0,
      breakEven: 0,
      riskRewardRatio: 0,
      capitalAtRiskPct: 0,
      marginRequired: 0,
      stopLossLevel: 0,
      targetProfitLevel: 0,
      payoff: [],
      recommendation: "REJECT",
      rationale: "Estrategia rechazada por errores de validacion.",
      issues,
      generatedAt: new Date().toISOString()
    };
  }

  const totalDebit = round(netDebitPerShare * 100 * input.contracts);
  const maxLoss = totalDebit;
  const maxProfit = round((width - netDebitPerShare) * 100 * input.contracts);
  const breakEven = input.kind === "BULL_CALL_DEBIT"
    ? round(input.longLeg.strike + netDebitPerShare)
    : round(input.longLeg.strike - netDebitPerShare);
  const riskRewardRatio = maxLoss > 0 ? round(maxProfit / maxLoss) : 0;
  const capitalAtRiskPct = round((maxLoss / input.capital) * 100);
  const stopLossLevel = round(maxLoss * (input.stopLossPct ?? 0.5));
  const targetProfitLevel = round(maxProfit * (input.targetProfitPct ?? 0.65));
  const payoff: SpreadPayoffPoint[] = buildPayoffRange(input.underlyingPrice, width).map((price) => ({
    underlyingPrice: price,
    pnl: payoffAtPrice(input, price, netDebitPerShare)
  }));

  const recommendation = resolveRecommendation({ capitalAtRiskPct, riskRewardRatio, maxLoss });

  return {
    symbol: input.symbol.toUpperCase(),
    kind: input.kind,
    direction: input.direction,
    netPremium: totalDebit,
    maxProfit,
    maxLoss,
    breakEven,
    riskRewardRatio,
    capitalAtRiskPct,
    marginRequired: maxLoss,
    stopLossLevel,
    targetProfitLevel,
    payoff,
    recommendation,
    rationale: `Debit spread con costo neto ${totalDebit}, perdida maxima ${maxLoss}, ganancia maxima ${maxProfit} y break-even ${breakEven}.`,
    issues,
    generatedAt: new Date().toISOString()
  };
}
