// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedMessage } from "@aihub/core";
import { MessageActions } from "../src/renderer/components/chat/MessageActions";
import { ConfirmDialogHost } from "../src/renderer/components/shared/ConfirmDialogHost";
import { useAppStore } from "../src/renderer/stores/app-store";
import { useDialogStore } from "../src/renderer/stores/dialog-store";
import { useSettingsStore } from "../src/renderer/stores/settings-store";
import { useToastStore } from "../src/renderer/stores/toast-store";

describe("dangerous action feedback", () => {
  let container: HTMLDivElement;
  let root: Root;
  const message: NormalizedMessage = {
    id: "message-1",
    conversationId: "conversation-1",
    role: "user",
    content: [{ type: "text", text: "delete me" }],
    status: "completed",
    provider: "chatgpt",
    createdAt: "2026-07-26T00:00:00.000Z",
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSettingsStore.setState({ locale: "en-US" });
    useToastStore.setState({ toasts: [] });
    useDialogStore.setState({
      request: undefined,
      inputRequest: undefined,
      modalCount: 0,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows success only after the confirmed delete succeeds", async () => {
    const deleteMessage = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    useAppStore.setState({ deleteMessage });
    await act(async () =>
      root.render(
        <>
          <MessageActions
            message={message}
            canRetry={false}
            onEdit={() => undefined}
            onRetry={() => undefined}
          />
          <ConfirmDialogHost />
        </>,
      ),
    );

    await deleteThroughDialog();
    expect(useToastStore.getState().toasts).toHaveLength(0);

    await deleteThroughDialog();
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ message: "Deleted", type: "success" }),
    ]);
  });

  async function deleteThroughDialog(): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete message"]',
    );
    if (!trigger) throw new Error("Delete trigger was not found.");
    await act(async () => trigger.click());
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete",
    );
    if (!confirm) throw new Error("Delete confirmation was not found.");
    await act(async () => confirm.click());
  }
});
