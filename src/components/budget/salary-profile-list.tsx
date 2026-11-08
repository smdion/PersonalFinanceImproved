import { ProfileDetail } from "./salary-profile-detail";
import { ProfileCreatePanel } from "./salary-profile-create-panel";
import { ProfileEditPanel } from "./salary-profile-edit-panel";
import type { Dispatch, SetStateAction } from "react";
import type { trpc, RouterOutputs } from "@/lib/trpc";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";

import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { ProfileViewingBadge } from "./profile-viewing-badge";

export type SalaryProfilePaneProps = {
  canEdit: boolean;
  creatingNew: boolean;
  effectiveSelectedId: number | null;
  globalActiveSalaryId: number | null;
  invalidateProfileDeps: () => void;
  locked: boolean;
  setCreatingNew: Dispatch<SetStateAction<boolean>>;
  setSelectedProfileId: Dispatch<SetStateAction<number | null>>;
};

/** The selected profile: the create form, the read-only view or the editor. */
export function SalaryProfilePane({
  canEdit,
  creatingNew,
  effectiveSelectedId,
  globalActiveSalaryId,
  invalidateProfileDeps,
  locked,
  setCreatingNew,
  setSelectedProfileId,
}: SalaryProfilePaneProps) {
  return (
    <div>
      {creatingNew ? (
        <ProfileCreatePanel
          onCancel={() => setCreatingNew(false)}
          onSaved={(newId) => {
            setCreatingNew(false);
            invalidateProfileDeps();
            if (newId !== undefined) setSelectedProfileId(newId);
          }}
        />
      ) : effectiveSelectedId != null ? (
        !canEdit || locked ? (
          <ProfileDetail
            profileId={effectiveSelectedId}
            isActiveProfile={effectiveSelectedId === globalActiveSalaryId}
          />
        ) : (
          <ProfileEditPanel
            profileId={effectiveSelectedId}
            isActiveProfile={effectiveSelectedId === globalActiveSalaryId}
            onSaved={() => invalidateProfileDeps()}
          />
        )
      ) : (
        <div className="text-faint text-xs">Select a profile.</div>
      )}
    </div>
  );
}

export type SalaryProfileListProps = {
  canDeleteAny: boolean;
  canEdit: boolean;
  cloneProfile: (sourceProfileId: number, currentName: string) => Promise<void>;
  creatingNew: boolean;
  effectiveSelectedId: number | null;
  globalActiveSalaryId: number | null;
  handleDelete: (id: number, name: string) => Promise<void>;
  profiles: RouterOutputs["salaryProfile"]["list"];
  renameMutation: ReturnType<typeof trpc.salaryProfile.update.useMutation>;
  setCreatingNew: Dispatch<SetStateAction<boolean>>;
  setSelectedProfileId: Dispatch<SetStateAction<number | null>>;
};

/** The profile list, with create, rename, clone and delete. */
export function SalaryProfileList({
  canDeleteAny,
  canEdit,
  cloneProfile,
  creatingNew,
  effectiveSelectedId,
  globalActiveSalaryId,
  handleDelete,
  profiles,
  renameMutation,
  setCreatingNew,
  setSelectedProfileId,
}: SalaryProfileListProps) {
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
          isActive={globalActiveSalaryId === p.id}
          onSelect={() => {
            setCreatingNew(false);
            setSelectedProfileId(p.id);
          }}
          onRename={
            canEdit
              ? (name) => renameMutation.mutate({ id: p.id, name })
              : undefined
          }
          onDelete={
            canEdit && canDeleteAny
              ? () => handleDelete(p.id, p.name)
              : undefined
          }
          onClone={canEdit ? () => cloneProfile(p.id, p.name) : undefined}
          meta={
            p.description ??
            (p.pinnedCount === 0
              ? "Empty"
              : `${p.pinnedCount} ${p.pinnedCount === 1 ? "job" : "jobs"} set`)
          }
        />
      ))}
    </div>
  );
}

export type SalaryProfileBarProps = {
  activeProfileName: string | undefined;
  canEdit: boolean;
  creatingNew: boolean;
  displayedProfile: RouterOutputs["salaryProfile"]["list"][number] | undefined;
  handleActivate: (id: number) => void;
  isViewingNonActive: boolean;
};

/** The viewed profile's name, its salary total and the help tip. */
export function SalaryProfileBar({
  activeProfileName,
  canEdit,
  creatingNew,
  displayedProfile,
  handleActivate,
  isViewingNonActive,
}: SalaryProfileBarProps) {
  return (
    <>
      {displayedProfile && !creatingNew && (
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
            <div className="flex items-center gap-5 text-xs">
              {displayedProfile.pinnedSalaryTotal > 0 && (
                <div>
                  <span className="text-faint">Salary total </span>
                  <span className="text-secondary font-semibold">
                    {formatCurrency(displayedProfile.pinnedSalaryTotal)}
                    <span className="text-faint font-normal">/yr</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <HelpTip text="A Salary Profile sets each person's pay for what-if analysis. Each job either has a complete entry in this profile — salary, bonus %, and multiplier — or it isn't in the profile at all and contributes $0. There's no fallback to a job record: if you want a different number, use a different profile. It is independent of the Contribution Profile — set either, both, or neither. The Paycheck page edits the active Salary Profile." />
        </div>
      )}
    </>
  );
}
