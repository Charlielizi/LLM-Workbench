import { useState } from "react";
import {
  BookOpen,
  FolderPlus,
  Info,
  Keyboard,
  Plus,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { useAppStore, useSelectedConversation } from "../../stores/app-store";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutAction,
  useSettingsStore,
} from "../../stores/settings-store";

type SettingsTab =
  | "general"
  | "prompts"
  | "shortcuts"
  | "knowledge"
  | "about";

const TABS: {
  id: SettingsTab;
  label: string;
  icon: typeof Settings;
}[] = [
  { id: "general", label: "通用设置", icon: Settings },
  { id: "prompts", label: "系统提示词", icon: Sparkles },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "knowledge", label: "知识库", icon: BookOpen },
  { id: "about", label: "关于", icon: Info },
];

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  focusSearch: "聚焦搜索",
  newConversation: "新建会话",
  toggleSidebar: "切换侧栏",
  toggleProvider: "切换 Provider 抽屉",
  toggleTheme: "切换主题",
  copyLastResponse: "复制最后回复",
  previousConversation: "上一个会话",
  nextConversation: "下一个会话",
  showShortcutHelp: "快捷键帮助",
};

export function SettingsModal() {
  const open = useAppStore((state) => state.settingsModalOpen);
  const setOpen = useAppStore((state) => state.setSettingsModalOpen);
  const [tab, setTab] = useState<SettingsTab>("general");
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-[#06080dbd] p-8 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section className="grid h-[min(760px,calc(100vh-64px))] w-[min(1040px,calc(100vw-64px))] grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-tertiary)] shadow-2xl">
        <aside className="border-r border-[var(--color-border)] p-3">
          <div className="mb-4 flex items-center justify-between px-2 py-2">
            <h2 className="font-semibold">设置</h2>
            <button
              className="rounded-lg p-1.5 hover:bg-[var(--color-bg-hover)]"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                tab === id
                  ? "bg-[var(--color-bg-active)]"
                  : "hover:bg-[var(--color-bg-hover)]"
              }`}
              onClick={() => setTab(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </aside>
        <div className="min-h-0 overflow-y-auto p-7">
          {tab === "general" && <GeneralSettings />}
          {tab === "prompts" && <PromptSettings />}
          {tab === "shortcuts" && <ShortcutSettings />}
          {tab === "knowledge" && <KnowledgeSettings />}
          {tab === "about" && <AboutSettings />}
        </div>
      </section>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-6">
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
        {description}
      </p>
    </header>
  );
}

function GeneralSettings() {
  const settings = useSettingsStore();
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const createFolder = useAppStore((state) => state.createFolder);
  const deleteFolder = useAppStore((state) => state.deleteFolder);
  const createTag = useAppStore((state) => state.createTag);
  const deleteTag = useAppStore((state) => state.deleteTag);
  const applyImportedSettings = useSettingsStore(
    (state) => state.applyImportedSettings,
  );

  return (
    <>
      <SectionTitle
        title="通用设置"
        description="主题、默认 Provider 与会话组织。"
      />
      <div className="grid gap-5">
        <label>
          <span className="mb-2 block text-sm font-medium">主题</span>
          <select
            className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
            value={settings.theme}
            onChange={(event) =>
              settings.setTheme(
                event.target.value as "dark" | "light" | "system",
              )
            }
          >
            <option value="system">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
        <label>
          <span className="mb-2 block text-sm font-medium">
            默认 Provider
          </span>
          <select
            className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
            value={settings.defaultProvider ?? ""}
            onChange={(event) =>
              settings.setDefaultProvider(
                (event.target.value as ProviderId) || null,
              )
            }
          >
            <option value="">ChatGPT</option>
            {PROVIDER_IDS.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">文件夹</span>
            <button
              className="flex items-center gap-1 text-xs text-[var(--color-accent)]"
              onClick={() => {
                const name = window.prompt("文件夹名称")?.trim();
                if (name) void createFolder(name);
              }}
            >
              <FolderPlus size={13} />
              新建
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {folders.map((folder) => (
              <span
                key={folder.id}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-inset)] px-2.5 py-1.5 text-xs"
              >
                {folder.name}
                <button onClick={() => void deleteFolder(folder.id)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">标签</span>
            <button
              className="flex items-center gap-1 text-xs text-[var(--color-accent)]"
              onClick={() => {
                const name = window.prompt("标签名称")?.trim();
                if (name) void createTag(name, "#7ce6ae");
              }}
            >
              <Tag size={13} />
              新建
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
                style={{ background: `${tag.color}22`, color: tag.color }}
              >
                {tag.name}
                <button onClick={() => void deleteTag(tag.id)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-2 block text-sm font-medium">导入与备份</span>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
              onClick={() =>
                void window.aihub.exportSettings().then((json) =>
                  downloadText(
                    "aihub-settings.json",
                    json,
                    "application/json",
                  ),
                )
              }
            >
              导出设置
            </button>
            <button
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
              onClick={() =>
                pickTextFile(".json", async (json) => {
                  const imported = await window.aihub.importSettings(json);
                  applyImportedSettings(imported);
                })
              }
            >
              导入设置
            </button>
            <button
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
              onClick={() =>
                pickTextFile(".json", async (json) => {
                  await window.aihub.importConversation(json);
                })
              }
            >
              导入会话 JSON
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function PromptSettings() {
  const prompts = useAppStore((state) => state.systemPrompts);
  const setPromptModalOpen = useAppStore(
    (state) => state.setSystemPromptModalOpen,
  );
  const setSettingsModalOpen = useAppStore(
    (state) => state.setSettingsModalOpen,
  );
  return (
    <>
      <SectionTitle
        title="系统提示词"
        description="管理通用或 Provider 专用的指令库。"
      />
      <button
        className="mb-5 flex items-center gap-2 rounded-lg bg-[var(--color-accent-bg)] px-4 py-2 font-semibold text-[#08100c]"
        onClick={() => {
          setSettingsModalOpen(false);
          setPromptModalOpen(true);
        }}
      >
        <Sparkles size={15} />
        打开提示词管理器
      </button>
      <div className="space-y-2">
        {prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="rounded-xl border border-[var(--color-border)] p-3"
          >
            <div className="font-medium">{prompt.name}</div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {prompt.provider
                ? PROVIDER_LABELS[prompt.provider]
                : "全部 Provider"}
              {prompt.isDefault ? " · 默认" : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ShortcutSettings() {
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const setShortcut = useSettingsStore((state) => state.setShortcut);
  return (
    <>
      <SectionTitle
        title="快捷键"
        description="修改后立即生效，格式示例：Ctrl+Shift+M。"
      />
      <div className="space-y-2">
        {(
          Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]
        ).map((action) => (
          <label
            key={action}
            className="flex items-center justify-between gap-4 rounded-lg px-3 py-2 hover:bg-[var(--color-bg-hover)]"
          >
            <span className="text-sm">{SHORTCUT_LABELS[action]}</span>
            <input
              className="w-40 rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-2 py-1.5 text-center font-mono text-xs"
              value={shortcuts[action] ?? DEFAULT_SHORTCUTS[action]}
              onChange={(event) => setShortcut(action, event.target.value)}
            />
          </label>
        ))}
      </div>
    </>
  );
}

function KnowledgeSettings() {
  const documents = useAppStore((state) => state.documents);
  const addDocument = useAppStore((state) => state.addDocument);
  const removeDocument = useAppStore((state) => state.removeDocument);
  const setConversationDocuments = useAppStore(
    (state) => state.setConversationDocuments,
  );
  const conversation = useSelectedConversation();

  function toggle(documentId: string) {
    if (!conversation) return;
    const next = conversation.documentIds.includes(documentId)
      ? conversation.documentIds.filter((id) => id !== documentId)
      : [...conversation.documentIds, documentId];
    void setConversationDocuments(conversation.id, next);
  }

  return (
    <>
      <SectionTitle
        title="本地知识库"
        description="支持 TXT、Markdown、JSON、CSV 与 PDF。关联后发送时自动检索相关片段。"
      />
      <button
        className="mb-5 flex items-center gap-2 rounded-lg bg-[var(--color-accent-bg)] px-4 py-2 font-semibold text-[#08100c]"
        onClick={() => void addDocument()}
      >
        <Plus size={15} />
        添加文档
      </button>
      <div className="space-y-2">
        {documents.map((document) => (
          <div
            key={document.id}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3"
          >
            <input
              type="checkbox"
              disabled={!conversation}
              checked={conversation?.documentIds.includes(document.id) ?? false}
              onChange={() => toggle(document.id)}
              title="关联到当前会话"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{document.name}</div>
              <div className="text-[11px] text-[var(--color-text-tertiary)]">
                {(document.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                {document.content.length.toLocaleString()} 字符
              </div>
            </div>
            <button
              className="rounded-lg p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
              onClick={() => void removeDocument(document.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function AboutSettings() {
  return (
    <>
      <SectionTitle
        title="关于 AIHub"
        description="Windows-first 的本地多 Provider 工作台。"
      />
      <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-5 text-sm leading-6 text-[var(--color-text-secondary)]">
        <p>版本：0.1.0</p>
        <p>
          所有消息通过 Provider 官方网站 UI 发送，不调用私有 API。会话、提示词和知识库数据保存在本机 SQLite。
        </p>
        <p>快捷键 Ctrl+/ 可随时查看操作帮助。</p>
      </div>
    </>
  );
}

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickTextFile(
  accept: string,
  onText: (text: string) => Promise<void>,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void file.text().then(onText);
  };
  input.click();
}
