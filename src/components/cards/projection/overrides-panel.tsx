"use client";

/** `SectionHeader` — shared small heading used by decumulation-config.tsx.
 *  The unified overrides panel this file used to contain (`OverridesPanel`)
 *  is dead: `index.tsx` renders `OverridesPanelV2` instead, and the three
 *  section components it delegated to (SavingOverridesSection,
 *  WithdrawalOverridesSection, LifeChangesSection) had zero other
 *  importers — removed alongside it. */
import { HelpTip } from "@/components/ui/help-tip";

export function SectionHeader({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-muted uppercase tracking-wide">
        {title}
        {help && <HelpTip text={help} />}
      </h4>
      {children}
    </div>
  );
}
