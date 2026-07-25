// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../src/renderer/components/shared/Dialog";
import { useDialogStore } from "../src/renderer/stores/dialog-store";
import { useSettingsStore } from "../src/renderer/stores/settings-store";
import { useKeyboard } from "../src/renderer/hooks/useKeyboard";
import { useAppStore } from "../src/renderer/stores/app-store";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("Dialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSettingsStore.setState({ locale: "en-US" });
    useDialogStore.setState({
      request: undefined,
      inputRequest: undefined,
      modalCount: 0,
    });
    opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.appendChild(opener);
    opener.focus();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    opener.remove();
    vi.unstubAllGlobals();
  });

  it("traps Tab, closes with Escape, and restores the trigger focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="Test dialog">
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </Dialog>
      );
    }

    await act(async () => root.render(<Harness />));

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(useDialogStore.getState().modalCount).toBe(1);
    const buttons = dialog!.querySelectorAll<HTMLButtonElement>("button");
    const closeButton = buttons[0]!;
    const lastButton = buttons[buttons.length - 1]!;
    expect(document.activeElement).toBe(closeButton);

    lastButton.focus();
    await act(async () => {
      lastButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    await act(async () => {
      closeButton.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(lastButton);

    await act(async () => {
      lastButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(useDialogStore.getState().modalCount).toBe(0);
    expect(document.activeElement).toBe(opener);
  });

  it("pauses global shortcuts while a shared dialog is open", async () => {
    const createConversation = vi.fn(async () => undefined);
    useAppStore.setState({ createConversation });

    function Harness() {
      useKeyboard();
      return (
        <Dialog open onClose={() => undefined} title="Blocking dialog">
          <button type="button">Action</button>
        </Dialog>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    expect(createConversation).not.toHaveBeenCalled();
  });
});
