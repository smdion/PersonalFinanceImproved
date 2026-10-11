/**
 * How SimpleFIN investment-account transaction rows are classified.
 *
 * Data, not code: a new institution's format is one more rule here. Rules
 * match on the institution (SimpleFIN `org.name`) and the row description —
 * never on account names, which are user/person specific. First match wins,
 * so institution-specific rules come before the generic keyword fallbacks.
 *
 * Known institution formats:
 * - Vanguard brokerage/IRA: only "CASH" rows are money crossing the account
 *   boundary (deposits, conversions, withdrawals). Settlement-fund rows
 *   ("…MONEY MARKET…", "CASH PLUS") are sweeps; fund rows are trades.
 * - Fidelity workplace 401k (NetBenefits): typed lowercase descriptions —
 *   "contribution" (one row per fund per payday), "dividend", "fees",
 *   "realizedGainLoss".
 * - Fidelity HSA (brokerage-style): "DEBIT CARD PURCHASE" = medical spending;
 *   core-account and REINVESTMENT rows stay inside the account.
 * - Voya 401k: rows carry only the fund name — positive = contribution,
 *   debits under 0.1% of the balance = fee (larger negatives need review).
 */
import type { InvestmentTransactionKind } from "./enum-values";

export type SimplefinTransactionRule = {
  /** Stable id, stored with each classified row so a later rule change is traceable. */
  id: string;
  /** Matches SimpleFIN `org.name`; omit for a rule that applies to every institution. */
  institution?: RegExp;
  /** Matches the row description. */
  description: RegExp;
  /** Restrict to positive or negative amounts. */
  sign?: "positive" | "negative";
  /**
   * Only rows whose absolute amount is at most this fraction of the account's
   * balance (e.g. 0.001 = 0.1%) — "small" relative to the account, so the rule
   * fits any account size. Without a known balance the rule doesn't match.
   */
  maxFractionOfBalance?: number;
  /** The kind, or one kind per sign for rows that go both ways (money in vs out). */
  kind:
    | InvestmentTransactionKind
    | {
        positive: InvestmentTransactionKind;
        negative: InvestmentTransactionKind;
      };
  /** Flag matches with this sign for the user to review (classified, never dropped). */
  reviewWhen?: "positive" | "negative";
  /**
   * The row's direction is fixed by its type, so use the absolute amount.
   * For types the feed has been seen to send with a flipped sign.
   */
  absoluteAmount?: boolean;
};

export const SIMPLEFIN_TRANSACTION_RULES: readonly SimplefinTransactionRule[] =
  [
    // ── Vanguard ──
    {
      id: "vanguard-cash",
      institution: /^Vanguard/i,
      description: /^CASH$/i,
      kind: { positive: "contribution", negative: "withdrawal" },
    },
    {
      id: "vanguard-settlement-fund",
      institution: /^Vanguard/i,
      description: /MONEY MARKET|CASH PLUS|SETTLEMENT/i,
      kind: "sweep",
    },
    {
      id: "vanguard-fund-trade",
      institution: /^Vanguard/i,
      description: /^VANGUARD /i,
      kind: "trade",
    },

    // ── Fidelity workplace plans (typed descriptions) ──
    // The feed has been seen sending whole paydays as negative "contribution"
    // rows that Fidelity's own history shows as normal positive contributions.
    // A plan contribution is always money in: use the absolute amount, but keep
    // flagging negative rows so a flipped sign stays visible.
    {
      id: "fidelity-contribution",
      institution: /^Fidelity/i,
      description: /^contribution$/,
      kind: "contribution",
      absoluteAmount: true,
      reviewWhen: "negative",
    },
    {
      id: "fidelity-dividend",
      institution: /^Fidelity/i,
      description: /^dividend$/,
      kind: "dividend",
    },
    {
      id: "fidelity-fees",
      institution: /^Fidelity/i,
      description: /^fees?$/,
      kind: "fee",
    },
    {
      id: "fidelity-realized-gain-loss",
      institution: /^Fidelity/i,
      description: /^realizedGainLoss$/,
      kind: "gain_loss",
    },

    // ── Fidelity brokerage-style (HSA) ──
    {
      id: "fidelity-debit-card",
      institution: /^Fidelity/i,
      description: /^DEBIT CARD PURCHASE/i,
      kind: "withdrawal",
    },
    {
      id: "fidelity-core-account",
      institution: /^Fidelity/i,
      description: /(REDEMPTION FROM|PURCHASE INTO) CORE ACCOUNT/i,
      kind: "sweep",
    },
    {
      id: "fidelity-reinvestment",
      institution: /^Fidelity/i,
      description: /^REINVESTMENT /i,
      kind: "trade",
    },
    {
      id: "fidelity-dividend-received",
      institution: /^Fidelity/i,
      description: /^DIVIDEND RECEIVED/i,
      kind: "dividend",
    },
    {
      id: "fidelity-bought-sold",
      institution: /^Fidelity/i,
      description: /^YOU (BOUGHT|SOLD) /i,
      kind: "trade",
    },

    // ── Voya (fund name only) ──
    {
      id: "voya-positive",
      institution: /^Voya/i,
      description: /./,
      sign: "positive",
      kind: "contribution",
    },
    {
      id: "voya-small-debit",
      institution: /^Voya/i,
      description: /./,
      sign: "negative",
      maxFractionOfBalance: 0.001,
      kind: "fee",
    },

    // ── Generic keyword fallbacks (any institution) ──
    {
      id: "generic-contribution",
      description: /CONTRIBUTION|DEPOSIT|ROLLOVER IN|TRANSFER IN/i,
      kind: "contribution",
    },
    {
      id: "generic-withdrawal",
      description:
        /DISTRIBUTION|WITHDRAWAL|ROLLOVER OUT|TRANSFER OUT|DEBIT CARD/i,
      kind: "withdrawal",
    },
    {
      id: "generic-dividend",
      description: /DIVIDEND|CAPITAL GAIN/i,
      kind: "dividend",
    },
    { id: "generic-interest", description: /INTEREST/i, kind: "interest" },
    {
      id: "generic-fee",
      description: /\bFEES?\b|EXPENSE|ADMIN CHARGE/i,
      kind: "fee",
    },
    {
      id: "generic-trade",
      description: /\b(BOUGHT|SOLD|BUY|SELL|REINVEST|EXCHANGE)\b/i,
      kind: "trade",
    },
  ];
