/**
 * The Versions restore and import confirmations: the typed confirmation
 * runs once (a restore: its backup, then the restore); Escape and Cancel
 * close them only while nothing runs, and a backdrop click never does.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { RestoreDialog } from "@/components/versions/restore-dialog";
import { ImportDialog } from "@/components/versions/import-dialog";
import { expectLabelReachesControl } from "./label-click";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ permissions: ["admin"] }),
  isAdmin: () => true,
}));

afterEach(() => {
  cleanup();
});

/** A mutation whose calls wait until the test settles them. */
function deferredMutation(state: { isError?: boolean; message?: string } = {}) {
  const settle: (() => void)[] = [];
  const mutateAsync = vi.fn(
    () => new Promise<void>((resolve) => settle.push(resolve)),
  );
  const mutation = {
    mutateAsync,
    isPending: false,
    isError: state.isError ?? false,
    error: state.message ? { message: state.message } : null,
  };
  return { mutation, mutateAsync, settle };
}

function renderRestore({
  backup = true,
  refused,
}: { backup?: boolean; refused?: string } = {}) {
  const create = deferredMutation();
  const restore = deferredMutation({
    isError: refused !== undefined,
    message: refused,
  });
  const props = {
    setRestoreTarget: vi.fn(),
    setRestoreConfirmText: vi.fn(),
  };
  const view = render(
    <RestoreDialog
      restoreTarget={{ id: 7, name: "Before the move" }}
      restoreDataLoss={[]}
      restoreCreateBackup={backup}
      setRestoreCreateBackup={vi.fn()}
      restoreConfirmText="Before the move"
      restoreMutation={restore.mutation as never}
      createMutation={create.mutation as never}
      {...props}
    />,
  );
  return { ...props, view, create, restore };
}

/** Escape, a backdrop click and Cancel all leave the dialog open. */
function expectHeld(props: ReturnType<typeof renderRestore>) {
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("presentation"));
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(cancel).toBeDisabled();
  fireEvent.click(cancel);
  expect(props.setRestoreTarget).not.toHaveBeenCalled();
  expect(props.setRestoreConfirmText).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Restore Version" })).toBeTruthy();
}

function renderImport(importLoading: boolean) {
  const props = {
    setShowImportConfirm: vi.fn(),
    setImportFile: vi.fn(),
    setImportError: vi.fn(),
    handleImport: vi.fn(async () => {}),
  };
  render(
    <ImportDialog
      showImportConfirm
      importFile={new File(["{}"], "backup.json")}
      importDataLoss={[]}
      importConfirmText="IMPORT"
      setImportConfirmText={vi.fn()}
      importError={null}
      importLoading={importLoading}
      {...props}
    />,
  );
  return props;
}

describe("RestoreDialog", () => {
  it("backs up, then restores, once from the typed confirmation", async () => {
    const { create, restore } = renderRestore();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(restore.mutateAsync).not.toHaveBeenCalled();
    await act(async () => create.settle[0]!());
    expect(restore.mutateAsync).toHaveBeenCalledTimes(1);
    expect(restore.mutateAsync).toHaveBeenCalledWith({ id: 7 });
  });

  it("closes on Escape and Cancel when idle, never on the backdrop", () => {
    const { setRestoreTarget, view } = renderRestore();
    fireEvent.click(screen.getByRole("presentation"));
    expect(setRestoreTarget).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(setRestoreTarget).toHaveBeenCalledWith(null);
    view.unmount();
    const again = renderRestore();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(again.setRestoreTarget).toHaveBeenCalledWith(null);
  });

  it("can't be closed from the backup's start to the restore's end", async () => {
    const run = renderRestore();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByRole("button", { name: "Restoring..." })).toBeDisabled();
    expectHeld(run);
    // Between the backup settling and the restore starting: still held.
    await act(async () => run.create.settle[0]!());
    expectHeld(run);
    await act(async () => run.restore.settle[0]!());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("can't be closed while a restore without a backup runs", () => {
    const run = renderRestore({ backup: false });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(run.create.mutateAsync).not.toHaveBeenCalled();
    expect(run.restore.mutateAsync).toHaveBeenCalledWith({ id: 7 });
    expectHeld(run);
  });

  it("after a refused restore: shows why, keeps the typed name, and closes", () => {
    const run = renderRestore({
      refused:
        "retirement_settings.withdrawal_strategy has no default; restore another version, or update Ledgr",
    });
    expect(screen.getByText(/restore another version/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(screen.getByDisplayValue("Before the move")).toBeTruthy();
    expect(run.setRestoreConfirmText).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(run.setRestoreTarget).toHaveBeenCalledWith(null);
    run.view.unmount();
    const again = renderRestore({ refused: "refused" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(again.setRestoreTarget).toHaveBeenCalledWith(null);
  });
});

describe("ImportDialog", () => {
  it("imports once from the typed confirmation", () => {
    const { handleImport } = renderImport(false);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(handleImport).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape when idle, never on the backdrop", () => {
    const { setShowImportConfirm, setImportFile } = renderImport(false);
    fireEvent.click(screen.getByRole("presentation"));
    expect(setShowImportConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(setShowImportConfirm).toHaveBeenCalledWith(false);
    expect(setImportFile).toHaveBeenCalledWith(null);
  });

  it("can't be closed while the import runs", () => {
    const { setShowImportConfirm } = renderImport(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(setShowImportConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Import Backup" })).toBeTruthy();
  });
});

describe("typed confirmation labels", () => {
  it("clicking the restore label reaches the name field", () => {
    renderRestore();
    expectLabelReachesControl("Type the version name to confirm:");
  });

  it("clicking the import label reaches the IMPORT field", () => {
    renderImport(false);
    expectLabelReachesControl("Type IMPORT to confirm:");
  });
});
