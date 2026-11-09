/** How SimpleFIN investment transaction rows are classified, matched on the institution
 *  (`org.name`) and row description, never account names. First match wins, so
 *  institution-specific rules come before the generic keyword fallbacks. */
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
  /** Matches with this sign are a best guess (classified, never dropped; totals say "estimated"). */
  uncertainWhen?: "positive" | "negative";
  /**
   * The row's direction is fixed by its type, so use the absolute amount.
   * For types the feed has been seen to send with a flipped sign.
   */
  absoluteAmount?: boolean;
  /**
   * Card spending from an HSA names the merchant — health data. Ingest stores
   * these as "Medical withdrawal" (amount and date kept) unless the account
   * is linked to a non-HSA account type.
   */
  redactDescription?: boolean;
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
    // Paydays can arrive as negative "contribution" rows; a contribution is always
    // money in, so use the absolute amount but keep flagging the flipped sign.
    {
      id: "fidelity-contribution",
      institution: /^Fidelity/i,
      description: /^contribution$/,
      kind: "contribution",
      absoluteAmount: true,
      uncertainWhen: "negative",
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
      redactDescription: true,
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
      id: "generic-card-purchase",
      description: /DEBIT CARD|CARD PURCHASE|POS PURCHASE/i,
      kind: "withdrawal",
      redactDescription: true,
    },
    {
      id: "generic-withdrawal",
      description: /DISTRIBUTION|WITHDRAWAL|ROLLOVER OUT|TRANSFER OUT/i,
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
