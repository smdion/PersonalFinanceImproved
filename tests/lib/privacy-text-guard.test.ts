// @vitest-environment jsdom
/**
 * Privacy mode's text guard: any "$<digit>" left in the page's text is
 * masked (typed names, labels, server sentences), except where marked
 * data-privacy-visible; turning it off restores the text.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setPrivacyMode } from "@/lib/utils/format";
import { startPrivacyTextGuard } from "@/lib/privacy-text-guard";

const DOLLAR_AMOUNT = /\$\s?-?\d/;
let stop: () => void = () => undefined;

beforeEach(() => {
  setPrivacyMode(true);
  document.body.innerHTML = "";
});
afterEach(() => {
  stop();
  setPrivacyMode(false);
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startPrivacyTextGuard", () => {
  it("masks amounts in text already on the page; leaves the words", () => {
    document.body.innerHTML = "<p>Composite Deck ($20,000)</p>";
    stop = startPrivacyTextGuard();
    const text = document.body.textContent!;
    expect(text).toMatch(/^Composite Deck \(\$/);
    expect(text).not.toMatch(DOLLAR_AMOUNT);
  });

  it("masks text added or changed later", async () => {
    stop = startPrivacyTextGuard();
    const p = document.createElement("p");
    p.textContent = "Your first $100k";
    document.body.append(p);
    await tick();
    expect(p.textContent).not.toMatch(DOLLAR_AMOUNT);
    p.firstChild!.nodeValue = "About $15 more is due";
    await tick();
    expect(p.textContent).not.toMatch(DOLLAR_AMOUNT);
  });

  it("masks a number rendered as its own node after a $", () => {
    const p = document.createElement("p");
    p.append("$", "3.61", " per year");
    document.body.append(p);
    stop = startPrivacyTextGuard();
    expect(p.textContent).not.toMatch(DOLLAR_AMOUNT);
    expect(p.textContent).toMatch(/ per year$/);
  });

  it("leaves data-privacy-visible text alone", () => {
    document.body.innerHTML =
      "<span data-privacy-visible>per $1 by age 55</span>";
    stop = startPrivacyTextGuard();
    expect(document.body.textContent).toBe("per $1 by age 55");
  });

  it("masks hover tooltips (title), on the page, added and changed", async () => {
    document.body.innerHTML = '<span title="Deck ($20,000)">Deck</span>';
    stop = startPrivacyTextGuard();
    const span = document.querySelector("span")!;
    expect(span.title).toMatch(/^Deck \(\$/);
    expect(span.title).not.toMatch(DOLLAR_AMOUNT);

    const added = document.createElement("div");
    added.innerHTML = '<b title="About $15 more is due">i</b>';
    document.body.append(added);
    span.title = "Now $30,000";
    await tick();
    expect(added.querySelector("b")!.title).not.toMatch(DOLLAR_AMOUNT);
    expect(span.title).toMatch(/^Now \$/);
    expect(span.title).not.toMatch(DOLLAR_AMOUNT);
  });

  it("leaves data-privacy-visible tooltips and plain ones alone", () => {
    document.body.innerHTML =
      '<span data-privacy-visible title="per $1">a</span><i title="Open">b</i>';
    stop = startPrivacyTextGuard();
    expect(document.querySelector("span")!.title).toBe("per $1");
    expect(document.querySelector("i")!.title).toBe("Open");
  });

  it("turning it off restores what it masked", () => {
    document.body.innerHTML = '<p title="Cost $9,000">Deck ($20,000)</p>';
    stop = startPrivacyTextGuard();
    stop();
    stop = () => undefined;
    expect(document.body.textContent).toBe("Deck ($20,000)");
    expect(document.querySelector("p")!.title).toBe("Cost $9,000");
  });
});
