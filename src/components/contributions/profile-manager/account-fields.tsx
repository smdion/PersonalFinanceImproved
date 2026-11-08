/** The contribution-account fields the profile views show, in order: one
 *  table for every view's headers and the order of a row's cells. */
export type AccountFieldKey =
  "enabled" | "account" | "method" | "value" | "matchType" | "match" | "cap";
export type ReadOnlyFieldKey = "account" | "method" | "value" | "match";

type AccountField = {
  label: string;
  title?: string;
  align: "text-left" | "text-right";
  width: string;
  /** The read-only panel's column, for a ReadOnlyFieldKey field only. */
  readOnly?: { label: string; width: string; nowrap?: boolean };
} & ({ key: ReadOnlyFieldKey } | { key: AccountFieldKey; readOnly?: never });

export const ACCOUNT_FIELDS: readonly AccountField[] = [
  {
    key: "enabled",
    label: "On",
    title: "Enabled in this profile",
    align: "text-left",
    width: "w-6",
  },
  {
    key: "account",
    label: "Account",
    align: "text-left",
    width: "",
    readOnly: { label: "Account", width: "" },
  },
  {
    key: "method",
    label: "Method",
    align: "text-left",
    width: "w-28",
    readOnly: { label: "Method", width: "w-20", nowrap: true },
  },
  {
    key: "value",
    label: "Value",
    align: "text-right",
    width: "w-24",
    readOnly: { label: "Value", width: "w-24" },
  },
  { key: "matchType", label: "Match Type", align: "text-left", width: "w-28" },
  {
    key: "match",
    label: "Employer Match",
    align: "text-right",
    width: "w-24",
    readOnly: { label: "Match", width: "w-28" },
  },
  { key: "cap", label: "Match Cap", align: "text-right", width: "w-24" },
];

const joined = (...parts: string[]) => parts.filter(Boolean).join(" ");

/** A view's header cells: the create form, the inline editor, or the
 *  read-only panel (its own labels and widths, and only its fields). */
export function AccountFieldHeaders({
  view,
}: {
  view: "create" | "inline" | "readOnly";
}) {
  if (view === "readOnly")
    return ACCOUNT_FIELDS.map(({ key, align, readOnly }) =>
      readOnly ? (
        <th
          key={key}
          className={joined(
            "text-muted",
            readOnly.width,
            key === "account" ? "py-2 pr-3 pl-4" : "px-3 py-2",
            align,
            "font-medium",
            readOnly.nowrap ? "whitespace-nowrap" : "",
          )}
        >
          {readOnly.label}
        </th>
      ) : null,
    );
  return ACCOUNT_FIELDS.map(({ key, label, title, align, width }) => (
    <th
      key={key}
      className={
        view === "create"
          ? joined(width, "py-1.5", align, "font-medium")
          : joined(
              "text-muted",
              width,
              key === "enabled" ? "py-2 pl-4" : "px-3 py-2",
              align,
              "font-medium",
            )
      }
      title={title}
    >
      {label}
    </th>
  ));
}
