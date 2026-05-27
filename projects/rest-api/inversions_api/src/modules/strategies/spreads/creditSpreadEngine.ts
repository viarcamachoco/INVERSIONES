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

function payoffAtPrice(input: SpreadStrategyInput, price: number, netCreditPerShare: number): number {
  const intrinsicLiability = input.kind === "BEAR_CALL_CREDIT"
    ? callIntrinsic(price, input.shortLeg.strike) - callIntrinsic(price, input.longLeg.strike)
    : putIntrinsic(price, input.shortLeg.strike) - putIntrinsic(price, input.longLeg.strike);

  return round((netCreditPerShare - intrinsicLiability) * 100 * input.contracts);
}

export function evaluateCreditSpread(input: SpreadStrategyInput): SpreadStrategyMetrics {
  const issues = validateSpreadInput(input);

  if (input.kind !== "BULL_PUT_CREDIT" && input.kind !== "BEAR_CALL_CREDIT") {
    issues.push({ field: "kind", message: "El motor creditSpreadEngine solo acepta Bull Put Credit o Bear Call Credit.", severity: "ERROR" });
  }

  if (input.shortLeg.side !== "SELL" || input.longLeg.side !== "BUY") {
    issues.push({ field: "legs", message: "Un credit spread requiere vender la pierna short y comprar proteccion long.", severity: "ERROR" });
  }

  if (input.kind === "BULL_PUT_CREDIT" && input.shortLeg.strike <= input.longLeg.strike) {
    issues.push({ field: "strikes", message: "Bull Put Credit: el put vendido debe tener strike mayor que el put comprado.", severity: "ERROR" });
  }

  if (input.kind === "BEAR_CALL_CREDIT" && input.shortLeg.strike >= input.longLeg.strike) {
    issues.push({ field: "strikes", message: "Bear Call Credit: el call vendido debe tener strike menor que el call comprado.", severity: "ERROR" });
  }

  const width = Math.abs(input.shortLeg.strike - input.longLeg.strike);
  const netCreditPerShare = input.shortLeg.premium - input.longLeg.premium;

  if (netCreditPerShare <= 0) {
    issues.push({ field: "premium", message: "Un credit spread debe tener ingreso neto positivo.", severity: "ERROR" });
  }

  if (hasBlockingIssues(issues)) {
    return {
      symbol: input.symbol.toUpperCase(),
      kind: input.kind,
      direction: input.direction,
      netPremium: round(netCreditPerShare * 100 * input.contracts),
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

  const maxProfit = round(netCreditPerShare * 100 * input.contracts);
  const maxLoss = round((width - netCreditPerShare) * 100 * input.contracts);
  const breakEven = input.kind === "BULL_PUT_CREDIT"
    ? round(input.shortLeg.strike - netCreditPerShare)
    : round(input.shortLeg.strike + netCreditPerShare);
  const riskRewardRatio = maxLoss > 0 ? round(maxProfit / maxLoss) : 0;
  const capitalAtRiskPct = round((maxLoss / input.capital) * 100);
  const marginRequired = maxLoss;
  const stopLossLevel = round(maxProfit + maxLoss * (input.stopLossPct ?? 0.35));
  const targetProfitLevel = round(maxProfit * (input.targetProfitPct ?? 0.65));
  const payoff: SpreadPayoffPoint[] = buildPayoffRange(input.underlyingPrice, width).map((price) => ({
    underlyingPrice: price,
    pnl: payoffAtPrice(input, price, netCreditPerShare)
  }));

  const recommendation = resolveRecommendation({ capitalAtRiskPct, riskRewardRatio, maxLoss });

  return {
    symbol: input.symbol.toUpperCase(),
    kind: input.kind,
    direction: input.direction,
    netPremium: maxProfit,
    maxProfit,
    maxLoss,
    breakEven,
    riskRewardRatio,
    capitalAtRiskPct,
    marginRequired,
    stopLossLevel,
    targetProfitLevel,
    payoff,
    recommendation,
    rationale: `Credit spread con credito neto ${maxProfit}, riesgo maximo ${maxLoss}, margen requerido ${marginRequired} y break-even ${breakEven}.`,
    issues,
    generatedAt: new Date().toISOString()
  };
}
