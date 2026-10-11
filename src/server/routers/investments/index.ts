/** Investments router: SimpleFIN holdings, investment transactions with their kinds, and the household's classification rules. */

import { mergeRouters } from "../../trpc";
import { investmentHoldingsRouter } from "./holdings";
import { investmentTransactionsRouter } from "./transactions";
import { investmentRulesRouter } from "./rules";
import { investmentHealthRouter } from "./health";
import { investmentSnapshotFlowsRouter } from "./snapshot-flows";

export const investmentsRouter = mergeRouters(
  investmentHoldingsRouter,
  investmentTransactionsRouter,
  investmentRulesRouter,
  investmentHealthRouter,
  investmentSnapshotFlowsRouter,
);
