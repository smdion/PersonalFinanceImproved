/** Investments router: what SimpleFIN investment data adds — fills for snapshots / Performance / Basis, account insights, holdings and fund facts, benchmarks, and the live-balance split, and Always Be Buying months. */

import { mergeRouters } from "../../trpc";
import { investmentHealthRouter } from "./health";
import { investmentSnapshotFlowsRouter } from "./snapshot-flows";
import { investmentComparisonRouter } from "./comparison";
import { investmentFundFactsRouter } from "./fund-facts";
import { investmentSuggestionsRouter } from "./suggestions";
import { investmentAccountInsightsRouter } from "./account-insights";
import { investmentTaxInputsRouter } from "./tax-inputs";
import { investmentHoldingPeriodsRouter } from "./holding-periods";
import { investmentBuyingRouter } from "./buying";
import { investmentCurrentBalancesRouter } from "./current-balances";

export const investmentsRouter = mergeRouters(
  investmentHealthRouter,
  investmentSnapshotFlowsRouter,
  investmentComparisonRouter,
  investmentFundFactsRouter,
  investmentSuggestionsRouter,
  investmentAccountInsightsRouter,
  investmentTaxInputsRouter,
  investmentHoldingPeriodsRouter,
  investmentBuyingRouter,
  investmentCurrentBalancesRouter,
);
