import { create } from "zustand";
import type { ProviderMode } from "@aihub/core";

const STORAGE_KEY = "aihub-drafts";

interface ComposerState {
  drafts: Record<string, string>;
  modes: Record<string, ProviderMode[]>;
  models: Record<string, string | undefined>;
  getDraft: (conversationId: string) => string;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
  toggleMode: (conversationId: string, mode: ProviderMode) => void;
  setModel: (conversationId: string, model: string | undefined) => void;
}

function loadDrafts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore
  }
  return {};
}

function saveDrafts(drafts: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore
  }
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  drafts: loadDrafts(),
  modes: {},
  models: {},

  getDraft: (conversationId: string) => {
    return get().drafts[conversationId] ?? "";
  },

  setDraft: (conversationId: string, text: string) => {
    const drafts = { ...get().drafts, [conversationId]: text };
    set({ drafts });
    saveDrafts(drafts);
  },

  clearDraft: (conversationId: string) => {
    const drafts = { ...get().drafts };
    delete drafts[conversationId];
    set({ drafts });
    saveDrafts(drafts);
  },

  toggleMode: (conversationId: string, mode: ProviderMode) => {
    const selected = new Set(get().modes[conversationId] ?? []);
    if (selected.has(mode)) selected.delete(mode);
    else selected.add(mode);
    set({
      modes: {
        ...get().modes,
        [conversationId]: Array.from(selected),
      },
    });
  },

  setModel: (conversationId: string, model: string | undefined) => {
    set({
      models: {
        ...get().models,
        [conversationId]: model,
      },
    });
  },
}));
