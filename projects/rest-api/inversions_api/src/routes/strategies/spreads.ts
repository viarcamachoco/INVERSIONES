import { Router } from "express";
import { authContextMiddleware } from "../../middleware/authContext";
import { evaluateCreditSpread } from "../../modules/strategies/spreads/creditSpreadEngine";
import { evaluateDebitSpread } from "../../modules/strategies/spreads/debitSpreadEngine";
import type { SpreadStrategyInput } from "../../modules/strategies/spreads/spreadStrategyContract";

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function nextMonthlyExpiration(): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 2);
  date.setUTCDate(19);
  return date.toISOString().slice(0, 10);
}

function strikeNear(price: number, offset: number): number {
  return Math.max(1, Math.round((price + offset) / 5) * 5);
}

function buildDemoDebitInput(symbol: string, underlyingPrice: number): SpreadStrategyInput {
  const lowerStrike = strikeNear(underlyingPrice, 0);
  const upperStrike = strikeNear(underlyingPrice, 10);

  return {
    symbol,
    kind: "BULL_CALL_DEBIT",
    direction: "BULLISH",
    underlyingPrice,
    contracts: 1,
    capital: 10000,
    riskTolerance: "MEDIUM",
    stopLossPct: 0.5,
    targetProfitPct: 0.65,
    longLeg: {
      optionType: "CALL",
      side: "BUY",
      strike: lowerStrike,
      premium: round(Math.max(1.5, underlyingPrice * 0.028)),
      expiration: nextMonthlyExpiration(),
      quantity: 1
    },
    shortLeg: {
      optionType: "CALL",
      side: "SELL",
      strike: upperStrike,
      premium: round(Math.max(0.5, underlyingPrice * 0.014)),
      expiration: nextMonthlyExpiration(),
      quantity: 1
    }
  };
}

function buildDemoCreditInput(symbol: string, underlyingPrice: number): SpreadStrategyInput {
  const shortStrike = strikeNear(underlyingPrice, -5);
  const longStrike = strikeNear(underlyingPrice, -15);

  return {
    symbol,
    kind: "BULL_PUT_CREDIT",
    direction: "BULLISH",
    underlyingPrice,
    contracts: 1,
    capital: 10000,
    riskTolerance: "MEDIUM",
    stopLossPct: 0.35,
    targetProfitPct: 0.65,
    longLeg: {
      optionType: "PUT",
      side: "BUY",
      strike: longStrike,
      premium: round(Math.max(0.35, underlyingPrice * 0.009)),
      expiration: nextMonthlyExpiration(),
      quantity: 1
    },
    shortLeg: {
      optionType: "PUT",
      side: "SELL",
      strike: shortStrike,
      premium: round(Math.max(0.8, underlyingPrice * 0.018)),
      expiration: nextMonthlyExpiration(),
      quantity: 1
    }
  };
}

function normalizeInput(body: unknown): SpreadStrategyInput {
  return body as SpreadStrategyInput;
}

export const spreadStrategyRouter = Router();

spreadStrategyRouter.get("/spreads/demo", authContextMiddleware, (req, res) => {
  const symbol = String(req.query.symbol ?? req.query.ticket ?? "AAPL").trim().toUpperCase();
  const underlyingPrice = toNumber(req.query.underlyingPrice ?? req.query.currentPrice, 200);

  const debitInput = buildDemoDebitInput(symbol, underlyingPrice);
  const creditInput = buildDemoCreditInput(symbol, underlyingPrice);

  return res.status(200).json({
    symbol,
    underlyingPrice,
    debit: evaluateDebitSpread(debitInput),
    credit: evaluateCreditSpread(creditInput),
    inputs: {
      debit: debitInput,
      credit: creditInput
    },
    generatedAt: new Date().toISOString()
  });
});

spreadStrategyRouter.post("/spreads/debit", authContextMiddleware, (req, res) => {
  const result = evaluateDebitSpread(normalizeInput(req.body));
  return res.status(200).json(result);
});

spreadStrategyRouter.post("/spreads/credit", authContextMiddleware, (req, res) => {
  const result = evaluateCreditSpread(normalizeInput(req.body));
  return res.status(200).json(result);
});
