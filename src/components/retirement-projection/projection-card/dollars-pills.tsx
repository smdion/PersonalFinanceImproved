/** The toolbar's Dollars toggle, Today's $ or Future $, and its help. */
import { HelpTip } from "@/components/ui/help-tip";
import type { DollarBasis } from "@/lib/config/enum-values";
import { PillBtn, LabeledPillGroup } from "../pill-btn";

export function DollarsPills({
  dollarMode,
  setDollarMode,
}: {
  dollarMode: DollarBasis;
  setDollarMode: (mode: DollarBasis) => void;
}) {
  return (
    <LabeledPillGroup
      label="Dollars"
      helpTip={
        <HelpTip
          maxWidth={400}
          lines={[
            <div key="today" className="space-y-1">
              <div>
                <strong className="text-blue-300">Today&apos;s $</strong>{" "}
                <span className="text-faint">(default)</span>
              </div>
              <div className="text-faint text-xs">
                Removes inflation — every dollar means the same as it does right
                now. A $100k balance in 2050 shows what that money actually buys
                today.
              </div>
              <div className="text-faint mt-0.5 text-xs">Use when:</div>
              <ul
                className="text-faint ml-3 space-y-0.5 text-xs"
                style={{ listStyleType: "'▸ '" }}
              >
                <li>
                  <span className="text-blue-300/80">
                    Will I have enough to retire?
                  </span>
                </li>
                <li>
                  Comparing your nest egg to your <em>current</em> salary
                </li>
                <li>Checking if withdrawals cover today&apos;s expenses</li>
                <li>Evaluating whether savings rate keeps up</li>
                <li>Comparing scenarios across decades</li>
              </ul>
              <div className="text-caption text-muted mt-0.5 italic">
                Salary and withdrawals may appear flat or declining —
                that&apos;s not a bug, it means purchasing power isn&apos;t
                outpacing inflation.
              </div>
            </div>,
            <div key="future" className="space-y-1 border-t pt-1.5">
              <div>
                <strong className="text-green-300">Future $</strong>
              </div>
              <div className="text-faint text-xs">
                The actual amounts as they&apos;ll appear on statements, tax
                forms, and paychecks. They grow because your raise and return
                rates already include inflation — it&apos;s counted once, not
                stacked on top.
              </div>
              <div className="text-faint mt-0.5 text-xs">Use when:</div>
              <ul
                className="text-faint ml-3 space-y-0.5 text-xs"
                style={{ listStyleType: "'▸ '" }}
              >
                <li>
                  Checking if you&apos;ll hit{" "}
                  <span className="text-green-300/80">
                    401k/IRA contribution limits
                  </span>
                </li>
                <li>
                  Planning{" "}
                  <span className="text-green-300/80">Roth conversions</span>{" "}
                  against tax brackets
                </li>
                <li>
                  Estimating{" "}
                  <span className="text-green-300/80">RMD amounts</span>
                </li>
                <li>Seeing what your account balance will actually read</li>
                <li>
                  Modeling{" "}
                  <span className="text-green-300/80">IRMAA thresholds</span>
                </li>
                <li>Filing-year tax projections</li>
              </ul>
            </div>,
            <div
              key="tip"
              className="text-faint border-t pt-1.5 text-xs italic"
            >
              Same projection, different lens.{" "}
              <span className="text-blue-300">Today&apos;s $</span> answers{" "}
              <strong className="text-faint">
                &quot;is this enough?&quot;
              </strong>{" "}
              — <span className="text-green-300">Future $</span> answers{" "}
              <strong className="text-faint">
                &quot;what will the statement say?&quot;
              </strong>
              <div className="mt-1">
                The gap between the two is your{" "}
                <strong className="text-faint">real raise</strong>: the part of
                your growth that actually outpaces inflation. If they line up,
                your raises are only keeping you even with prices.
              </div>
            </div>,
          ]}
        />
      }
    >
      <PillBtn
        active={dollarMode === "real"}
        onClick={() => setDollarMode("real")}
        label="Today's $"
      />
      <PillBtn
        active={dollarMode === "nominal"}
        onClick={() => setDollarMode("nominal")}
        label="Future $"
      />
    </LabeledPillGroup>
  );
}
