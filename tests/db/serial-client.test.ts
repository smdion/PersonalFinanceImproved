/** One client, one query at a time: a client that throws on overlapping
 *  queries (as pg@9 does) serves Promise.all reads through drizzle. */
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema-pg";
import { serializeQueries } from "@/lib/db/serial-client";

/** Throws when a query arrives while another is running. */
class StrictClient {
  running = false;
  readonly sent: string[] = [];
  readonly done: string[] = [];
  async query(config: string | { text: string }): Promise<{
    rows: unknown[];
    rowCount: number;
    fields: never[];
  }> {
    const text = typeof config === "string" ? config : config.text;
    if (this.running) throw new Error(`overlapping query: ${text}`);
    this.running = true;
    this.sent.push(text);
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.running = false;
    this.done.push(text);
    if (text === "fail") throw new Error("query failed");
    return { rows: [], rowCount: 0, fields: [] };
  }
  release() {
    return "released";
  }
}

describe("serializeQueries", () => {
  it("the strict client rejects Promise.all on its own", async () => {
    const client = new StrictClient();
    await expect(
      Promise.all([client.query("a"), client.query("b")]),
    ).rejects.toThrow("overlapping query: b");
  });

  it("runs concurrent queries one after another, in call order", async () => {
    const client = new StrictClient();
    const serial = serializeQueries(client).client;
    await Promise.all(["a", "b", "c"].map((q) => serial.query(q)));
    expect(client.sent).toEqual(["a", "b", "c"]);
  });

  it("a failed query rejects its caller and the next query still runs", async () => {
    const serial = serializeQueries(new StrictClient()).client;
    const [failed, next] = await Promise.allSettled([
      serial.query("fail"),
      serial.query("after"),
    ]);
    expect(failed.status).toBe("rejected");
    expect(next.status).toBe("fulfilled");
  });

  it("close waits for queries queued behind a rejected one, then refuses new ones", async () => {
    // A Promise.all rejects on its first failure while siblings still wait
    // in the queue; the caller's finally resets search_path and releases
    // the client only after close(), so no sibling reaches a released client.
    const client = new StrictClient();
    const serial = serializeQueries(client);
    const failing = serial.client.query("fail");
    const slowSibling = serial.client.query("sibling");
    await expect(Promise.all([failing, slowSibling])).rejects.toThrow(
      "query failed",
    );
    expect(client.done).toEqual(["fail"]);
    await serial.close();
    client.done.push("reset");
    expect(client.done).toEqual(["fail", "sibling", "reset"]);
    await expect(slowSibling).resolves.toMatchObject({ rows: [] });
    await expect(serial.client.query("late")).rejects.toThrow(
      "Query sent after its client closed",
    );
    expect(client.sent).not.toContain("late");
  });

  it("passes every other member through to the client", () => {
    const client = new StrictClient();
    expect(serializeQueries(client).client.release()).toBe("released");
  });

  it("serves drizzle Promise.all reads on one client", async () => {
    const client = new StrictClient();
    const db = drizzle(serializeQueries(client).client as never, { schema });
    await Promise.all([
      db.select().from(schema.people),
      db.select().from(schema.jobs),
      db.select().from(schema.appSettings),
    ]);
    expect(client.sent).toHaveLength(3);
  });
});
