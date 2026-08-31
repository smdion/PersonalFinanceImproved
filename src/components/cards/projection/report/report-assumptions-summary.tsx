/** Print-only "behind the scenes" assumptions section for the "fancy"
 *  retirement projection report (R42). Mounted only when
 *  reportMode === "fancy" (see index.tsx). Read-only — plain labeled text,
 *  no InlineEdit, nothing clickable. Sources the same `engineSettings`
 *  object ProjectionCard's own state hook already computes (the settings
 *  echo `projection.computeProjection` returns), so this reads exactly what
 *  drove the numbers above it rather than a second, possibly-stale query.
 */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { WITHDRAWAL_STRATEGY_CONFIG } from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

/** Numeric fields on the echo'd settings object come back as decimal
 *  strings for some (drizzle decimal columns) and plain numbers for others
 *  — accept both here rather than pinning down which is which per field. */
type NumLike = number | string;

/** Human-readable labels for the engine's short-code filing status
 *  (`FilingStatusType`/`W4FilingStatus` — "MFJ"/"Single"/"HOH") — this
 *  printed report is a client-facing document, so it must never render
 *  the raw short code (advisor review, 2026-08-29 — "never render raw DB
 *  keys" rule). Falls back to the raw value for anything unrecognized
 *  rather than hiding it. */
const FILING_STATUS_LABELS: Record<string, string> = {
  MFJ: "Married Filing Jointly",
  Single: "Single",
  HOH: "Head of Household",
};

/** Structural subset of the `settings` object `projection.computeProjection`
 *  returns (see `src/server/routers/projection/scenarios.ts`) — named
 *  locally, same convention as `EligibilityAccountInput`, so this component
 *  only has to agree on the fields it actually renders. */
export type ReportEngineSettings = {
  retirementAge?: NumLike | null;
  endAge?: NumLike | null;
  annualInflation?: NumLike | null;
  postRetirementInflation?: NumLike | null;
  salaryAnnualIncrease?: NumLike | null;
  salaryCap?: NumLike | null;
  withdrawalRate?: NumLike | null;
  withdrawalStrategy?: string | null;
  enableRothConversions?: boolean | null;
  rothConversionTarget?: NumLike | null;
  socialSecurityMonthly?: NumLike | null;
  ssStartAge?: NumLike | null;
  enableIrmaaAwareness?: boolean | null;
  enableAcaAwareness?: boolean | null;
  householdSize?: NumLike | null;
  filingStatus?: string | null;
  /** R46: what happens to RMD-forced excess beyond stated spending need. */
  rmdExcessHandling?: string | null;
  // Per-strategy params (R45 Step 3, Finding 3) — one strategy's fields are
  // actually read at a time, keyed by WITHDRAWAL_STRATEGY_CONFIG's
  // paramFields for the active withdrawalStrategy, same source
  // strategy-params.tsx uses so this can't drift from the real fields.
  gkUpperGuardrail?: NumLike | null;
  gkLowerGuardrail?: NumLike | null;
  gkIncreasePct?: NumLike | null;
  gkDecreasePct?: NumLike | null;
  sdAnnualDeclineRate?: NumLike | null;
  cpWithdrawalPercent?: NumLike | null;
  cpFloorPercent?: NumLike | null;
  enWithdrawalPercent?: NumLike | null;
  enRollingYears?: NumLike | null;
  enFloorPercent?: NumLike | null;
  vdBasePercent?: NumLike | null;
  vdCeilingPercent?: NumLike | null;
  vdFloorPercent?: NumLike | null;
  rmdMultiplier?: NumLike | null;
};

