"use client";

/**
 * The Changes by year panel with its notes: what the saved sets leave out
 * (account types this version doesn't know) and what the last save's deleted
 * rows took with them.
 */
import { useEffect, type ComponentProps } from "react";
import { trpc } from "@/lib/trpc";
import { EngineWarnings } from "../engine-warnings";
import { OverridesPanel } from "./overrides-panel";

export function ChangesByYearPanel(
  props: ComponentProps<typeof OverridesPanel>,
) {
  const utils = trpc.useUtils();
  const listNotes = trpc.retirement.projectionOverrides.listUnknownTypeNotes;
  const accumulation = listNotes.useQuery({ overrideType: "accumulation" });
  const decumulation = listNotes.useQuery({ overrideType: "decumulation" });
  const { saveProjectionOverrides: save, clearProjectionOverrides: clear } =
    props.state;
  // A save can delete a row that held such entries: read the notes again.
  useEffect(() => {
    if (save.data || clear.data)
      void utils.retirement.projectionOverrides.listUnknownTypeNotes.invalidate();
  }, [save.data, clear.data, utils]);
  const notes = [
    ...new Set([
      ...(accumulation.data ?? []),
      ...(decumulation.data ?? []),
      ...(save.data?.unknownTypeNotes ?? []),
      ...(clear.data?.unknownTypeNotes ?? []),
    ]),
  ];
  return (
    <div className="space-y-2">
      <EngineWarnings warnings={notes} />
      <OverridesPanel {...props} />
    </div>
  );
}
