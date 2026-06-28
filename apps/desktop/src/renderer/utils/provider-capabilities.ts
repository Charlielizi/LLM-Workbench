import type { ProviderCapabilitySnapshot } from "@aihub/core";
import type { ProviderDefinition } from "@aihub/adapters";

export function shouldShowAttachmentControl(
  definition: ProviderDefinition,
  liveCapabilities?: ProviderCapabilitySnapshot,
): boolean {
  if (definition.attachmentCapabilityConfidence === "verified") return true;
  if (definition.attachmentCapabilityConfidence === "partial") {
    return (liveCapabilities?.attachments.length ?? 0) > 0;
  }
  return false;
}
