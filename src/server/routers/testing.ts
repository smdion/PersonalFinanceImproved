import { z } from "zod/v4";
import { execSync } from "child_process";
import { createTRPCRouter, adminProcedure } from "../trpc";

type TestResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  duration: number;
  error?: string;
};

type TestFileResult = {
  file: string;
  tests: TestResult[];
};

type RunTestsOutput = {
  success: boolean;
  numTests: number;
  numPassed: number;
  numFailed: number;
  numSkipped: number;
  duration: number;
  testFiles: TestFileResult[];
};

export const testingRouter = createTRPCRouter({
  runTests: adminProcedure
    .input(
      z.object({
        fileFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<RunTestsOutput> => {
      const args = ["npx", "vitest", "run", "--reporter=json"];
      if (input.fileFilter) {
        args.push(input.fileFilter);
      }

      try {
        const stdout = execSync(args.join(" "), {
          cwd: process.cwd(),
          timeout: 60_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });

        return parseVitestJson(stdout);
      } catch (err: unknown) {
        // vitest exits with code 1 when tests fail — still has valid JSON output
        if (
          err &&
          typeof err === "object" &&
          "stdout" in err &&
          typeof (err as { stdout: unknown }).stdout === "string"
        ) {
          try {
            return parseVitestJson((err as { stdout: string }).stdout);
          } catch {
            // JSON parse also failed — fall through to error
          }
        }

        const message =
          err instanceof Error ? err.message : String(err);
        return {
          success: false,
          numTests: 0,
          numPassed: 0,
          numFailed: 0,
          numSkipped: 0,
          duration: 0,
          testFiles: [
            {
              file: input.fileFilter ?? "(all)",
              tests: [
                {
                  name: "Runner error",
                  status: "fail",
                  duration: 0,
                  error: message.slice(0, 2000),
                },
              ],
            },
          ],
        };
      }
    }),
});

function parseVitestJson(stdout: string): RunTestsOutput {
  // vitest JSON reporter may output non-JSON lines before the JSON — find the JSON object
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("No JSON output from vitest");
  }
  const json = JSON.parse(stdout.slice(jsonStart));

  const testFiles: TestFileResult[] = [];
  let numPassed = 0;
  let numFailed = 0;
  let numSkipped = 0;

  for (const file of json.testResults ?? []) {
    const tests: TestResult[] = [];
    for (const t of file.assertionResults ?? []) {
      const status =
        t.status === "passed"
          ? "pass"
          : t.status === "failed"
            ? "fail"
            : "skip";
      if (status === "pass") numPassed++;
      else if (status === "fail") numFailed++;
      else numSkipped++;

      tests.push({
        name: t.fullName ?? t.title ?? "unknown",
        status,
        duration: t.duration ?? 0,
        ...(t.failureMessages?.length
          ? { error: t.failureMessages.join("\n").slice(0, 2000) }
          : {}),
      });
    }
    testFiles.push({
      file: (file.name ?? "").replace(process.cwd() + "/", ""),
      tests,
    });
  }

  const numTests = numPassed + numFailed + numSkipped;
  const duration = json.startTime
    ? Date.now() - json.startTime
    : testFiles.reduce(
        (s, f) => s + f.tests.reduce((ss, t) => ss + t.duration, 0),
        0,
      );

  return {
    success: numFailed === 0,
    numTests,
    numPassed,
    numFailed,
    numSkipped,
    duration,
    testFiles,
  };
}