/** `null`/`undefined` → `undefined`; otherwise coerce to a real number. */
function num(v: NumLike | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 break-inside-avoid">
      <div className="text-xs font-semibold uppercase tracking-wide text-faint mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

export function ReportAssumptionsSummary({
  settings,
  rmdExcessYears = 0,
  qcdYears = 0,
}: {
  settings: ReportEngineSettings | undefined;
  /** R46 Phase 1: count of years in this projection where RMD forced more
   *  out of Traditional than the strategy needed, with the excess
   *  reinvested into brokerage — a plan-level fact worth disclosing in
   *  summary even though per-year detail belongs on the live page, not a
   *  printed report. 0 = don't show the note. */
  rmdExcessYears?: number;
  /** R46 Phase 2: count of years with a Qualified Charitable Distribution
   *  applied. 0 = don't show the note. */
  qcdYears?: number;
}) {
  if (!settings) return null;
  const strategyKey = settings.withdrawalStrategy as
    WithdrawalStrategyType | undefined;
  const strategyCfg = strategyKey
    ? WITHDRAWAL_STRATEGY_CONFIG[strategyKey]
    : undefined;
  const strategyLabel =
    strategyCfg?.label ?? settings.withdrawalStrategy ?? "—";
  // The strategy's own real params (R45 Step 3, Finding 3) — same
  // paramFields strategy-params.tsx renders for editing, read-only here.
  // Explicit lookup (not a cast off `settings`) so this stays typed to the
  // fields ReportEngineSettings actually declares.
  const strategyParamValues: Record<string, NumLike | null | undefined> = {
    gkUpperGuardrail: settings.gkUpperGuardrail,
    gkLowerGuardrail: settings.gkLowerGuardrail,
    gkIncreasePct: settings.gkIncreasePct,
    gkDecreasePct: settings.gkDecreasePct,
    sdAnnualDeclineRate: settings.sdAnnualDeclineRate,
    cpWithdrawalPercent: settings.cpWithdrawalPercent,
    cpFloorPercent: settings.cpFloorPercent,
    enWithdrawalPercent: settings.enWithdrawalPercent,
    enRollingYears: settings.enRollingYears,
    enFloorPercent: settings.enFloorPercent,
    vdBasePercent: settings.vdBasePercent,
    vdCeilingPercent: settings.vdCeilingPercent,
    vdFloorPercent: settings.vdFloorPercent,
    rmdMultiplier: settings.rmdMultiplier,
  };
  const strategyParamRows = (strategyCfg?.paramFields ?? [])
    .filter((f) => typeof f.default !== "boolean")
    .map((f) => {
      const v = num(strategyParamValues[f.key]);
      if (v == null) return null;
      const formatted = f.type === "percent" ? formatPercent(v, 1) : String(v);
      return <Row key={f.key} label={f.label} value={formatted} />;
    })
    .filter((row): row is React.ReactElement => row != null);

  const retirementAge = num(settings.retirementAge);
  const endAge = num(settings.endAge);
  const householdSize = num(settings.householdSize);
  const annualInflation = num(settings.annualInflation);
  const postRetirementInflation = num(settings.postRetirementInflation);
  const salaryAnnualIncrease = num(settings.salaryAnnualIncrease);
  const salaryCap = num(settings.salaryCap);
  const withdrawalRate = num(settings.withdrawalRate);
  const rothConversionTarget = num(settings.rothConversionTarget);
  const socialSecurityMonthly = num(settings.socialSecurityMonthly);
  const ssStartAge = num(settings.ssStartAge);

  return (
    <div className="mt-6 border-t pt-4 break-before-page">
      <h2 className="text-lg font-semibold mb-2">Behind the Scenes</h2>
      <p className="text-xs text-muted mb-3">
        The assumptions this projection is built on — change any of these on the
        Retirement or Budget pages and the numbers above will change too.
      </p>

      <Section title="Timeline">
        <Row
          label="Retirement age"
          value={retirementAge != null ? String(retirementAge) : "—"}
        />
        <Row
          label="Plan end age"
          value={endAge != null ? String(endAge) : "—"}
        />
        {householdSize != null && (
          <Row label="Household size" value={String(householdSize)} />
        )}
        {settings.filingStatus && (
          <Row
            label="Tax filing status"
            value={
              FILING_STATUS_LABELS[settings.filingStatus] ??
              settings.filingStatus
            }
          />
        )}
      </Section>

      <Section title="Growth Assumptions">
        <Row
          label="Inflation (pre-retirement)"
          value={
            annualInflation != null ? formatPercent(annualInflation, 1) : "—"
          }
        />
        <Row
          label="Inflation (post-retirement)"
          value={
            postRetirementInflation != null
              ? formatPercent(postRetirementInflation, 1)
              : "—"
          }
        />
        <Row
          label="Annual raise assumption"
          value={
            salaryAnnualIncrease != null
              ? formatPercent(salaryAnnualIncrease, 1)
              : "—"
          }
        />
        {salaryCap != null && (
          <Row label="Salary growth cap" value={formatCurrency(salaryCap)} />
        )}
      </Section>

      <Section title="Withdrawal Strategy">
        <Row label="Strategy" value={strategyLabel} />
        {strategyParamRows}
        <Row
          label="Initial withdrawal rate (reference only)"
          value={
            withdrawalRate != null ? formatPercent(withdrawalRate, 1) : "—"
          }
        />
        <p className="text-xs text-faint mt-0.5">
          {strategyLabel} doesn&apos;t spend based on this rate — none of the 8
          withdrawal strategies do. It&apos;s a reference figure only (also used
          to size the &ldquo;years to FI&rdquo; estimate elsewhere in the app).
        </p>
        {settings.enableRothConversions && (
          <Row
            label="Roth conversions"
            value={
              rothConversionTarget != null
                ? `Enabled, target bracket ${formatPercent(rothConversionTarget, 0)}`
                : "Enabled"
            }
          />
        )}
      </Section>

      {(socialSecurityMonthly != null || ssStartAge != null) && (
        <Section title="Social Security">
          {socialSecurityMonthly != null && (
            <Row
              label="Estimated monthly benefit"
              value={formatCurrency(socialSecurityMonthly)}
            />
          )}
          {ssStartAge != null && (
            <Row label="Claiming age" value={String(ssStartAge)} />
          )}
        </Section>
      )}

      {(settings.enableIrmaaAwareness || settings.enableAcaAwareness) && (
        <Section title="Healthcare & Medicare">
          {settings.enableIrmaaAwareness && (
            <Row label="IRMAA awareness" value="Enabled" />
          )}
          {settings.enableAcaAwareness && (
            <Row label="ACA subsidy awareness" value="Enabled" />
          )}
        </Section>
      )}

      {rmdExcessYears > 0 && (
        <p className="text-xs text-faint mt-2">
          Note: {rmdExcessYears} year{rmdExcessYears === 1 ? "" : "s"} in this
          projection {rmdExcessYears === 1 ? "has" : "have"} Required Minimum
          Distributions exceeding this plan&apos;s stated spending need —
          {settings.rmdExcessHandling === "spend"
            ? " the excess is treated as spent, not reinvested."
            : " the excess is reinvested into a taxable brokerage account."}{" "}
          See the Retirement page for year-by-year detail.
        </p>
      )}

      {qcdYears > 0 && (
        <p className="text-xs text-faint mt-2">
          Note: {qcdYears} year{qcdYears === 1 ? "" : "s"} in this projection{" "}
          {qcdYears === 1 ? "applies" : "apply"} a Qualified Charitable
          Distribution — money sent directly to charity from an IRA, satisfying
          part of the RMD without counting as taxable income. See the Retirement
          page for year-by-year detail.
        </p>
      )}
    </div>
  );
}
