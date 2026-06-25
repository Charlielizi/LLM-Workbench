import { create } from "zustand";

export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

let nextId = 0;

interface ToastState {
  toasts: Toast[];
  addToast: (
    message: string,
    type?: ToastType,
    duration?: number,
  ) => string;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (
    message: string,
    type: ToastType = "info",
    duration: number = 4000,
  ) => {
    const id = `toast-${++nextId}`;
    set({ toasts: [...get().toasts, { id, message, type, duration }] });
    if (duration > 0) {
      setTimeout(() => {
        const { dismissToast } = get();
        dismissToast(id);
      }, duration);
    }
    return id;
  },

  dismissToast: (id: string) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
