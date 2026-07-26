import {
  ArrowRightLeft,
  Clipboard,
  Download,
  Edit3,
  FolderInput,
  Pin,
  PinOff,
  Tag,
  Trash2,
} from "lucide-react";
import type { NormalizedConversation } from "@aihub/core";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../stores/app-store";
import { confirmDialog, inputDialog } from "../../stores/dialog-store";
import { useToastStore } from "../../stores/toast-store";
import { ContextMenu, ContextMenuItem } from "../shared/ContextMenu";

export function ConversationContextMenu({
  conversation,
  position,
  onClose,
}: {
  conversation: NormalizedConversation;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const pinConversation = useAppStore((state) => state.pinConversation);
  const renameConversation = useAppStore((state) => state.renameConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const openTransferPreview = useAppStore(
    (state) => state.openTransferPreview,
  );
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const setConversationFolder = useAppStore(
    (state) => state.setConversationFolder,
  );
  const setConversationTags = useAppStore(
    (state) => state.setConversationTags,
  );
  const addToast = useToastStore((state) => state.addToast);

  async function rename() {
    const title = await inputDialog({
      title: t("conversation.rename"),
      description: t("conversation.renameDescription"),
      initialValue: conversation.title,
      confirmLabel: t("common.save"),
    });
    if (title && title !== conversation.title) {
      await renameConversation(conversation.id, title);
    }
  }

  async function remove() {
    const confirmed = await confirmDialog({
      title: t("conversation.deleteTitle", { title: conversation.title }),
      description: t("conversation.deleteDescription"),
      destructive: true,
    });
    if (!confirmed) return;
    if (await deleteConversation(conversation.id)) {
      addToast(t("toast.movedToTrash"), "success");
    }
  }

  async function chooseFolder() {
    const choice = await inputDialog({
      title: t("conversation.moveFolder"),
      description: t("conversation.folderDescription", {
        folders: folders.map((folder) => folder.name).join(", ") || "—",
      }),
      allowEmpty: true,
    });
    if (choice === undefined) return;
    const folder = folders.find(
      (item) => item.name.toLowerCase() === choice.toLowerCase(),
    );
    await setConversationFolder(conversation.id, folder?.id);
  }

  async function chooseTags() {
    const choice = await inputDialog({
      title: t("conversation.setTags"),
      description: t("conversation.tagsDescription", {
        tags: tags.map((tag) => tag.name).join(", ") || "—",
      }),
      allowEmpty: true,
    });
    if (choice === undefined) return;
    const names = choice
      .split(/[,，]/)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    await setConversationTags(
      conversation.id,
      tags
        .filter((tag) => names.includes(tag.name.toLowerCase()))
        .map((tag) => tag.id),
    );
  }

  async function copyId() {
    await navigator.clipboard.writeText(conversation.id);
    addToast(t("conversation.idCopied"), "success");
  }

  async function exportConversation(
    format: "markdown" | "json",
  ): Promise<void> {
    const content = await window.aihub.exportConversation(
      conversation.id,
      format,
    );
    const extension = format === "markdown" ? "md" : "json";
    const type =
      format === "markdown"
        ? "text/markdown;charset=utf-8"
        : "application/json;charset=utf-8";
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(conversation.title)}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
    addToast(
      t(
        format === "markdown"
          ? "conversation.exportedMarkdown"
          : "conversation.exportedJson",
      ),
      "success",
    );
  }

  return (
    <ContextMenu position={position} onClose={onClose}>
      <ContextMenuItem
        icon={Edit3}
        label={t("conversation.rename")}
        onClick={() => {
          onClose();
          void rename();
        }}
      />
      <ContextMenuItem
        icon={conversation.pinned ? PinOff : Pin}
        label={t(
          conversation.pinned ? "conversation.unpin" : "conversation.pin",
        )}
        onClick={() => {
          onClose();
          void pinConversation(conversation.id, !conversation.pinned);
        }}
      />
      <ContextMenuItem
        icon={Download}
        label={t("conversation.exportMarkdown")}
        onClick={() => {
          onClose();
          void exportConversation("markdown");
        }}
      />
      <ContextMenuItem
        icon={Download}
        label={t("conversation.exportJson")}
        onClick={() => {
          onClose();
          void exportConversation("json");
        }}
      />
      <ContextMenuItem
        icon={ArrowRightLeft}
        label={t("provider.transfer")}
        onClick={() => {
          onClose();
          void openTransferPreview();
        }}
      />
      <ContextMenuItem
        icon={FolderInput}
        label={t("conversation.moveFolder")}
        onClick={() => {
          onClose();
          void chooseFolder();
        }}
      />
      <ContextMenuItem
        icon={Tag}
        label={t("conversation.setTags")}
        onClick={() => {
          onClose();
          void chooseTags();
        }}
      />
      <ContextMenuItem
        icon={Clipboard}
        label={t("conversation.copyId")}
        onClick={() => {
          onClose();
          void copyId();
        }}
      />
      <div className="my-1 border-t border-[var(--color-border)]" />
      <ContextMenuItem
        icon={Trash2}
        label={t("common.delete")}
        danger
        onClick={() => {
          onClose();
          void remove();
        }}
      />
    </ContextMenu>
  );
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100) || "conversation";
}
