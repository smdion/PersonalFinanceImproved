import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";

describe("useDraftCommit", () => {
  it("starts with no drafts", () => {
    const { result } = renderHook(() => useDraftCommit());
    expect(result.current.drafts).toEqual({});
  });

  it("setDraft stores text under its key without disturbing other keys", () => {
    const { result } = renderHook(() => useDraftCommit());

    act(() => result.current.setDraft("name", "Alice"));
    expect(result.current.drafts).toEqual({ name: "Alice" });

    act(() => result.current.setDraft("email", "a@example.com"));
    expect(result.current.drafts).toEqual({
      name: "Alice",
      email: "a@example.com",
    });
  });

  it("clearDraft removes only that key", () => {
    const { result } = renderHook(() => useDraftCommit());

    act(() => {
      result.current.setDraft("name", "Alice");
      result.current.setDraft("email", "a@example.com");
    });
    act(() => result.current.clearDraft("name"));

    expect(result.current.drafts).toEqual({ email: "a@example.com" });
  });

  it("clearDraft on a key with no draft is a no-op", () => {
    const { result } = renderHook(() => useDraftCommit());
    act(() => result.current.clearDraft("nonexistent"));
    expect(result.current.drafts).toEqual({});
  });

  it("keys support arbitrary composite strings (row+field patterns)", () => {
    const { result } = renderHook(() => useDraftCommit());

    act(() => {
      result.current.setDraft("42:salary", "100000");
      result.current.setDraft("43:salary", "90000");
    });

    expect(result.current.drafts).toEqual({
      "42:salary": "100000",
      "43:salary": "90000",
    });

    act(() => result.current.clearDraft("42:salary"));
    expect(result.current.drafts).toEqual({ "43:salary": "90000" });
  });
});
