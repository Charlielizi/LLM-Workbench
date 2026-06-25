import type { ProviderDefinition } from "@aihub/adapters";

export interface ProviderModeCommandState {
  available: boolean;
  enabled: boolean;
  x?: number;
  y?: number;
  transient?: boolean;
}

export type AttachmentUploadMode = "image" | "document";

export function resolveFileInputSelectors(
  definition: Pick<ProviderDefinition, "fileInputSelectors">,
): string[] {
  return Array.from(new Set([
    "input[data-aihub-file-input='true']",
    ...definition.fileInputSelectors,
    "input[type='file']",
  ]));
}

export function isTransientModeSelection(
  state: Pick<ProviderModeCommandState, "transient">,
  enabled: boolean,
): boolean {
  return enabled && state.transient === true;
}

export function attachmentUploadModeForKind(
  kind: string,
): AttachmentUploadMode {
  return kind === "image" ? "image" : "document";
}
