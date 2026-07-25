import { create } from "zustand";

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface InputDialogOptions {
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmRequest extends ConfirmDialogOptions {
  resolve: (confirmed: boolean) => void;
}

interface InputRequest extends InputDialogOptions {
  resolve: (value: string | undefined) => void;
}

interface DialogState {
  request?: ConfirmRequest;
  inputRequest?: InputRequest;
  modalCount: number;
  open: (request: ConfirmRequest) => void;
  openInput: (request: InputRequest) => void;
  finish: (confirmed: boolean) => void;
  finishInput: (value: string | undefined) => void;
  registerModal: () => void;
  unregisterModal: () => void;
}

const useDialogStore = create<DialogState>((set, get) => ({
  request: undefined,
  inputRequest: undefined,
  modalCount: 0,
  open: (request) => set({ request }),
  openInput: (inputRequest) => set({ inputRequest }),
  finish: (confirmed) => {
    const request = get().request;
    set({ request: undefined });
    request?.resolve(confirmed);
  },
  finishInput: (value) => {
    const request = get().inputRequest;
    set({ inputRequest: undefined });
    request?.resolve(value);
  },
  registerModal: () =>
    set((state) => ({ modalCount: state.modalCount + 1 })),
  unregisterModal: () =>
    set((state) => ({ modalCount: Math.max(0, state.modalCount - 1) })),
}));

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ ...options, resolve });
  });
}

export function inputDialog(
  options: InputDialogOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    useDialogStore.getState().openInput({ ...options, resolve });
  });
}

export { useDialogStore };
