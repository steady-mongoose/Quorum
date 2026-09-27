import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  SEED_CAMPAIGNS,
  blankCampaign,
  type Campaign,
  type CellMember,
  type Level,
  type LogEntry,
  type Ally,
  type Office,
  type Profile,
  type View,
  type Wave,
} from "@/lib/quorum/model";

type QuorumState = {
  view: View;
  selectedId: string | null;
  campaigns: Campaign[];
  logs: LogEntry[];
  cell: CellMember[];
  allies: Ally[];
  profile: Profile;
  level: Level;
  customOffices: Office[];
  setView: (view: View) => void;
  setLevel: (level: Level) => void;
  openDesk: (id: string) => void;
  aimOffice: (officeId: string, threshold: number) => void;
  updateCampaign: (id: string, patch: Partial<Campaign>) => void;
  removeCampaign: (id: string) => void;
  logContact: (campaignId: string, wave: Wave, who: string) => void;
  clearLog: (campaignId: string) => void;
  addMember: (name: string, place: string) => void;
  removeMember: (id: string) => void;
  addAlly: (campaignId: string, name: string, pledged: number, channel: string) => void;
  removeAlly: (id: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  addOffice: (draft: { name: string; role: string; phone: string; level: Level }) => void;
};

function mergeSeeds(saved: Campaign[]): Campaign[] {
  const ids = new Set(saved.map((item) => item.id));
  const missing = SEED_CAMPAIGNS.filter((item) => !ids.has(item.id));
  return [...missing, ...saved];
}

function isOffice(value: unknown): value is Office {
  if (!value || typeof value !== "object") return false;
  const item = value as Office;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.dcPhone === "string" &&
    (item.level === "federal" || item.level === "state" || item.level === "county")
  );
}

function isAlly(value: unknown): value is Ally {
  if (!value || typeof value !== "object") return false;
  const item = value as Ally;
  return (
    typeof item.id === "string" &&
    typeof item.campaignId === "string" &&
    typeof item.name === "string" &&
    typeof item.pledged === "number"
  );
}

function isCampaign(value: unknown): value is Campaign {
  if (!value || typeof value !== "object") return false;
  const item = value as Campaign;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.officeId === "string" &&
    typeof item.threshold === "number" &&
    Array.isArray(item.refuses)
  );
}

const initialProfile: Profile = { name: "", place: "Wimauma, Florida" };

