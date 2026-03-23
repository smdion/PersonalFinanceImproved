import { createTRPCRouter } from "../trpc";
import { settingsRouter } from "./settings";
import { paycheckRouter } from "./paycheck";
import { budgetRouter } from "./budget";
import { contributionRouter } from "./contribution";
import { mortgageRouter } from "./mortgage";
import { networthRouter } from "./networth";
import { savingsRouter } from "./savings";
import { brokerageRouter } from "./brokerage";
import { retirementRouter } from "./retirement";
import { projectionRouter } from "./projection";
import { performanceRouter } from "./performance";
import { historicalRouter } from "./historical";
import { assetsRouter } from "./assets";
import { apiDocsRouter } from "./api-docs";
import { versionRouter } from "./version";
import { contributionProfileRouter } from "./contribution-profiles";
import { syncRouter } from "./sync";
import { demoRouter } from "./demo";
import { dataBrowserRouter } from "./data-browser";
import { testingRouter } from "./testing";

export const appRouter = createTRPCRouter({
  settings: settingsRouter,
  paycheck: paycheckRouter,
  budget: budgetRouter,
  contribution: contributionRouter,
  mortgage: mortgageRouter,
  networth: networthRouter,
  savings: savingsRouter,
  brokerage: brokerageRouter,
  retirement: retirementRouter,
  projection: projectionRouter,
  performance: performanceRouter,
  historical: historicalRouter,
  assets: assetsRouter,
  apiDocs: apiDocsRouter,
  version: versionRouter,
  contributionProfile: contributionProfileRouter,
  sync: syncRouter,
  demo: demoRouter,
  dataBrowser: dataBrowserRouter,
  testing: testingRouter,
});

export type AppRouter = typeof appRouter;
