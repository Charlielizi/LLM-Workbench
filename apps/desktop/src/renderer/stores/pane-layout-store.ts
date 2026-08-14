import { create } from "zustand";
import type { ProviderId } from "@aihub/core";

export type WorkspacePane = "client" | "provider";

interface PaneLayoutState {
  clientRequested: boolean;
  providerRequested: boolean;
  activeNarrowPane: WorkspacePane;
  lastActivePane: WorkspacePane;
  lastProviderId: ProviderId | undefined;
  narrowLayout: boolean;
  syncProviderVisibility: (provider?: ProviderId) => void;
  setNarrowLayout: (narrow: boolean) => void;
  setActiveNarrowPane: (pane: WorkspacePane) => void;
  showClient: () => void;
  hideClient: () => void;
  showLastProvider: () => void;
  hideProvider: () => void;
}

export const usePaneLayoutStore = create<PaneLayoutState>((set, get) => ({
  clientRequested: true,
  providerRequested: false,
  activeNarrowPane: "client",
  lastActivePane: "client",
  lastProviderId: undefined,
  narrowLayout: false,

  syncProviderVisibility: (provider) => {
    if (provider) {
      set({
        providerRequested: true,
        lastProviderId: provider,
        activeNarrowPane: "provider",
        lastActivePane: "provider",
      });
      return;
    }
    set((state) => ({
      providerRequested: false,
      clientRequested: true,
      activeNarrowPane: "client",
      lastActivePane:
        state.lastActivePane === "provider" ? "client" : state.lastActivePane,
    }));
  },

  setNarrowLayout: (narrowLayout) => set({ narrowLayout }),

  setActiveNarrowPane: (pane) => {
    const state = get();
    if (
      (pane === "client" && !state.clientRequested) ||
      (pane === "provider" && !state.providerRequested)
    ) {
      return;
    }
    set({ activeNarrowPane: pane, lastActivePane: pane });
  },

  showClient: () =>
    set({
      clientRequested: true,
      activeNarrowPane: "client",
      lastActivePane: "client",
    }),

  hideClient: () => {
    if (!get().providerRequested) return;
    set({
      clientRequested: false,
      activeNarrowPane: "provider",
      lastActivePane: "provider",
    });
  },

  showLastProvider: () => {
    const provider = get().lastProviderId;
    if (!provider) return;
    set({
      providerRequested: true,
      activeNarrowPane: "provider",
      lastActivePane: "provider",
    });
    void window.aihub.setProviderWebsiteVisible(provider, true);
  },

  hideProvider: () => {
    const provider = get().lastProviderId;
    set({
      clientRequested: true,
      providerRequested: false,
      activeNarrowPane: "client",
      lastActivePane: "client",
    });
    if (provider) {
      void window.aihub.setProviderWebsiteVisible(provider, false);
    }
  },
}));
