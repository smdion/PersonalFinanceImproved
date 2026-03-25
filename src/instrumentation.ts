/**
 * Next.js instrumentation — runs once on server startup.
 *
 * Node.js-specific code (process.on, process.exit) lives in
 * instrumentation.node.ts and is dynamically imported so that
 * Turbopack does not bundle it into the Edge Runtime chunk.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeHandlers } = await import("./instrumentation.node");
    registerNodeHandlers();
  }
}
