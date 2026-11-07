/**
 * The Versions restore and import confirmations: the typed confirmation
 * sends the same handler once; Escape and Cancel close them only while no
 * restore or import runs, and a backdrop click never does.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RestoreDialog } from "@/components/versions/restore-dialog";
import { ImportDialog } from "@/components/versions/import-dialog";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ permissions: ["admin"] }),
  isAdmin: () => true,
}));

afterEach(() => {
  cleanup();
});

function renderRestore(pending: { restore?: boolean; create?: boolean }) {
  const props = {
    setRestoreTarget: vi.fn(),
    setRestoreConfirmText: vi.fn(),
    handleRestore: vi.fn(async () => {}),
  };
  const view = render(
    <RestoreDialog
      restoreTarget={{ id: 7, name: "Before the move" }}
      restoreDataLoss={[]}
      restoreCreateBackup
      setRestoreCreateBackup={vi.fn()}
      restoreConfirmText="Before the move"
      restoreMutation={
        {
          isPending: pending.restore ?? false,
          isError: false,
          error: null,
        } as never
      }
      createMutation={{ isPending: pending.create ?? false }}
      {...props}
    />,
  );
  return { ...props, view };
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
  it("restores once from the typed confirmation", () => {
    const { handleRestore } = renderRestore({});
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(handleRestore).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and Cancel when idle, never on the backdrop", () => {
    const { setRestoreTarget, view } = renderRestore({});
    fireEvent.click(screen.getByRole("presentation"));
    expect(setRestoreTarget).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(setRestoreTarget).toHaveBeenCalledWith(null);
    view.unmount();
    const again = renderRestore({});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(again.setRestoreTarget).toHaveBeenCalledWith(null);
  });

  it.each([
    ["the restore", { restore: true }],
    ["the pre-restore backup", { create: true }],
  ])("can't be closed while %s runs", (_, pending) => {
    const { setRestoreTarget, setRestoreConfirmText } = renderRestore(pending);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(setRestoreTarget).not.toHaveBeenCalled();
    expect(setRestoreConfirmText).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Restore Version" }),
    ).toBeTruthy();
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
