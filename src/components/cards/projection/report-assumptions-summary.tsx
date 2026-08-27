/** Print-only "behind the scenes" assumptions section for the "fancy"
 *  retirement projection report (R42). Mounted only when
 *  reportMode === "fancy" (see index.tsx). Read-only — plain labeled text,
 *  no InlineEdit, nothing clickable. Sources the same `engineSettings`
 *  object ProjectionCard's own state hook already computes (the settings
 *  echo `projection.computeProjection` returns), so this reads exactly what
 *  drove the numbers above it rather than a second, possibly-stale query.
 */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { WITHDRAWAL_STRATEGY_LABELS } from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

/** Numeric fields on the echo'd settings object come back as decimal
 *  strings for some (drizzle decimal columns) and plain numbers for others
 *  — accept both here rather than pinning down which is which per field. */
type NumLike = number | string;

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
}: {
  settings: ReportEngineSettings | undefined;
}) {
  if (!settings) return null;
  const strategyLabel = settings.withdrawalStrategy
    ? (WITHDRAWAL_STRATEGY_LABELS[
        settings.withdrawalStrategy as WithdrawalStrategyType
      ] ?? settings.withdrawalStrategy)
    : "—";

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
          <Row label="Tax filing status" value={settings.filingStatus} />
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
        <Row
          label="Withdrawal rate"
          value={
            withdrawalRate != null ? formatPercent(withdrawalRate, 1) : "—"
          }
        />
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
    </div>
  );
}
