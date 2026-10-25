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

  it("turning it off restores what it masked", () => {
    document.body.innerHTML = "<p>Deck ($20,000)</p>";
    stop = startPrivacyTextGuard();
    stop();
    stop = () => undefined;
    expect(document.body.textContent).toBe("Deck ($20,000)");
  });
});
