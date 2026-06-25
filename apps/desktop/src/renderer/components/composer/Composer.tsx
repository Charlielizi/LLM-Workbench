import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Paperclip,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { PROVIDER_LABELS } from "@aihub/core";
import { providerDefinitions } from "@aihub/adapters";
import type { NormalizedConversation } from "@aihub/core";
import type {
  AttachmentKind,
  OutgoingAttachment,
} from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useComposerStore } from "../../stores/composer-store";
import { useToastStore } from "../../stores/toast-store";
import { formatTokenCount } from "../../utils/token-estimate";

export function Composer({
  conversation,
}: {
  conversation: NormalizedConversation;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const drafts = useComposerStore((state) => state.drafts);
  const setDraft = useComposerStore((state) => state.setDraft);
  const clearDraft = useComposerStore((state) => state.clearDraft);
  const selectedModes = useComposerStore(
    (state) => state.modes[conversation.id] ?? [],
  );
  const toggleMode = useComposerStore((state) => state.toggleMode);
  const selectedModel = useComposerStore(
    (state) => state.models[conversation.id],
  );
  const setModel = useComposerStore((state) => state.setModel);
  const liveCapabilities = useAppStore(
    (state) => state.providerCapabilities[conversation.provider],
  );
  const sendMessage = useAppStore((state) => state.sendMessage);
  const cancelGeneration = useAppStore(
    (state) => state.cancelGeneration,
  );
  const busy = useAppStore((state) => state.busy);
  const error = useAppStore((state) => state.error);
  const addToast = useToastStore((state) => state.addToast);
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  const setSystemPromptModalOpen = useAppStore(
    (state) => state.setSystemPromptModalOpen,
  );
  const streaming = useAppStore((state) =>
    state.streamingConversations.has(conversation.id),
  );
  const text = drafts[conversation.id] ?? "";
  const configuredModes =
    providerDefinitions[conversation.provider].modeDefinitions;
  const providerModes = liveCapabilities?.modes.length
    ? configuredModes.filter((item) =>
        liveCapabilities.modes.some((mode) => mode.mode === item.mode)
      )
    : configuredModes;
  const activePrompt =
    systemPrompts.find(
      (prompt) => prompt.id === conversation.systemPromptId,
    ) ??
    systemPrompts.find(
      (prompt) =>
        prompt.isDefault && prompt.provider === conversation.provider,
    ) ??
    systemPrompts.find(
      (prompt) => prompt.isDefault && !prompt.provider,
    );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    setAttachments([]);
  }, [conversation.id]);

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter(
      (file) => file.size <= 25 * 1024 * 1024,
    );
    setAttachments((current) => {
      const existing = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      );
      return [
        ...current,
        ...incoming.filter(
          (file) =>
            !existing.has(`${file.name}:${file.size}:${file.lastModified}`),
        ),
      ].slice(0, 10);
    });
    if (files.length !== incoming.length)
      addToast("已忽略超过 25 MB 的附件。", "warning", 4000);
  }

  async function send() {
    if (!text.trim() && !attachments.length) return;
    const outgoing = attachments.flatMap((file): OutgoingAttachment[] => {
      const localPath = window.aihub.getLocalFilePath(file);
      if (!localPath) return [];
      return [{
        name: file.name,
        localPath,
        kind: attachmentKind(file),
        sizeBytes: file.size,
      }];
    });
    if (outgoing.length !== attachments.length) {
      addToast("部分附件无法读取本地路径。", "error", 5000);
      return;
    }
    if (await sendMessage({
      text,
      attachments: outgoing,
      modes: selectedModes,
      model: selectedModel,
    })) {
      clearDraft(conversation.id);
      setAttachments([]);
    }
  }

  return (
    <div
      className="mx-auto mb-5 w-[min(860px,calc(100%-48px))]"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {error && (
        <div className="mb-2 rounded-lg bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-text)]">
          {error}
        </div>
      )}
      <div
        className={`relative rounded-2xl border bg-[var(--color-bg-elevated)] shadow-[0_18px_60px_#0004] focus-within:border-[var(--color-accent)] ${
          dragging
            ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent-glow)]"
            : "border-[var(--color-border-input)]"
        }`}
      >
        {activePrompt && (
          <button
            className="mx-3 mt-3 flex items-center gap-1.5 rounded-full bg-[var(--color-accent-glow)] px-2.5 py-1 text-[11px] text-[var(--color-accent)] hover:brightness-110"
            onClick={() => setSystemPromptModalOpen(true)}
          >
            <Sparkles size={12} />
            {activePrompt.name}
          </button>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border border-dashed border-[var(--color-accent)] bg-[var(--color-bg-elevated)]/95 text-sm text-[var(--color-accent)]">
            松开以添加附件
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((file) => (
              <span
                key={`${file.name}:${file.size}:${file.lastModified}`}
                className="flex max-w-52 items-center gap-2 rounded-lg bg-[var(--color-bg-inset)] px-2.5 py-1.5 text-xs"
              >
                <FileText
                  size={14}
                  className="shrink-0 text-[var(--color-accent)]"
                />
                <span className="truncate">{file.name}</span>
                <button
                  className="text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)]"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item !== file),
                    )
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="block max-h-[220px] min-h-[76px] w-full resize-none overflow-y-auto border-0 bg-transparent p-4 outline-none placeholder:text-[var(--color-text-tertiary)]"
          value={text}
          placeholder={`发送给 ${PROVIDER_LABELS[conversation.provider]}…`}
          onChange={(event) => setDraft(conversation.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between gap-4 px-3 pb-3 text-[11px] text-[var(--color-text-tertiary)]">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              onClick={() => fileInputRef.current?.click()}
              title="添加附件"
            >
              <Paperclip size={15} />
            </button>
            <button
              className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              onClick={() => setSystemPromptModalOpen(true)}
              title="系统提示词"
            >
              <Sparkles size={15} />
            </button>
            {providerModes.map((item) => {
              const active = selectedModes.includes(item.mode);
              return (
                <button
                  key={item.mode}
                  type="button"
                  className={`h-8 rounded-lg px-2.5 text-xs transition-colors ${
                    active
                      ? "bg-[var(--color-accent-glow)] text-[var(--color-accent)]"
                      : "hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  }`}
                  aria-pressed={active}
                  onClick={() => toggleMode(conversation.id, item.mode)}
                  title={`${active ? "关闭" : "开启"}${item.label}`}
                >
                  {item.label}
                </button>
              );
            })}
            {liveCapabilities && liveCapabilities.models.length > 0 && (
              <select
                className="h-8 max-w-40 rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-2 text-xs text-[var(--color-text-primary)]"
                value={selectedModel ?? liveCapabilities.model ?? ""}
                onMouseDown={() =>
                  void window.aihub.discoverProviderModels(
                    conversation.provider,
                  )
                }
                onChange={(event) =>
                  setModel(conversation.id, event.target.value || undefined)
                }
                aria-label="选择模型"
              >
                {liveCapabilities.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            )}
            <span>
              {formatTokenCount(text) || "Enter 发送 · Shift+Enter 换行"}
            </span>
          </div>
          {streaming ? (
            <button
              className="grid size-9 place-items-center rounded-xl bg-[var(--color-danger)] text-white"
              onClick={() => void cancelGeneration(conversation.provider)}
              aria-label="停止生成"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="grid size-9 place-items-center rounded-xl bg-[var(--color-accent-bg)] text-[#08100c] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busy || (!text.trim() && !attachments.length)}
              onClick={() => void send()}
              aria-label="发送消息"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function attachmentKind(file: File): AttachmentKind {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("image/")) return "image";
  if (extension === "pdf") return "pdf";
  if (["doc", "docx"].includes(extension)) return "word";
  if (["xls", "xlsx", "csv"].includes(extension)) return "excel";
  if (["ppt", "pptx"].includes(extension)) return "powerpoint";
  return "text";
}
