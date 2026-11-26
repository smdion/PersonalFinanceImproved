/** The decumulation year's RMD owed by each owner, then each owner's QCD. */
import type { resolveDecumulationConfig } from "../override-resolution";
import { rmdIncomeByOwner } from "./decumulation-income";
import { qcdStep } from "./rmd-step";
import { settle } from "./settle";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Each owner's RMD owed this year, then the QCDs debited from their IRAs. */
export function yearRmdAndQcd(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  year: number,
  config: ReturnType<typeof resolveDecumulationConfig>,
) {
  const owed = rmdIncomeByOwner(ctx, state, year);
  const qcd = qcdStep(ctx, state, year, config);
  settle(ctx, state, "decumulation.qcd");
  return { owed, qcd };
}
