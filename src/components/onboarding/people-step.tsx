/** The first-run wizard's People step. */
import { useState } from "react";
import { FormError } from "@/components/ui/form-error";
import { Badge } from "@/components/ui/badge";
import type { PersonDraft } from "./wizard-state";

export function PeopleStep({
  people,
  setPeople,
}: {
  people: PersonDraft[];
  setPeople: (p: PersonDraft[]) => void;
}) {
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [birthYearError, setBirthYearError] = useState<string | null>(null);

  const addPerson = () => {
    let hasError = false;
    setNameError(null);
    setBirthYearError(null);

    if (!name.trim()) {
      setNameError("Name is required");
      hasError = true;
    }

    if (!birthYear.trim()) {
      setBirthYearError("Birth year is required");
      hasError = true;
    } else {
      const year = parseInt(birthYear, 10);
      if (isNaN(year) || year < 1900 || year > new Date().getFullYear()) {
        setBirthYearError(
          `Enter a year between 1900 and ${new Date().getFullYear()}`,
        );
        hasError = true;
      }
    }

    if (hasError) return;

    const year = parseInt(birthYear, 10);
    const dateOfBirth = `${year}-01-01`;
    const isPrimary = people.length === 0;
    setPeople([
      ...people,
      { name: name.trim(), dateOfBirth, isPrimaryUser: isPrimary },
    ]);
    setName("");
    setBirthYear("");
    setNameError(null);
    setBirthYearError(null);
  };

  const removePerson = (index: number) => {
    const updated = people.filter((_, i) => i !== index);
    // Ensure first person is still primary
    if (updated.length > 0 && !updated.some((p) => p.isPrimaryUser)) {
      updated[0] = { ...updated[0]!, isPrimaryUser: true };
    }
    setPeople(updated);
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-primary text-2xl font-bold">Household Members</h2>
        <p className="text-muted mt-1">
          Add the people in your household. At least one is required.
        </p>
      </div>

      {/* Existing people list */}
      {people.length > 0 && (
        <div className="space-y-2">
          {people.map((person, i) => (
            <div
              key={`${person.name}-${person.dateOfBirth}`}
              className="bg-surface-primary border-default flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <span className="text-primary font-medium">{person.name}</span>
                <span className="text-muted ml-2 text-sm">
                  (born {person.dateOfBirth.substring(0, 4)})
                </span>
                {person.isPrimaryUser && (
                  <Badge color="blue" size="sm" shape="pill" className="ml-2">
                    Primary
                  </Badge>
                )}
              </div>
              <button
                onClick={() => removePerson(i)}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add person form */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <input
            aria-label="Name"
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
            className={`bg-surface-primary text-primary placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none ${nameError ? "border-red-400" : "border-default"}`}
          />
          <FormError message={nameError} />
        </div>
        <div>
          <input
            aria-label="Birth year"
            type="number"
            placeholder="Birth year"
            value={birthYear}
            onChange={(e) => {
              setBirthYear(e.target.value);
              setBirthYearError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
            className={`bg-surface-primary text-primary placeholder:text-muted w-32 [appearance:textfield] rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${birthYearError ? "border-red-400" : "border-default"}`}
          />
          <FormError message={birthYearError} />
        </div>
        <button
          onClick={addPerson}
          className="self-start rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
        >
          Add Person
        </button>
      </div>
    </div>
  );
}
