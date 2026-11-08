export type OverrideType =
  | "contribution_rate"
  | "lump_sum"
  | "salary_change"
  | "budget_change"
  | "roth_conversion"
  | "routing"
  | "reset";

export const OVERRIDE_OPTIONS: {
  key: OverrideType;
  label: string;
  description: string;
  icon: string;
  phase: "any" | "pre" | "post";
}[] = [
  {
    key: "contribution_rate",
    label: "Retirement Contribution Rate",
    description:
      "Change how much you save for retirement (Portfolio savings come on top)",
    icon: "📈",
    phase: "pre",
  },
  {
    key: "lump_sum",
    label: "Lump Sum",
    description: "One-time injection or withdrawal",
    icon: "💰",
    phase: "any",
  },
  {
    key: "salary_change",
    label: "Contribution / Salary",
    description: "Switch contribution profile or change salary",
    icon: "💼",
    phase: "pre",
  },
  {
    key: "budget_change",
    label: "Budget Change",
    description: "Change retirement spending",
    icon: "🏠",
    phase: "post",
  },
  {
    key: "roth_conversion",
    label: "Roth Conversion",
    description: "Set conversion target bracket",
    icon: "🔄",
    phase: "post",
  },
  {
    key: "routing",
    label: "Account Routing",
    description: "Change withdrawal order or splits",
    icon: "🔀",
    phase: "any",
  },
  {
    key: "reset",
    label: "Reset to Defaults",
    description: "Remove every change for a year",
    icon: "↩️",
    phase: "any",
  },
];
