import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId, SystemPrompt } from "@aihub/core";
import { useI18n } from "../../i18n";
import { useAppStore, useSelectedConversation } from "../../stores/app-store";
import { confirmDialog } from "../../stores/dialog-store";
import { useToastStore } from "../../stores/toast-store";
import { Dialog } from "../shared/Dialog";

interface PromptDraft {
  id?: string;
  name: string;
  content: string;
  provider?: ProviderId;
  isDefault: boolean;
}

const emptyDraft: PromptDraft = {
  name: "",
  content: "",
  isDefault: false,
};

export function SystemPromptModal() {
  const { t } = useI18n();
  const open = useAppStore((state) => state.systemPromptModalOpen);
  const setOpen = useAppStore((state) => state.setSystemPromptModalOpen);
  const prompts = useAppStore((state) => state.systemPrompts);
  const saveSystemPrompt = useAppStore((state) => state.saveSystemPrompt);
  const deleteSystemPrompt = useAppStore(
    (state) => state.deleteSystemPrompt,
  );
  const setConversationSystemPrompt = useAppStore(
    (state) => state.setConversationSystemPrompt,
  );
  const conversation = useSelectedConversation();
  const [draft, setDraft] = useState<PromptDraft>(emptyDraft);

  useEffect(() => {
    if (!open) setDraft(emptyDraft);
  }, [open]);

  function edit(prompt: SystemPrompt) {
    setDraft({
      id: prompt.id,
      name: prompt.name,
      content: prompt.content,
      provider: prompt.provider,
      isDefault: prompt.isDefault,
    });
  }

  async function save() {
    if (await saveSystemPrompt(draft)) setDraft(emptyDraft);
  }

  async function remove() {
    if (!draft.id) return;
    const confirmed = await confirmDialog({
      title: t("prompt.deleteTitle"),
      description: t("prompt.deleteDescription"),
      destructive: true,
    });
    if (!confirmed) return;
    if (await deleteSystemPrompt(draft.id)) {
      setDraft(emptyDraft);
      useToastStore.getState().addToast(t("toast.movedToTrash"), "success");
    }
  }

  const compatiblePrompts = conversation
    ? prompts.filter(
        (prompt) =>
          !prompt.provider || prompt.provider === conversation.provider,
      )
    : [];

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title={t("prompt.libraryTitle")}
      description={t("prompt.libraryDescription")}
      widthClass="w-[min(980px,calc(100vw-64px))]"
    >
      <div className="grid h-[min(620px,calc(100vh-190px))] min-h-0 grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-[var(--color-border)] pr-3">
          <button
            type="button"
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
            onClick={() => setDraft(emptyDraft)}
          >
            <Plus size={15} />
            {t("prompt.new")}
          </button>
          {prompts.map((prompt) => (
            <button
              type="button"
              key={prompt.id}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${
                draft.id === prompt.id
                  ? "bg-[var(--color-bg-active)]"
                  : "hover:bg-[var(--color-bg-hover)]"
              }`}
              onClick={() => edit(prompt)}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {prompt.name}
                </span>
                {prompt.isDefault && (
                  <span className="rounded-full bg-[var(--color-accent-glow)] px-1.5 py-0.5 text-[9px] text-[var(--color-accent)]">
                    {t("prompt.default")}
                  </span>
                )}
              </div>
              <span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">
                {prompt.provider
                  ? PROVIDER_LABELS[prompt.provider]
                  : t("nav.allProviders")}
              </span>
            </button>
          ))}
        </aside>
        <div className="min-h-0 overflow-y-auto pl-6">
          {conversation && (
            <label className="mb-5 block">
              <span className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">
                {t("prompt.currentConversation")}
              </span>
              <select
                className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2 text-sm"
                value={conversation.systemPromptId ?? ""}
                onChange={(event) =>
                  void setConversationSystemPrompt(
                    conversation.id,
                    event.target.value || undefined,
                  )
                }
              >
                <option value="">{t("prompt.providerDefault")}</option>
                {compatiblePrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid gap-4">
            <label>
              <span className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">
                {t("settings.name")}
              </span>
              <input
                className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">
                {t("prompt.providerScope")}
              </span>
              <select
                className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
                value={draft.provider ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    provider:
                      (event.target.value as ProviderId) || undefined,
                  })
                }
              >
                <option value="">{t("nav.allProviders")}</option>
                {PROVIDER_IDS.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">
                {t("prompt.content")}
              </span>
              <textarea
                className="min-h-64 w-full resize-y rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] p-3 leading-6 outline-none focus:border-[var(--color-accent)]"
                value={draft.content}
                onChange={(event) =>
                  setDraft({ ...draft, content: event.target.value })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(event) =>
                  setDraft({ ...draft, isDefault: event.target.checked })
                }
              />
              {t("prompt.setDefault")}
            </label>
            <div className="flex justify-between">
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] disabled:opacity-30"
                disabled={!draft.id}
                onClick={() => void remove()}
              >
                <Trash2 size={15} />
                {t("common.delete")}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg bg-[var(--color-accent-bg)] px-4 py-2 text-sm font-semibold text-[#08100c] disabled:opacity-40"
                disabled={!draft.name.trim() || !draft.content.trim()}
                onClick={() => void save()}
              >
                <Save size={15} />
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
