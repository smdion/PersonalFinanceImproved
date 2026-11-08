import type { Dispatch, SetStateAction } from "react";
import type { RouterOutputs, trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import type { usePlanNamesUsing } from "@/lib/hooks/use-plans";
import { planInUseMessage } from "@/lib/pure/household/plans";
import { toast } from "@/lib/hooks/use-toast";
import { ProfileViewingBadge } from "@/components/budget/profile-viewing-badge";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";
import { confirm } from "@/components/ui/confirm-dialog";
import type { useCloneProfile } from "@/components/budget/use-clone-profile";
import { SlidePanel } from "@/components/ui/slide-panel";
import { Tabs } from "@/components/ui/tabs";
import {
  ContribAccountForm,
  type ContribAccountFormValues,
} from "@/components/paycheck/contrib-account-form";
import { ProfileDetailPanel } from "./profile-detail-panel";
import { ProfileEditor } from "./profile-editor";
import { ProfileInlineEditor } from "./profile-inline-editor";
export function ProfileManagerTabs({
  viewMode,
  setViewMode,
  canEdit,
  setAddingAccount,
}: {
  viewMode: "profiles" | "compare";
  setViewMode: Dispatch<SetStateAction<"profiles" | "compare">>;
  canEdit: boolean;
  setAddingAccount: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="mb-4 flex items-center justify-between border-b">
      <Tabs
        look="underline-compact"
        value={viewMode}
        onChange={setViewMode}
        tabs={[
          { value: "profiles", label: "Profiles" },
          { value: "compare", label: "Compare" },
        ]}
      />
      {canEdit && (
        <button
          type="button"
          onClick={() => setAddingAccount(true)}
          className="text-caption mb-1.5 font-medium text-blue-600 hover:text-blue-700"
        >
          + Add Account
        </button>
      )}
    </div>
  );
}

export function AddContribAccountPanel({
  addingAccount,
  setAddingAccount,
  updateContribAccount,
  createContribAccount,
}: {
  addingAccount: boolean;
  setAddingAccount: Dispatch<SetStateAction<boolean>>;
  updateContribAccount: ReturnType<
    typeof trpc.settings.contributionAccounts.update.useMutation
  >;
  createContribAccount: ReturnType<
    typeof trpc.settings.contributionAccounts.create.useMutation
  >;
}) {
  return (
    <>
      <SlidePanel
        isOpen={addingAccount}
        onClose={() => setAddingAccount(false)}
        title="Add Contribution Account"
      >
        <ContribAccountForm
          onSave={(data: ContribAccountFormValues) => {
            const { id, ...rest } = data;
            if (id != null) {
              updateContribAccount.mutate({ id, ...rest });
            } else {
              createContribAccount.mutate(rest);
            }
          }}
          onCancel={() => setAddingAccount(false)}
          isPending={
            createContribAccount.isPending || updateContribAccount.isPending
          }
        />
      </SlidePanel>
    </>
  );
}

export function ProfileSummaryBar({
  displayedProfile,
  activeProfileName,
  isViewingNonActive,
  canEdit,
  handleActivate,
}: {
  displayedProfile:
    RouterOutputs["contributionProfile"]["list"][number] | undefined;
  activeProfileName: string | undefined;
  isViewingNonActive: boolean;
  canEdit: boolean;
  handleActivate: (id: number) => Promise<void>;
}) {
  return (
    <>
      {displayedProfile && (
        <div className="bg-surface-sunken mb-4 flex items-center justify-between rounded-lg px-4 py-3">
          <div className="flex items-center gap-6">
            <ProfileViewingBadge
              profileName={displayedProfile.name}
              activeProfileName={activeProfileName}
              isViewingNonActive={isViewingNonActive}
              onActivate={
                canEdit ? () => handleActivate(displayedProfile.id) : undefined
              }
            />
            {/* Contribution-scoped figures only. Salary is the Salary
            Profile's axis — showing a number here invited reading it as
            something this profile sets, which it never did. */}
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-faint">Contributions </span>
                <span className="text-secondary font-semibold">
                  {formatCurrency(displayedProfile.summary.annualContributions)}
                  <span className="text-faint font-normal">/yr</span>
                </span>
              </div>
              <div>
                <span className="text-faint">Employer Match </span>
                <span className="text-secondary font-semibold">
                  {formatCurrency(displayedProfile.summary.annualEmployerMatch)}
                  <span className="text-faint font-normal">/yr</span>
                </span>
              </div>
              {/* Held to this year's IRS limits at this year's ages; a
                  profile used as a switch is capped at each year's
                  ages in the projection (its save warning names them). */}
              {isViewingNonActive && (
                <span className="text-faint">
                  at {new Date().getFullYear()}&apos;s IRS limits and ages
                </span>
              )}
            </div>
          </div>
          <HelpTip text="Contributions and employer match for the profile shown below. Every profile is an ordinary, editable set of contribution settings — create more to model different contribution strategies, then use them in the Relocation tool. Salary and bonus are the Salary Profile's axis, not this one. Selected independently from the budget profile above — linked per budget column instead (see each column's settings)." />
        </div>
      )}
    </>
  );
}

export function ProfileList({
  canEdit,
  setSelectedProfileId,
  setCreatingNew,
  profiles,
  creatingNew,
  effectiveSelectedId,
  activeContribId,
  renameMutation,
  handleActivate,
  canDeleteAny,
  planNamesUsing,
  deleteMutation,
  cloneProfile,
}: {
  canEdit: boolean;
  setSelectedProfileId: Dispatch<SetStateAction<number | null>>;
  setCreatingNew: Dispatch<SetStateAction<boolean>>;
  profiles: RouterOutputs["contributionProfile"]["list"];
  creatingNew: boolean;
  effectiveSelectedId: number | null;
  activeContribId: number | null;
  renameMutation: ReturnType<
    typeof trpc.contributionProfile.update.useMutation
  >;
  handleActivate: (id: number) => Promise<void>;
  canDeleteAny: boolean;
  planNamesUsing: ReturnType<typeof usePlanNamesUsing>;
  deleteMutation: ReturnType<
    typeof trpc.contributionProfile.delete.useMutation
  >;
  cloneProfile: ReturnType<typeof useCloneProfile>["clone"];
}) {
  return (
    <div className="space-y-1.5">
      <ProfileSidebarHeader
        onCreate={
          canEdit
            ? () => {
                setSelectedProfileId(null);
                setCreatingNew(true);
              }
            : undefined
        }
      />

      {profiles.map((p) => (
        <ProfileListRow
          key={p.id}
          name={p.name}
          isSelected={!creatingNew && effectiveSelectedId === p.id}
          isActive={activeContribId === p.id}
          onSelect={() => {
            setCreatingNew(false);
            setSelectedProfileId(p.id);
          }}
          onRename={
            canEdit
              ? (name) => renameMutation.mutate({ id: p.id, name })
              : undefined
          }
          onActivate={canEdit ? () => handleActivate(p.id) : undefined}
          onDelete={
            canEdit && canDeleteAny
              ? async () => {
                  const usedBy = planNamesUsing("contribution", p.id);
                  if (usedBy.length > 0) {
                    toast.error(planInUseMessage("contribution", usedBy));
                    return;
                  }
                  if (await confirm(`Delete profile "${p.name}"?`)) {
                    deleteMutation.mutate({ id: p.id });
                  }
                }
              : undefined
          }
          onClone={canEdit ? () => cloneProfile(p.id, p.name) : undefined}
          meta={
            <>
              <span>{formatCurrency(p.summary.annualContributions)}/yr</span>
              {p.summary.annualEmployerMatch > 0 && (
                <span className="text-green-600">
                  +{formatCurrency(p.summary.annualEmployerMatch)}
                </span>
              )}
            </>
          }
        />
      ))}

      {profiles.length <= 1 && (
        <p className="text-caption text-faint px-2 py-3 italic">
          Only one profile so far. Create another to model a different
          contribution strategy.
        </p>
      )}
      <FormError
        error={deleteMutation.error}
        prefix="Failed to delete profile"
        className="mt-2 px-2"
      />
      <FormError
        error={renameMutation.error}
        prefix="Failed to rename profile"
        className="mt-2 px-2"
      />
    </div>
  );
}

export function ProfileDetailSlot({
  creatingNew,
  setCreatingNew,
  invalidateProfileDeps,
  setSelectedProfileId,
  effectiveSelectedId,
  canEdit,
  locked,
}: {
  creatingNew: boolean;
  setCreatingNew: Dispatch<SetStateAction<boolean>>;
  invalidateProfileDeps: () => void;
  setSelectedProfileId: Dispatch<SetStateAction<number | null>>;
  effectiveSelectedId: number | null;
  canEdit: boolean;
  locked: boolean;
}) {
  return (
    <div className="border-l pl-4">
      {creatingNew ? (
        <ProfileEditor
          onCancel={() => setCreatingNew(false)}
          onSaved={(newId) => {
            setCreatingNew(false);
            invalidateProfileDeps();
            if (newId !== undefined) setSelectedProfileId(newId);
          }}
        />
      ) : effectiveSelectedId != null ? (
        !canEdit || locked ? (
          <ProfileDetailPanel profileId={effectiveSelectedId} />
        ) : (
          <ProfileInlineEditor
            profileId={effectiveSelectedId}
            onSaved={() => invalidateProfileDeps()}
          />
        )
      ) : (
        <div className="text-faint flex h-40 items-center justify-center text-xs">
          Select a profile to view details
        </div>
      )}
    </div>
  );
}
