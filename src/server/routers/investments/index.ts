/** Investments router: SimpleFIN holdings, investment transactions with their kinds, and the household's classification rules. */

import { mergeRouters } from "../../trpc";
import { investmentHoldingsRouter } from "./holdings";
import { investmentTransactionsRouter } from "./transactions";
import { investmentRulesRouter } from "./rules";
import { investmentHealthRouter } from "./health";
import { investmentSnapshotFlowsRouter } from "./snapshot-flows";
import { investmentComparisonRouter } from "./comparison";
import { investmentFundFactsRouter } from "./fund-facts";
import { investmentSuggestionsRouter } from "./suggestions";
import { investmentAccountInsightsRouter } from "./account-insights";

export const investmentsRouter = mergeRouters(
  investmentHoldingsRouter,
  investmentTransactionsRouter,
  investmentRulesRouter,
  investmentHealthRouter,
  investmentSnapshotFlowsRouter,
  investmentComparisonRouter,
  investmentFundFactsRouter,
  investmentSuggestionsRouter,
  investmentAccountInsightsRouter,
);
