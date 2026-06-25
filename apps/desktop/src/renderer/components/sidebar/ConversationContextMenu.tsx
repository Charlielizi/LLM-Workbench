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
import { ContextMenu, ContextMenuItem } from "../shared/ContextMenu";
import { useAppStore } from "../../stores/app-store";
import { useToastStore } from "../../stores/toast-store";

export function ConversationContextMenu({
  conversation,
  position,
  onClose,
}: {
  conversation: NormalizedConversation;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const pinConversation = useAppStore((state) => state.pinConversation);
  const renameConversation = useAppStore(
    (state) => state.renameConversation,
  );
  const deleteConversation = useAppStore(
    (state) => state.deleteConversation,
  );
  const openTransferPreview = useAppStore(
    (state) => state.openTransferPreview,
  );
  const addToast = useToastStore((state) => state.addToast);
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const setConversationFolder = useAppStore(
    (state) => state.setConversationFolder,
  );
  const setConversationTags = useAppStore(
    (state) => state.setConversationTags,
  );

  async function rename() {
    const title = window.prompt("重命名会话", conversation.title)?.trim();
    if (title && title !== conversation.title) {
      await renameConversation(conversation.id, title);
    }
  }

  async function remove() {
    if (!window.confirm(`确定删除“${conversation.title}”吗？此操作无法撤销。`)) {
      return;
    }
    await deleteConversation(conversation.id);
  }

  async function copyId() {
    await navigator.clipboard.writeText(conversation.id);
    addToast("会话 ID 已复制", "success");
  }

  function downloadContent(
    content: string,
    extension: string,
    type: string,
  ) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(conversation.title)}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ContextMenu position={position} onClose={onClose}>
      <ContextMenuItem
        icon={Edit3}
        label="重命名"
        onClick={() => {
          onClose();
          void rename();
        }}
      />
      <ContextMenuItem
        icon={conversation.pinned ? PinOff : Pin}
        label={conversation.pinned ? "取消置顶" : "置顶"}
        onClick={() => {
          onClose();
          void pinConversation(conversation.id, !conversation.pinned);
        }}
      />
      <ContextMenuItem
        icon={Download}
        label="导出 Markdown"
        onClick={() => {
          onClose();
          void window.aihub
            .exportConversation(conversation.id, "markdown")
            .then((content) => {
              downloadContent(
                content,
                "md",
                "text/markdown;charset=utf-8",
              );
              addToast("会话已导出为 Markdown", "success");
            });
        }}
      />
      <ContextMenuItem
        icon={Download}
        label="导出 JSON"
        onClick={() => {
          onClose();
          void window.aihub
            .exportConversation(conversation.id, "json")
            .then((content) => {
              downloadContent(
                content,
                "json",
                "application/json;charset=utf-8",
              );
              addToast("会话已导出为 JSON", "success");
            });
        }}
      />
      <ContextMenuItem
        icon={ArrowRightLeft}
        label="迁移会话"
        onClick={() => {
          onClose();
          void openTransferPreview();
        }}
      />
      <ContextMenuItem
        icon={FolderInput}
        label="移动到文件夹"
        onClick={() => {
          onClose();
          const choice = window.prompt(
            `输入文件夹名称，留空移出文件夹：\n${folders
              .map((folder) => folder.name)
              .join("、")}`,
          );
          if (choice === null) return;
          const folder = folders.find(
            (item) => item.name.toLowerCase() === choice.trim().toLowerCase(),
          );
          void setConversationFolder(conversation.id, folder?.id);
        }}
      />
      <ContextMenuItem
        icon={Tag}
        label="设置标签"
        onClick={() => {
          onClose();
          const choice = window.prompt(
            `输入标签名称，多个用逗号分隔：\n${tags
              .map((tag) => tag.name)
              .join("、")}`,
          );
          if (choice === null) return;
          const names = choice
            .split(/[,，]/)
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean);
          void setConversationTags(
            conversation.id,
            tags
              .filter((tag) => names.includes(tag.name.toLowerCase()))
              .map((tag) => tag.id),
          );
        }}
      />
      <ContextMenuItem
        icon={Clipboard}
        label="复制 ID"
        onClick={() => {
          onClose();
          void copyId();
        }}
      />
      <div className="my-1 border-t border-[var(--color-border)]" />
      <ContextMenuItem
        icon={Trash2}
        label="删除"
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
