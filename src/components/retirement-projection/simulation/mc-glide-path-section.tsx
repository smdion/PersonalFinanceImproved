import type { SimulationInputs } from "./mc-simulation-types";
import type { Dispatch, SetStateAction } from "react";
import { GlidePathTable } from "./mc-glide-path";

export type GlidePathSectionProps = {
  draftGlidePath: { age: number; allocations: Record<number, string> }[];
  editingGlidePath: boolean;
  inputs: SimulationInputs;
  onGlidePathChange:
    | ((
        entries: { age: number; allocations: Record<number, number> }[],
      ) => void)
    | undefined;
  setDraftGlidePath: Dispatch<
    SetStateAction<{ age: number; allocations: Record<number, string> }[]>
  >;
  setEditingGlidePath: Dispatch<SetStateAction<boolean>>;
};

export function GlidePathSection({
  draftGlidePath,
  editingGlidePath,
  inputs,
  onGlidePathChange,
  setDraftGlidePath,
  setEditingGlidePath,
}: GlidePathSectionProps) {
  return (
    <>
      {inputs.glidePath.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-label text-muted font-medium">
              Glide Path (allocation shifts with age)
            </div>
            {onGlidePathChange && !editingGlidePath && (
              <button
                type="button"
                onClick={() => {
                  setDraftGlidePath(
                    inputs.glidePath.map((gp) => ({
                      age: gp.age,
                      allocations: Object.fromEntries(
                        inputs.assetClasses.map((ac) => [
                          ac.id,
                          ((gp.allocations[ac.id] ?? 0) * 100).toFixed(0),
                        ]),
                      ),
                    })),
                  );
                  setEditingGlidePath(true);
                }}
                className="text-caption text-blue-600 underline hover:text-blue-800"
              >
                Edit
              </button>
            )}
            {editingGlidePath && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingGlidePath(false)}
                  className="text-caption text-muted hover:text-secondary underline"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onGlidePathChange) {
                      onGlidePathChange(
                        draftGlidePath.map((gp) => ({
                          age: gp.age,
                          allocations: Object.fromEntries(
                            Object.entries(gp.allocations).map(([k, v]) => [
                              k,
                              (parseFloat(v) || 0) / 100,
                            ]),
                          ),
                        })),
                      );
                    }
                    setEditingGlidePath(false);
                  }}
                  className="text-caption font-medium text-blue-600 underline hover:text-blue-800"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          <GlidePathTable
            draftGlidePath={draftGlidePath}
            editingGlidePath={editingGlidePath}
            inputs={inputs}
            setDraftGlidePath={setDraftGlidePath}
          />
        </div>
      )}
    </>
  );
}
