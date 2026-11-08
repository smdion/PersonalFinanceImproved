/** Print-only "behind the scenes" assumptions section for the "fancy"
 *  retirement projection report. Mounted only when
 *  reportMode === "fancy" (see index.tsx). Read-only — plain labeled text,
 *  no InlineEdit, nothing clickable. Sources the same `engineSettings`
 *  object ProjectionCard's own state hook already computes (the settings
 *  echo `projection.computeProjection` returns), so this reads exactly what
 *  drove the numbers above it rather than a second, possibly-stale query.
 */
import { annualRaiseLabel } from "@/lib/pure/household/raise-rates";
import { filingStatusLabel } from "@/lib/config/display-labels";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { MAX_BROKERAGE_RAMP_YEARS } from "@/lib/constants";
import { WITHDRAWAL_STRATEGY_CONFIG } from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type {
  PerPersonSettings,
  Settings,
} from "@/components/retirement/sections/types";
import { parseAnnualPia } from "@/lib/config/social-security";

/** A settings number: decimal columns arrive as strings, the rest as numbers. */
type NumLike = number | string;

/** The `settings` computeProjection returns; any field may be missing. */
export type ReportEngineSettings = Partial<Settings>;

/** `null`/`undefined` → `undefined`; otherwise coerce to a real number. */
function num(v: NumLike | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

type ReportPerPersonSettings = NonNullable<PerPersonSettings>;

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
      <div className="text-faint mb-1 text-xs font-semibold tracking-wide uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

export function ReportAssumptionsSummary({
  settings,
  perPersonSettings,
  rmdExcessYears = 0,
  qcdYears = 0,
  irmaaCappedRothYears = 0,
}: {
  settings: ReportEngineSettings | undefined;
  /** Per-person retirement settings from the engine payload. For a
   *  single-person household the SS section sources start age / benefit
   *  from here (matching the live Social Security section and assumptions
   *  band), since "SS Start Age" and the per-person benefit are written to
   *  `retirement_profile_people`, not the household `retirement_settings`
   *  scalar this report otherwise reads. Undefined = fall back to
   *  `settings`. */
  perPersonSettings?: ReportPerPersonSettings;
  /** Count of years in this projection where RMD forced more
   *  out of Traditional than the strategy needed, with the excess
   *  reinvested into brokerage — a plan-level fact worth disclosing in
   *  summary even though per-year detail belongs on the live page, not a
   *  printed report. 0 = don't show the note. */
  rmdExcessYears?: number;
  /** Count of years with a Qualified Charitable Distribution
   *  applied. 0 = don't show the note. */
  qcdYears?: number;
  /** Count of years where a Roth conversion was reduced to stay under an
   *  IRMAA threshold (`irmaaAwareRothConversions`). 0 = don't show. */
  irmaaCappedRothYears?: number;
}) {
  if (!settings) return null;
  const strategyKey = settings.withdrawalStrategy as
    WithdrawalStrategyType | undefined;
  const strategyCfg = strategyKey
    ? WITHDRAWAL_STRATEGY_CONFIG[strategyKey]
    : undefined;
  const strategyLabel =
    strategyCfg?.label ?? settings.withdrawalStrategy ?? "—";
  // The strategy's own params, read-only: the paramFields
  // strategy-params.tsx renders for editing, each from its own column.
  const strategyParamRows = (strategyCfg?.paramFields ?? [])
    .map((f) => {
      const stored = settings[f.column];
      if (f.type === "boolean") {
        const on = stored == null ? f.default === true : stored === true;
        // The Social Security switch reads as a sentence; other switches
        // aren't shown (as before).
        if (f.key !== "ssInAmount") return null;
        return (
          <Row
            key={f.key}
            label="Social Security"
            value={
              on
                ? "comes out of the strategy's amount"
                : "on top of the withdrawal"
            }
          />
        );
      }
      const v = num(stored as NumLike | null | undefined);
      if (v == null) return null;
      const formatted = f.type === "percent" ? formatPercent(v, 1) : String(v);
      return <Row key={f.key} label={f.label} value={formatted} />;
    })
    .filter((row): row is React.ReactElement => row != null);

  const retirementAge = num(settings.retirementAge);
  const endAge = num(settings.endAge);
  const retirementYear = num(settings.retirementYear);
  const householdSize = num(settings.householdSize);
  const annualInflation = num(settings.annualInflation);
  const postRetirementInflation = num(settings.postRetirementInflation);
  const salaryAnnualIncrease = num(settings.salaryAnnualIncrease);
  const brokerageContributionIncrease = num(
    settings.brokerageContributionIncrease,
  );
  const salaryCap = num(settings.salaryCap);
  const withdrawalRate = num(settings.withdrawalRate);
  const rothConversionTarget = num(settings.rothConversionTarget);
  // Single-person household: source SS benefit / start age / PIA from the
  // per-person row, which is where the live UI writes them — the household
  // `settings` scalar can be stale for a household that's edited these.
  const soloPerson =
    perPersonSettings?.length === 1 ? perPersonSettings[0] : undefined;
  const socialSecurityMonthly = num(
    soloPerson?.socialSecurityMonthly ?? settings.socialSecurityMonthly,
  );
  const ssStartAge = num(soloPerson?.ssStartAge ?? settings.ssStartAge);
  // Display value stays MONTHLY (the row is labelled "/mo"); `hasPia` is
  // the canonical opt-in check (same `parseAnnualPia` the engine and the
  // live UI use — so an empty-string or "0" PIA reads as not-set here too).
  const socialSecurityPia = num(soloPerson?.socialSecurityPia);
  const hasPia = parseAnnualPia(soloPerson?.socialSecurityPia) != null;

  return (
    <div className="mt-6 break-before-page border-t pt-4">
      <h2 className="mb-2 text-lg font-semibold">Behind the Scenes</h2>
      <p className="text-muted mb-3 text-xs">
        The assumptions this projection is built on — change any of these on the
        Retirement or Budget pages and the numbers above will change too.
      </p>

      <Section title="Timeline">
        <Row
          label="Withdrawals start"
          value={retirementYear != null ? String(retirementYear) : "—"}
        />
        <Row
          label="Projection through"
          value={
            retirementYear != null && retirementAge != null && endAge != null
              ? String(retirementYear + endAge - retirementAge)
              : "—"
          }
        />
        {householdSize != null && (
          <Row label="Household size" value={String(householdSize)} />
        )}
        {settings.filingStatus && (
          <Row
            label="Tax filing status"
            value={filingStatusLabel(settings.filingStatus)}
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
          label="Post-retirement raise"
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
              ? annualRaiseLabel(salaryAnnualIncrease, perPersonSettings)
              : "—"
          }
        />
        {salaryCap != null && (
          <Row label="Salary growth cap" value={formatCurrency(salaryCap)} />
        )}
        {brokerageContributionIncrease != null &&
          brokerageContributionIncrease > 0 && (
            <Row
              label="Brokerage contribution increase"
              value={`${formatCurrency(brokerageContributionIncrease)}/yr (first ${MAX_BROKERAGE_RAMP_YEARS} years)`}
            />
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
        <p className="text-faint mt-0.5 text-xs">
          {strategyLabel} doesn&apos;t spend based on this rate — none of the 9
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

      {(socialSecurityMonthly != null || ssStartAge != null || hasPia) && (
        <Section title="Social Security">
          {hasPia && socialSecurityPia != null ? (
            <Row
              label="PIA (benefit at Full Retirement Age)"
              value={`${formatCurrency(socialSecurityPia)}/mo`}
            />
          ) : (
            socialSecurityMonthly != null && (
              <Row
                label="Estimated monthly benefit (today's dollars)"
                value={formatCurrency(socialSecurityMonthly)}
              />
            )
          )}
          {ssStartAge != null && (
            <Row
              label={
                hasPia
                  ? "Claiming age (benefit adjusted for early/delayed)"
                  : "Claiming age"
              }
              value={String(ssStartAge)}
            />
          )}
        </Section>
      )}

      {(settings.enableIrmaaAwareness || settings.enableAcaAwareness) && (
        <Section title="Healthcare & Medicare">
          {settings.enableIrmaaAwareness && (
            <Row
              label="IRMAA surcharge"
              value={
                settings.irmaaOnTopOfBudget
                  ? "On top of the budget"
                  : "In the budget"
              }
            />
          )}
          {settings.enableAcaAwareness && (
            <Row label="ACA subsidy awareness" value="Enabled" />
          )}
        </Section>
      )}

      {rmdExcessYears > 0 && (
        <p className="text-faint mt-2 text-xs">
          Note: {rmdExcessYears} year{rmdExcessYears === 1 ? "" : "s"} in this
          projection {rmdExcessYears === 1 ? "has" : "have"} Required Minimum
          Distributions exceeding this projection&apos;s stated spending need —
          {settings.rmdExcessHandling === "spend"
            ? " the excess is treated as spent, not reinvested."
            : " the excess is reinvested into a taxable brokerage account."}{" "}
          See the Retirement page for year-by-year detail.
        </p>
      )}

      {qcdYears > 0 && (
        <p className="text-faint mt-2 text-xs">
          Note: {qcdYears} year{qcdYears === 1 ? "" : "s"} in this projection{" "}
          {qcdYears === 1 ? "applies" : "apply"} a Qualified Charitable
          Distribution — money sent directly to charity from an IRA, satisfying
          part of the RMD without counting as taxable income. See the Retirement
          page for year-by-year detail.
        </p>
      )}

      {irmaaCappedRothYears > 0 && (
        <p className="text-faint mt-2 text-xs">
          Note: {irmaaCappedRothYears} year
          {irmaaCappedRothYears === 1 ? "" : "s"} in this projection{" "}
          {irmaaCappedRothYears === 1 ? "had a" : "had"} Roth conversion
          {irmaaCappedRothYears === 1 ? "" : "s"} capped to stay below the next
          IRMAA (Medicare premium) threshold — converting more would have
          crossed a surcharge cliff. The Roth &amp; conversions page flags the
          affected years.
        </p>
      )}
    </div>
  );
}
