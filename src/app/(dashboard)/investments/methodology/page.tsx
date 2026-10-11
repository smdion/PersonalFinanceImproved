/**
 * How Ledgr compares your investments with the market — plain-language
 * methodology. Each section starts with a worked example, then the rule.
 */
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { BENCHMARKS } from "@/lib/config/benchmarks";

function Section({
  id,
  title,
  example,
  children,
}: {
  id: string;
  title: string;
  example: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <Card title={title}>
        <div className="bg-surface-elevated text-secondary mb-3 rounded p-3 text-sm">
          <span className="text-faint mr-1 text-xs font-medium uppercase">
            Example
          </span>
          {example}
        </div>
        <div className="text-secondary space-y-2 text-sm">{children}</div>
      </Card>
    </section>
  );
}

const SECTIONS = [
  ["same-money", "Same money, same dates"],
  ["your-return", "Your return"],
  ["rough-or-verdict", "Rough comparison or verdict"],
  ["yearly-records", "Years with yearly records only"],
  ["index-prices", "How indexes are priced"],
  ["estimated", "Estimated values"],
  ["matched-mix", "Matched to your mix, and where the difference came from"],
] as const;

export default function MethodologyPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="How the comparison works"
        subtitle={
          <>
            The rules behind{" "}
            <Link href="/investments" className="underline">
              Investments
            </Link>
            , in plain language.
          </>
        }
      />

      <nav className="flex flex-wrap gap-1.5">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="bg-surface-elevated text-muted hover:bg-surface-strong rounded-full px-2.5 py-0.5 text-xs"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section
        id="same-money"
        title="Same money, same dates"
        example={
          <>
            You started 2023 with $10,000 and added $100 every month. The
            &ldquo;S&amp;P 500&rdquo; line starts with the same $10,000 in an
            S&amp;P 500 fund and adds the same $100 each month. At the end of
            the year the only difference between the two lines is what the money
            was invested in.
          </>
        }
      >
        <p>
          Each index line receives exactly your money on your schedule: your
          opening balance, each year&apos;s deposits and withdrawals spread
          across its months, and any money that moved in between years (such as
          a rollover) at the start of that year.
        </p>
        <p>
          So a line above yours means the same money would have grown more in
          that index — not that you should have saved more.
        </p>
      </Section>

      <Section
        id="your-return"
        title="Your return (includes when you added money)"
        example={
          <>
            You start the year with $10,000, add $1,200 over the year, and end
            at $12,300. The gain is $1,100 ($12,300 − $10,000 − $1,200). Money
            added during the year was invested for about half of it on average,
            so the return is $1,100 ÷ ($10,000 + $600) ≈ 10.4%.
          </>
        }
      >
        <p>
          This is a money-weighted return — the same one the Performance page
          shows for each year. Over several years Ledgr finds the single yearly
          rate that turns everything you put in into what you have now (an
          internal rate of return). Periods shorter than a year are shown as
          &ldquo;so far&rdquo;, never stretched to a yearly rate.
        </p>
        <p>
          A fund return that ignores the timing of your deposits (time-weighted)
          will appear once Ledgr has your holdings for the period.
        </p>
      </Section>

      <Section
        id="rough-or-verdict"
        title="Rough comparison or verdict"
        example={
          <>
            &ldquo;You beat the S&amp;P 500&rdquo; only means something if Ledgr
            knows what you actually held. Until then it says &ldquo;Rough
            comparison&rdquo;: same money, same dates, but no judgement.
          </>
        }
      >
        <p>
          A verdict needs your holdings known for at least three years —
          reported by SimpleFIN or confirmed by you. With less, the numbers are
          still shown, without a verdict.
        </p>
      </Section>

      <Section
        id="yearly-records"
        title="Years with yearly records only"
        example={
          <>
            For 2017 Ledgr only has your yearly totals: start, deposits, gain,
            end. It can compare the year as a whole, but not what happened
            inside it — a March crash and a December recovery look like one
            quiet year.
          </>
        }
      >
        <p>
          For those years the comparison is year by year. Drops within a year,
          volatility and the fund return aren&apos;t shown — five yearly points
          are too few to measure them honestly.
        </p>
        <p>
          Years with flat estimated amounts and no gain (placeholders) are not
          used as the default starting point, but you can still choose them.
        </p>
      </Section>

      <Section
        id="index-prices"
        title="How indexes are priced"
        example={
          <>
            You can&apos;t buy &ldquo;the S&amp;P 500&rdquo; itself, so Ledgr
            prices it with a low-cost fund that tracks it, with dividends
            reinvested — what an ordinary investor could actually have owned.
          </>
        }
      >
        <ul className="list-disc pl-5">
          {BENCHMARKS.map((b) => (
            <li key={b.key}>
              <span className="text-primary font-medium">{b.label}</span> —{" "}
              {b.description}
            </li>
          ))}
        </ul>
        <p>
          Prices come from Tiingo (month-end, total return). Connect it in
          Settings → Integrations.
        </p>
      </Section>

      <Section
        id="estimated"
        title="Estimated values"
        example={
          <>
            A workplace plan fund with no public ticker can&apos;t be priced
            directly. Ledgr uses a public fund that holds the same thing (a
            stand-in) and labels the value &ldquo;Estimated — stand-in
            fund&rdquo;.
          </>
        }
      >
        <p>
          Only values priced from your own funds are shown without a label.
          Anything estimated — a stand-in fund, a split of deposits taken from
          your paycheck setup — says so, and is never saved without your
          confirmation.
        </p>
      </Section>

      <Section
        id="matched-mix"
        title="Matched to your mix, and where the difference came from"
        example={
          <>
            If you held 60% US stocks, 30% international and 10% bonds, the
            matched line puts the same money into cheap index funds in those
            proportions. The gap between you and that line is what your specific
            funds and their costs did.
          </>
        }
      >
        <p>
          The difference from the S&amp;P 500 is then split into steps: the
          S&amp;P 500 → your mix of asset classes → your funds and their costs →
          when you added money. Both need your holdings history, so they appear
          once holding periods are known.
        </p>
      </Section>
    </div>
  );
}
