/**
 * Next.js instrumentation, run once on server startup. Node-only code lives in
 * instrumentation.node.ts, imported dynamically to keep it out of the Edge bundle.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeHandlers } = await import("./instrumentation.node");
    registerNodeHandlers();
  }
}
