export type SpreadDirection = "BULLISH" | "BEARISH";
export type SpreadKind = "BULL_CALL_DEBIT" | "BEAR_PUT_DEBIT" | "BULL_PUT_CREDIT" | "BEAR_CALL_CREDIT";
export type SpreadRiskTolerance = "LOW" | "MEDIUM" | "HIGH";

export interface OptionLegInput {
  optionType: "CALL" | "PUT";
  side: "BUY" | "SELL";
  strike: number;
  premium: number;
  expiration: string;
  quantity: number;
}

export interface SpreadStrategyInput {
  symbol: string;
  kind: SpreadKind;
  direction: SpreadDirection;
  underlyingPrice: number;
  longLeg: OptionLegInput;
  shortLeg: OptionLegInput;
  contracts: number;
  capital: number;
  riskTolerance: SpreadRiskTolerance;
  stopLossPct?: number;
  targetProfitPct?: number;
}

export interface SpreadValidationIssue {
  field: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface SpreadPayoffPoint {
  underlyingPrice: number;
  pnl: number;
}

export interface SpreadStrategyMetrics {
  symbol: string;
  kind: SpreadKind;
  direction: SpreadDirection;
  netPremium: number;
  maxProfit: number;
  maxLoss: number;
  breakEven: number;
  riskRewardRatio: number;
  capitalAtRiskPct: number;
  marginRequired: number;
  stopLossLevel: number;
  targetProfitLevel: number;
  payoff: SpreadPayoffPoint[];
  recommendation: "ACCEPTABLE" | "WATCH" | "REJECT";
  rationale: string;
  issues: SpreadValidationIssue[];
  generatedAt: string;
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateSpreadInput(input: SpreadStrategyInput): SpreadValidationIssue[] {
  const issues: SpreadValidationIssue[] = [];

  if (!input.symbol.trim()) {
    issues.push({ field: "symbol", message: "El simbolo es obligatorio.", severity: "ERROR" });
  }

  if (!isPositiveNumber(input.underlyingPrice)) {
    issues.push({ field: "underlyingPrice", message: "El precio del subyacente debe ser mayor a 0.", severity: "ERROR" });
  }

  if (!isPositiveNumber(input.capital)) {
    issues.push({ field: "capital", message: "El capital disponible debe ser mayor a 0.", severity: "ERROR" });
  }

  if (!Number.isInteger(input.contracts) || input.contracts <= 0) {
    issues.push({ field: "contracts", message: "La cantidad de contratos debe ser un entero mayor a 0.", severity: "ERROR" });
  }

  for (const [name, leg] of [["longLeg", input.longLeg], ["shortLeg", input.shortLeg]] as const) {
    if (!isPositiveNumber(leg.strike)) {
      issues.push({ field: `${name}.strike`, message: "El strike debe ser mayor a 0.", severity: "ERROR" });
    }

    if (!Number.isFinite(leg.premium) || leg.premium < 0) {
      issues.push({ field: `${name}.premium`, message: "La prima no puede ser negativa.", severity: "ERROR" });
    }

    if (!Number.isInteger(leg.quantity) || leg.quantity <= 0) {
      issues.push({ field: `${name}.quantity`, message: "La cantidad por pierna debe ser mayor a 0.", severity: "ERROR" });
    }

    if (!leg.expiration) {
      issues.push({ field: `${name}.expiration`, message: "El vencimiento es obligatorio.", severity: "ERROR" });
    }
  }

  if (input.longLeg.expiration !== input.shortLeg.expiration) {
    issues.push({ field: "expiration", message: "Ambas piernas deben tener el mismo vencimiento.", severity: "ERROR" });
  }

  if (input.longLeg.optionType !== input.shortLeg.optionType) {
    issues.push({ field: "optionType", message: "Ambas piernas deben ser del mismo tipo de opcion.", severity: "ERROR" });
  }

  if (input.longLeg.quantity !== input.shortLeg.quantity) {
    issues.push({ field: "quantity", message: "Las piernas deben tener la misma cantidad.", severity: "ERROR" });
  }

  return issues;
}

export function hasBlockingIssues(issues: SpreadValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "ERROR");
}

export function buildPayoffRange(centerPrice: number, width: number): number[] {
  const min = Math.max(1, centerPrice - width * 2);
  const max = centerPrice + width * 2;
  const step = Math.max(0.5, (max - min) / 8);
  const values: number[] = [];

  for (let price = min; price <= max + 0.0001; price += step) {
    values.push(Number(price.toFixed(2)));
  }

  return values;
}

export function resolveRecommendation(metrics: Pick<SpreadStrategyMetrics, "capitalAtRiskPct" | "riskRewardRatio" | "maxLoss">): SpreadStrategyMetrics["recommendation"] {
  if (metrics.maxLoss <= 0) return "REJECT";
  if (metrics.capitalAtRiskPct > 35) return "REJECT";
  if (metrics.riskRewardRatio >= 0.8 && metrics.capitalAtRiskPct <= 20) return "ACCEPTABLE";
  return "WATCH";
}
