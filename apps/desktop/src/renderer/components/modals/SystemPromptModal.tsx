import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId, SystemPrompt } from "@aihub/core";
import { useAppStore, useSelectedConversation } from "../../stores/app-store";

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

  if (!open) return null;

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
    if (await saveSystemPrompt(draft)) {
      setDraft(emptyDraft);
    }
  }

  const compatiblePrompts = conversation
    ? prompts.filter(
        (prompt) =>
          !prompt.provider || prompt.provider === conversation.provider,
      )
    : [];

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-[#06080dbd] p-8 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section className="grid h-[min(720px,calc(100vh-64px))] w-[min(980px,calc(100vw-64px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-tertiary)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">系统提示词库</h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              提示词仅在发送到 Provider 网站前注入。
            </p>
          </div>
          <button
            className="rounded-lg p-2 hover:bg-[var(--color-bg-hover)]"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </header>
        <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--color-border)] p-3">
            <button
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
              onClick={() => setDraft(emptyDraft)}
            >
              <Plus size={15} />
              新建提示词
            </button>
            {prompts.map((prompt) => (
              <button
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
                      默认
                    </span>
                  )}
                </div>
                <span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">
                  {prompt.provider
                    ? PROVIDER_LABELS[prompt.provider]
                    : "全部 Provider"}
                </span>
              </button>
            ))}
          </aside>
          <div className="min-h-0 overflow-y-auto p-6">
            {conversation && (
              <label className="mb-5 block">
                <span className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">
                  当前会话使用
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
                  <option value="">Provider 默认提示词</option>
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
                  名称
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
                  Provider 范围
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
                  <option value="">全部 Provider</option>
                  {PROVIDER_IDS.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">
                  指令内容
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
                设为此范围的默认提示词
              </label>
              <div className="flex justify-between">
                <button
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] disabled:opacity-30"
                  disabled={!draft.id}
                  onClick={() => {
                    if (draft.id && window.confirm("确定删除这个提示词吗？")) {
                      void deleteSystemPrompt(draft.id);
                      setDraft(emptyDraft);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  删除
                </button>
                <button
                  className="flex items-center gap-2 rounded-lg bg-[var(--color-accent-bg)] px-4 py-2 text-sm font-semibold text-[#08100c] disabled:opacity-40"
                  disabled={!draft.name.trim() || !draft.content.trim()}
                  onClick={() => void save()}
                >
                  <Save size={15} />
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
