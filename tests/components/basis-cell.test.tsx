/** Performance table → per-person Roth basis cell. Invented data only. */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  BasisCell,
  parseBasisEditField,
} from "@/components/performance/basis-cell";
import type { AccountRow } from "@/components/performance/types";

const row = {
  basisByOwner: [
    {
      ownerPersonId: 1,
      ownerName: "Alice",
      contributionBasis: 100,
      conversionBasis: 10,
      latestConversionYear: 2024,
    },
    {
      ownerPersonId: 2,
      ownerName: "Bob",
      contributionBasis: 200,
      conversionBasis: 0,
      latestConversionYear: null,
    },
  ],
} as Pick<AccountRow, "basisByOwner"> as AccountRow;

const props = {
  editValue: "",
  onEditValueChange: vi.fn(),
  onSaveEdit: vi.fn(),
  onKeyDown: vi.fn(),
};

describe("BasisCell", () => {
  it("names each person and edits one person's figure", () => {
    const onStartEdit = vi.fn();
    render(
      <table>
        <tbody>
          <tr>
            <BasisCell
              row={row}
              field="conversionBasis"
              editable
              editingField={null}
              onStartEdit={onStartEdit}
              {...props}
            />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(onStartEdit).toHaveBeenCalledWith("conversionBasis:2", 0);
  });

  it("parses the edit field back to the person", () => {
    expect(parseBasisEditField("contributionBasis:7")).toEqual({
      field: "contributionBasis",
      ownerPersonId: 7,
    });
    expect(parseBasisEditField("endingBalance")).toBeNull();
  });
});