export const useQuorum = create<QuorumState>()(
  persist(
    (set, get) => ({
      view: "load",
      selectedId: null,
      campaigns: SEED_CAMPAIGNS,
      logs: [],
      cell: [],
      allies: [],
      profile: initialProfile,
      level: "federal",
      customOffices: [],
      setView: (view) => set({ view }),
      setLevel: (level) => set({ level }),
      openDesk: (id) => set({ view: "desk", selectedId: id }),
      aimOffice: (officeId, threshold) => {
        const reusable = get().campaigns.find(
          (campaign) =>
            !campaign.seeded && campaign.officeId === officeId && !campaign.demand.trim(),
        );
        if (reusable) {
          set({
            view: "desk",
            selectedId: reusable.id,
            campaigns: get().campaigns.map((campaign) =>
              campaign.id === reusable.id ? { ...campaign, threshold } : campaign,
            ),
          });
          return;
        }
        const next = blankCampaign(officeId, threshold);
        set({
          campaigns: [next, ...get().campaigns],
          view: "desk",
          selectedId: next.id,
        });
      },
      updateCampaign: (id, patch) =>
        set({
          campaigns: get().campaigns.map((campaign) =>
            campaign.id === id ? { ...campaign, ...patch, id: campaign.id } : campaign,
          ),
        }),
      removeCampaign: (id) =>
        set({
          campaigns: get().campaigns.filter((campaign) => campaign.id !== id || campaign.seeded),
          logs: get().logs.filter((entry) => entry.campaignId !== id),
          allies: get().allies.filter((ally) => ally.campaignId !== id),
          view: get().selectedId === id ? "load" : get().view,
          selectedId: get().selectedId === id ? null : get().selectedId,
        }),
      logContact: (campaignId, wave, who) =>
        set({
          logs: [
            {
              id: crypto.randomUUID(),
              campaignId,
              wave,
              who: who.trim() || "You",
              at: Date.now(),
            },
            ...get().logs,
          ],
        }),
      clearLog: (campaignId) =>
        set({ logs: get().logs.filter((entry) => entry.campaignId !== campaignId) }),
      addMember: (name, place) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set({
          cell: [
            ...get().cell,
            { id: crypto.randomUUID(), name: trimmed, place: place.trim() },
          ],
        });
      },
      removeMember: (id) => set({ cell: get().cell.filter((member) => member.id !== id) }),
      addAlly: (campaignId, name, pledged, channel) => {
        const trimmed = name.trim();
        const count = Math.round(Number(pledged));
        if (!trimmed || !Number.isFinite(count) || count < 1) return;
        set({
          allies: [
            ...get().allies,
            {
              id: crypto.randomUUID(),
              campaignId,
              name: trimmed,
              pledged: count,
              channel: channel.trim() || "Signal",
            },
          ],
        });
      },
      removeAlly: (id) => set({ allies: get().allies.filter((ally) => ally.id !== id) }),
      setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
      addOffice: ({ name, role, phone, level }) => {
        const trimmedName = name.trim();
        const trimmedPhone = phone.trim();
        const trimmedRole = role.trim();
        if (!trimmedName || !trimmedPhone || !trimmedRole) return;
        const office: Office = {
          id: crypto.randomUUID(),
          name: trimmedName,
          role: trimmedRole,
          party: "",
          state: level === "federal" ? "US" : "",
          level,
          chamber: level === "county" ? "commission" : level === "state" ? "executive" : "house",
          dcPhone: trimmedPhone,
          address: "Office you added",
          contactUrl: "https://www.usa.gov/elected-officials",
          holds: "Whoever can schedule the hearing or kill the substitute. You named this desk because it is the choke point where you live.",
          homeMatch: [],
        };
        set({ customOffices: [office, ...get().customOffices] });
      },
    }),
    {
      name: "quorum-desk-v1",
      skipHydration: true,
      partialize: (state) => ({
        view: state.view,
        selectedId: state.selectedId,
        campaigns: state.campaigns,
        logs: state.logs,
        cell: state.cell,
        allies: state.allies,
        profile: state.profile,
        level: state.level,
        customOffices: state.customOffices,
      }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        const saved = persisted as Partial<QuorumState>;
        const campaigns = mergeSeeds(
          Array.isArray(saved.campaigns) && saved.campaigns.every(isCampaign)
            ? saved.campaigns
            : current.campaigns,
        );
        const logs = Array.isArray(saved.logs) ? (saved.logs as LogEntry[]) : current.logs;
        const cell = Array.isArray(saved.cell) ? (saved.cell as CellMember[]) : current.cell;
        const allies =
          Array.isArray(saved.allies) && saved.allies.every(isAlly) ? saved.allies : current.allies;
        const customOffices =
          Array.isArray(saved.customOffices) && saved.customOffices.every(isOffice)
            ? saved.customOffices
            : current.customOffices;
        const profile =
          saved.profile && typeof saved.profile.place === "string"
            ? { name: saved.profile.name ?? "", place: saved.profile.place }
            : current.profile;
        const level =
          saved.level === "state" || saved.level === "county" || saved.level === "federal"
            ? saved.level
            : current.level;
        const view = saved.view ?? current.view;
        return {
          ...current,
          campaigns,
          logs,
          cell,
          allies,
          profile,
          level,
          customOffices,
          view,
          selectedId: saved.selectedId ?? null,
        };
      },
    },
  ),
);
