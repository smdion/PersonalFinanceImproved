/**
 * Tests for DataTable — the shared sortable/CRUD table primitive. Priority
 * per the review backlog: sort toggling and the delete path (which routes
 * through the imperative confirm() dialog from confirm-dialog.tsx).
 *
 * We mock @/components/ui/confirm-dialog the same way other component tests
 * in this repo do (see fund-card.test.tsx, budget-mode-manager.test.tsx) so
 * the delete path is deterministic without needing a real <ConfirmDialog />
 * mounted.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockConfirm = vi.fn<(msg: string) => Promise<boolean>>();
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: (msg: string) => mockConfirm(msg),
}));

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

type Row = { id: number; name: string; amount: number };

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "amount", label: "Amount", sortable: true },
];

const rows: Row[] = [
  { id: 1, name: "Charlie", amount: 30 },
  { id: 2, name: "Alice", amount: 10 },
  { id: 3, name: "Bob", amount: 20 },
];

function getBodyRows() {
  return screen.getAllByRole("row").slice(1); // drop header row
}

describe("DataTable", () => {
  it("renders without crashing with typical data", () => {
    render(<DataTable columns={columns} data={rows} title="People" />);
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows a loading skeleton when isLoading", () => {
    const { container } = render(
      <DataTable columns={columns} data={undefined} isLoading title="People" />,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBe(3);
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it("shows the empty message when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        title="People"
        emptyMessage="No people yet."
      />,
    );
    expect(screen.getByText("No people yet.")).toBeInTheDocument();
  });

  it("falls back to a default empty message derived from the title", () => {
    render(<DataTable columns={columns} data={[]} title="People" />);
    expect(screen.getByText("No people found.")).toBeInTheDocument();
  });

  it("renders rows in their original (unsorted) order by default", () => {
    render(<DataTable columns={columns} data={rows} />);
    const bodyRows = getBodyRows();
    expect(bodyRows[0]).toHaveTextContent("Charlie");
    expect(bodyRows[1]).toHaveTextContent("Alice");
    expect(bodyRows[2]).toHaveTextContent("Bob");
  });

  it("sorts ascending on first click of a sortable column header", () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.click(screen.getByText("Name"));
    const bodyRows = getBodyRows();
    expect(bodyRows[0]).toHaveTextContent("Alice");
    expect(bodyRows[1]).toHaveTextContent("Bob");
    expect(bodyRows[2]).toHaveTextContent("Charlie");
  });

  it("toggles to descending on a second click of the same column header", () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.click(screen.getByText("Name"));
    fireEvent.click(screen.getByText("Name"));
    const bodyRows = getBodyRows();
    expect(bodyRows[0]).toHaveTextContent("Charlie");
    expect(bodyRows[1]).toHaveTextContent("Bob");
    expect(bodyRows[2]).toHaveTextContent("Alice");
  });

  it("resets to ascending when switching to a different sortable column", () => {
    render(<DataTable columns={columns} data={rows} />);
    fireEvent.click(screen.getByText("Name"));
    fireEvent.click(screen.getByText("Name")); // now descending on Name
    fireEvent.click(screen.getByText("Amount")); // switch column -> ascending
    const bodyRows = getBodyRows();
    expect(bodyRows[0]).toHaveTextContent("Alice"); // amount 10
    expect(bodyRows[1]).toHaveTextContent("Bob"); // amount 20
    expect(bodyRows[2]).toHaveTextContent("Charlie"); // amount 30
  });

  it("sets aria-sort on the active column header", () => {
    render(<DataTable columns={columns} data={rows} />);
    const nameHeader = screen.getByText("Name").closest("th")!;
    expect(nameHeader).toHaveAttribute("aria-sort", "none");
    fireEvent.click(screen.getByText("Name"));
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByText("Name"));
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("does not render a sort button for non-sortable columns", () => {
    const mixedColumns: DataTableColumn<Row>[] = [
      { key: "name", label: "Name", sortable: true },
      { key: "amount", label: "Amount" },
    ];
    render(<DataTable columns={mixedColumns} data={rows} />);
    const amountHeader = screen.getByText("Amount").closest("th")!;
    expect(amountHeader.querySelector("button")).toBeNull();
    expect(amountHeader).not.toHaveAttribute("aria-sort");
  });

  it("uses a custom comparator function when sortable is a function", () => {
    const customColumns: DataTableColumn<Row>[] = [
      { key: "name", label: "Name" },
      {
        key: "amount",
        label: "Amount",
        // Sort by amount descending regardless of click direction toggling logic —
        // proves the custom comparator is actually invoked instead of the
        // default string compare.
        sortable: (a, b) => b.amount - a.amount,
      },
    ];
    render(<DataTable columns={customColumns} data={rows} />);
    fireEvent.click(screen.getByText("Amount"));
    const bodyRows = getBodyRows();
    expect(bodyRows[0]).toHaveTextContent("Charlie"); // amount 30
    expect(bodyRows[1]).toHaveTextContent("Bob"); // amount 20
    expect(bodyRows[2]).toHaveTextContent("Alice"); // amount 10
  });

  it("does not render an Actions column when no onDelete/renderForm are given", () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("renders a Delete button per row when onDelete is provided", () => {
    render(<DataTable columns={columns} data={rows} onDelete={vi.fn()} />);
    expect(screen.getAllByText("Delete")).toHaveLength(3);
  });

  it("calls onDelete with the row id when the user confirms deletion", async () => {
    mockConfirm.mockResolvedValueOnce(true);
    const onDelete = vi.fn();
    render(<DataTable columns={columns} data={rows} onDelete={onDelete} />);

    fireEvent.click(screen.getAllByText("Delete")[1]!); // Alice, id 2
    expect(mockConfirm).toHaveBeenCalledWith("Delete this record?");
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(2));
  });

  it("does not call onDelete when the user cancels the confirmation", async () => {
    mockConfirm.mockResolvedValueOnce(false);
    const onDelete = vi.fn();
    render(<DataTable columns={columns} data={rows} onDelete={onDelete} />);

    fireEvent.click(screen.getAllByText("Delete")[0]!);
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("disables Delete buttons while isDeleting is true", () => {
    render(
      <DataTable columns={columns} data={rows} onDelete={vi.fn()} isDeleting />,
    );
    for (const btn of screen.getAllByText("Delete")) {
      expect(btn).toBeDisabled();
    }
  });

  it("shows an Add button and renders the inline form when renderForm is given", () => {
    const renderForm = vi.fn((editing: Row | null, onClose: () => void) => (
      <div data-testid="inline-form">
        <span>{editing ? `Editing ${editing.name}` : "New row"}</span>
        <button onClick={onClose}>Close</button>
      </div>
    ));
    render(
      <DataTable
        columns={columns}
        data={rows}
        title="People"
        renderForm={renderForm}
      />,
    );
    expect(screen.queryByTestId("inline-form")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByTestId("inline-form")).toBeInTheDocument();
    expect(screen.getByText("New row")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByTestId("inline-form")).not.toBeInTheDocument();
  });

  it("opens the inline form pre-populated with the row when Edit is clicked", () => {
    const renderForm = (editing: Row | null) => (
      <div data-testid="inline-form">
        {editing ? `Editing ${editing.name}` : "New row"}
      </div>
    );
    render(<DataTable columns={columns} data={rows} renderForm={renderForm} />);
    fireEvent.click(screen.getAllByText("Edit")[1]!); // Alice
    expect(screen.getByText("Editing Alice")).toBeInTheDocument();
  });

  it("uses a custom rowKey when provided", () => {
    const withRowKey = (
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => `row-${row.id}`}
      />
    );
    // Smoke: renders without key-collision warnings / crashes.
    expect(() => render(withRowKey)).not.toThrow();
  });

  it("uses a custom cell renderer when provided", () => {
    const customColumns: DataTableColumn<Row>[] = [
      {
        key: "amount",
        label: "Amount",
        render: (row) => <span>${row.amount}.00</span>,
      },
    ];
    render(<DataTable columns={customColumns} data={rows} />);
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });
});
