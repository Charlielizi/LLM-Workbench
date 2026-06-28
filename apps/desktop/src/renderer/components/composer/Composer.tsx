import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import type {
  AttachmentKind,
  NormalizedConversation,
  OutgoingAttachment,
  ProviderMode,
} from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useComposerStore } from "../../stores/composer-store";
import { useToastStore } from "../../stores/toast-store";
import { formatTokenCount } from "../../utils/token-estimate";
import { shouldShowAttachmentControl } from "../../utils/provider-capabilities";

const EMPTY_MODES: ProviderMode[] = [];

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
    (state) => state.modes[conversation.id] ?? EMPTY_MODES,
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
  const conversationBusy = useAppStore((state) =>
    state.busyConversations.has(conversation.id),
  );
  const error = useAppStore((state) =>
    state.messageErrors.get(conversation.id),
  );
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
        liveCapabilities.modes.some((mode) => mode.mode === item.mode),
      )
    : configuredModes;
  const showAttachmentControl = shouldShowAttachmentControl(
    providerDefinitions[conversation.provider],
    liveCapabilities,
  );
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
    if (files.length !== incoming.length) {
      addToast("Ignored attachments larger than 25 MB.", "warning", 4000);
    }
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
      addToast("Some attachments could not be resolved to local paths.", "error", 5000);
      return;
    }
    if (
      await sendMessage({
        text,
        attachments: outgoing,
        modes: selectedModes,
        model: selectedModel,
      })
    ) {
      clearDraft(conversation.id);
      setAttachments([]);
    }
  }

  return (
    <div
      className="px-6 pb-6 pt-2"
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
      <div className="mx-auto w-[min(860px,calc(100%-48px))]">
        {error && (
          <div className="mb-2 rounded-2xl border border-[var(--color-danger-bg)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-text)]">
            {error}
          </div>
        )}
        <div
          className={`panel-glass-strong relative rounded-[2rem] border p-3 shadow-[var(--shadow-lg)] transition duration-200 ${
            dragging
              ? "border-[var(--color-border-strong)]"
              : "border-[var(--color-border-input)]"
          }`}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-[1.4rem] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-glass-strong)] text-sm text-[var(--color-text-secondary)]">
              Drop files to attach
            </div>
          )}

          {(activePrompt || attachments.length > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              {activePrompt && (
                <button
                  className="interactive-chip rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  onClick={() => setSystemPromptModalOpen(true)}
                >
                  <span className="mr-1 inline-flex align-middle">
                    <Sparkles size={12} />
                  </span>
                  {activePrompt.name}
                </button>
              )}

              {attachments.map((file) => (
                <span
                  key={`${file.name}:${file.size}:${file.lastModified}`}
                  className="flex max-w-52 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-1 text-xs text-[var(--color-text-secondary)]"
                >
                  <FileText size={13} className="shrink-0" />
                  <span className="truncate">{file.name}</span>
                  <button
                    className="rounded-full p-0.5 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item !== file),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="block max-h-[220px] min-h-[88px] w-full resize-none overflow-y-auto border-0 bg-transparent px-2 pb-3 pt-2 text-[15px] leading-7 outline-none placeholder:text-[var(--color-text-tertiary)]"
            value={text}
            placeholder={`Message ${PROVIDER_LABELS[conversation.provider]}`}
            onChange={(event) => setDraft(conversation.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--color-border-light)] px-1 pt-3 text-[11px] text-[var(--color-text-tertiary)]">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
              {showAttachmentControl && (
                <IconChip
                  title="Attach files"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={15} />
                </IconChip>
              )}
              <IconChip
                title="System prompt"
                onClick={() => setSystemPromptModalOpen(true)}
              >
                <Sparkles size={15} />
              </IconChip>

              {providerModes.map((item) => {
                const active = selectedModes.includes(item.mode);
                return (
                  <button
                    key={item.mode}
                    type="button"
                    className={`interactive-chip h-8 rounded-full border px-3 text-xs ${
                      active
                        ? "border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]"
                        : "border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                    }`}
                    aria-pressed={active}
                    onClick={() => toggleMode(conversation.id, item.mode)}
                    title={item.label}
                  >
                    {item.label}
                  </button>
                );
              })}

              {liveCapabilities && liveCapabilities.models.length > 0 && (
                <select
                  className="h-8 max-w-40 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 text-xs text-[var(--color-text-primary)] outline-none"
                  value={selectedModel ?? liveCapabilities.model ?? ""}
                  onMouseDown={() =>
                    void window.aihub.discoverProviderModels(
                      conversation.provider,
                    )
                  }
                  onChange={(event) =>
                    setModel(conversation.id, event.target.value || undefined)
                  }
                  aria-label="Select model"
                >
                  {liveCapabilities.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              )}

              <span className="min-w-0 truncate">
                {formatTokenCount(text) || "Enter to send · Shift+Enter for newline"}
              </span>
            </div>

            {streaming ? (
              <button
                className="interactive-chip grid size-11 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]"
                onClick={() => void cancelGeneration(conversation.provider)}
                aria-label="Stop generation"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                className="interactive-chip grid size-11 place-items-center rounded-full bg-[var(--color-send-bg)] text-[var(--color-send-text)] shadow-[var(--shadow-sm)] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={conversationBusy || (!text.trim() && !attachments.length)}
                onClick={() => void send()}
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconChip({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className="interactive-chip grid size-8 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
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
