import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCloneProfile } from "@/lib/hooks/use-clone-profile";
import { promptText } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/hooks/use-toast";

vi.mock("@/components/ui/confirm-dialog", () => ({
  promptText: vi.fn(),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function makeFakeMutation(opts: { isPending?: boolean } = {}) {
  const mutateAsync = vi.fn().mockResolvedValue(undefined);
  return { mutation: { mutateAsync, isPending: opts.isPending ?? false } };
}

describe("useCloneProfile", () => {
  it("prompts pre-filled with '<name> (copy)' and calls the mutation with the entered name", async () => {
    vi.mocked(promptText).mockResolvedValue("My Profile Clone");
    const { mutation } = makeFakeMutation();
    const { result } = renderHook(() => useCloneProfile(mutation));

    await act(() => result.current.clone(42, "My Profile"));

    expect(promptText).toHaveBeenCalledWith(
      "New profile name",
      undefined,
      "My Profile (copy)",
    );
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      sourceProfileId: 42,
      name: "My Profile Clone",
    });
    expect(toast.success).toHaveBeenCalledWith('Cloned "My Profile Clone"');
  });

  it("does nothing when the prompt is cancelled (returns null)", async () => {
    vi.mocked(promptText).mockResolvedValue(null);
    const { mutation } = makeFakeMutation();
    const { result } = renderHook(() => useCloneProfile(mutation));

    await act(() => result.current.clone(42, "My Profile"));

    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("errors without calling the mutation when the trimmed name is empty", async () => {
    vi.mocked(promptText).mockResolvedValue("   ");
    const { mutation } = makeFakeMutation();
    const { result } = renderHook(() => useCloneProfile(mutation));

    await act(() => result.current.clone(42, "My Profile"));

    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Profile name can't be empty");
  });

  it("toasts the error message when the mutation rejects", async () => {
    vi.mocked(promptText).mockResolvedValue("Clone");
    const { mutation } = makeFakeMutation();
    mutation.mutateAsync.mockRejectedValueOnce(new Error("name already taken"));
    const { result } = renderHook(() => useCloneProfile(mutation));

    await act(() => result.current.clone(42, "My Profile"));

    expect(toast.error).toHaveBeenCalledWith("name already taken");
  });

  it("passes through the mutation's isPending", () => {
    const { mutation } = makeFakeMutation({ isPending: true });
    const { result } = renderHook(() => useCloneProfile(mutation));
    expect(result.current.isPending).toBe(true);
  });
});
