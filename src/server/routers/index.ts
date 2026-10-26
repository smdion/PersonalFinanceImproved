/** Root tRPC router that merges all domain sub-routers into the unified app API surface. */
import { createTRPCRouter } from "../trpc";
import { settingsRouter } from "./settings";
import { paycheckRouter } from "./paycheck";
import { budgetRouter } from "./budget";
import { contributionRouter } from "./contribution";
import { mortgageRouter } from "./mortgage";
import { networthRouter } from "./networth";
import { milestonesRouter } from "./milestones";
import { savingsRouter } from "./savings";
import { brokerageRouter } from "./brokerage";
import { retirementRouter } from "./retirement";
import { projectionRouter } from "./projection";
import { performanceRouter } from "./performance";
import { historicalRouter } from "./historical";
import { assetsRouter } from "./assets";
import { utilitiesRouter } from "./utilities";
import { debtsRouter } from "./debts";
import { apiDocsRouter } from "./api-docs";
import { versionRouter } from "./version";
import { contributionProfileRouter } from "./contribution-profiles";
import { salaryProfileRouter } from "./salary-profiles";
import { syncRouter } from "./sync";
import { simplefinRouter } from "./simplefin";
import { tiingoRouter } from "./tiingo";
import { investmentsRouter } from "./investments";
import { secRouter } from "./sec";
import { demoRouter } from "./demo";
import { dataBrowserRouter } from "./data-browser";
import { testingRouter } from "./testing";
import { taxBucketsRouter } from "./tax-buckets";

export const appRouter = createTRPCRouter({
  settings: settingsRouter,
  paycheck: paycheckRouter,
  budget: budgetRouter,
  contribution: contributionRouter,
  mortgage: mortgageRouter,
  networth: networthRouter,
  milestones: milestonesRouter,
  savings: savingsRouter,
  brokerage: brokerageRouter,
  retirement: retirementRouter,
  projection: projectionRouter,
  performance: performanceRouter,
  historical: historicalRouter,
  assets: assetsRouter,
  utilities: utilitiesRouter,
  debts: debtsRouter,
  apiDocs: apiDocsRouter,
  version: versionRouter,
  contributionProfile: contributionProfileRouter,
  salaryProfile: salaryProfileRouter,
  sync: syncRouter,
  simplefin: simplefinRouter,
  tiingo: tiingoRouter,
  investments: investmentsRouter,
  sec: secRouter,
  demo: demoRouter,
  dataBrowser: dataBrowserRouter,
  testing: testingRouter,
  taxBuckets: taxBucketsRouter,
});

export type AppRouter = typeof appRouter;
