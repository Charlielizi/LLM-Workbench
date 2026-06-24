import {
  conversationIdSchema,
  providerIdSchema,
  sendMessageSchema,
  transferConfirmSchema,
} from "@aihub/core";
import { ipcMain } from "electron";
import type { AppService } from "./app-service";

export function registerIpc(service: AppService): void {
  ipcMain.handle("app:get-snapshot", () => service.snapshot());
  ipcMain.handle("conversation:create", (_event, provider) =>
    service.createConversation(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("message:send", (_event, input) =>
    service.sendMessage(sendMessageSchema.parse(input)),
  );
  ipcMain.handle("generation:cancel", (_event, provider) =>
    service.cancel(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:set-visible", (_event, provider, visible) => {
    return service.setWebsiteVisible(
      providerIdSchema.parse(provider),
      Boolean(visible),
    );
  });
  ipcMain.handle("transfer:preview", (_event, conversationId) =>
    service.previewTransfer(conversationIdSchema.parse(conversationId)),
  );
  ipcMain.handle("transfer:confirm", (_event, input) =>
    service.confirmTransfer(transferConfirmSchema.parse(input)),
  );
}
