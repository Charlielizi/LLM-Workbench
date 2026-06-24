import { useEffect, useMemo, useState } from "react";
import type {
  AppSnapshot,
  NormalizedConversation,
  ProviderId,
  TransferPreview,
} from "@aihub/core";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";

const emptySnapshot: AppSnapshot = {
  providers: [],
  conversations: [],
};

function providerLabel(provider: ProviderId): string {
  return PROVIDER_LABELS[provider];
}

function blockText(conversation: NormalizedConversation): string {
  return conversation.messages
    .at(-1)
    ?.content.map((block) => ("text" in block ? block.text : ""))
    .join(" ")
    .slice(0, 72) ?? "尚无消息";
}

export function App() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [selectedId, setSelectedId] = useState<string>();
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [transfer, setTransfer] = useState<TransferPreview>();

  useEffect(() => {
    void window.aihub.getSnapshot().then(setSnapshot);
    return window.aihub.onSnapshot(setSnapshot);
  }, []);

  const selected = useMemo(
    () =>
      snapshot.conversations.find(
        (conversation) => conversation.id === selectedId,
      ) ?? snapshot.conversations[0],
    [selectedId, snapshot.conversations],
  );

  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);

  async function createConversation(provider: ProviderId) {
    setError(undefined);
    try {
      const conversation = await window.aihub.createConversation(provider);
      setSelectedId(conversation.id);
    } catch (cause) {
      setError(errorText(cause));
      await window.aihub.setProviderWebsiteVisible(provider, true);
    }
  }

  async function send() {
    if (!selected || !composer.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const text = composer;
    setComposer("");
    try {
      await window.aihub.sendMessage({
        provider: selected.provider,
        conversationId: selected.id,
        text,
      });
    } catch (cause) {
      setComposer(text);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openTransferPreview() {
    if (!selected) return;
    try {
      setTransfer(await window.aihub.previewTransfer(selected.id));
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function confirmTransfer() {
    if (!transfer || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const target = await window.aihub.confirmTransfer({
        sourceConversationId: transfer.sourceConversationId,
        markdown: transfer.markdown,
      });
      setSelectedId(target.id);
      setTransfer(undefined);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>AIHub</strong>
          <span>本地多模型工作台</span>
        </div>
        <div className="provider-strip">
          {PROVIDER_IDS.map((id) => {
            const provider = snapshot.providers.find((item) => item.id === id);
            return (
              <div className="provider-status" key={id}>
                <i
                  className={
                    provider?.degraded
                      ? "danger"
                      : provider?.authenticated
                        ? "online"
                        : ""
                  }
                />
                <span>{providerLabel(id)}</span>
                <button
                  onClick={() =>
                    window.aihub.setProviderWebsiteVisible(
                      id,
                      !provider?.websiteVisible,
                    )
                  }
                >
                  {provider?.websiteVisible ? "返回工作台" : "登录 / 修复"}
                </button>
              </div>
            );
          })}
        </div>
      </header>

      <aside className="sidebar">
        <div className="new-actions">
          {PROVIDER_IDS.map((provider) => (
            <button
              key={provider}
              onClick={() => createConversation(provider)}
            >
              + {providerLabel(provider)}
            </button>
          ))}
        </div>
        <div className="conversation-list">
          {snapshot.conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={conversation.id === selected?.id ? "active" : ""}
              onClick={() => setSelectedId(conversation.id)}
            >
              <span>{conversation.title}</span>
              <small>{blockText(conversation)}</small>
            </button>
          ))}
          {!snapshot.conversations.length && (
            <p className="empty-copy">先登录一个模型，然后创建新对话。</p>
          )}
        </div>
      </aside>

      <main className="workspace">
        {selected ? (
          <>
            <div className="conversation-header">
              <div>
                <span className={`provider-pill ${selected.provider}`}>
                  {providerLabel(selected.provider)}
                </span>
                <h1>{selected.title}</h1>
              </div>
              {selected.provider === "chatgpt" && (
                <button className="transfer-button" onClick={openTransferPreview}>
                  迁移到 Claude
                </button>
              )}
            </div>
            <div className="messages">
              {selected.messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <header>
                    {message.role === "user"
                      ? "你"
                      : providerLabel(message.provider)}
                    {message.status === "pending" && <em>发送中</em>}
                    {message.status === "streaming" && <em>生成中</em>}
                    {message.status === "failed" && <em>已中断</em>}
                  </header>
                  {message.content.map((block, index) =>
                    block.type === "code" ? (
                      <pre key={index}>
                        <code>{block.text}</code>
                      </pre>
                    ) : block.type === "text" ? (
                      <p key={index}>{block.text}</p>
                    ) : null,
                  )}
                </article>
              ))}
            </div>
            <div className="composer">
              {error && <div className="error-banner">{error}</div>}
              <textarea
                value={composer}
                placeholder={`发送给 ${providerLabel(selected.provider)}…`}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <span>Enter 发送 · Shift+Enter 换行</span>
                <button disabled={busy || !composer.trim()} onClick={send}>
                  发送
                </button>
              </div>
            </div>
          </>
        ) : (
          <section className="welcome">
            <div className="orb">AI</div>
            <h1>一个界面，两个真实网站会话</h1>
            <p>
              登录 ChatGPT 与 Claude 后，消息在本机统一保存；切换模型时可预览并编辑迁移上下文。
            </p>
          </section>
        )}
      </main>

      {transfer && (
        <div className="modal-backdrop">
          <section className="modal">
            <header>
              <div>
                <span>发送到 Claude 前确认</span>
                <h2>迁移上下文预览</h2>
              </div>
              <button onClick={() => setTransfer(undefined)}>关闭</button>
            </header>
            <p className="privacy-note">
              将向 Claude 发送来自 ChatGPT 会话的 {transfer.messageCount}{" "}
              条消息摘要。请删除不希望跨平台发送的内容。
            </p>
            <textarea
              value={transfer.markdown}
              onChange={(event) =>
                setTransfer({ ...transfer, markdown: event.target.value })
              }
            />
            <footer>
              <button onClick={() => setTransfer(undefined)}>取消</button>
              <button className="primary" disabled={busy} onClick={confirmTransfer}>
                {busy ? "迁移中…" : "确认并迁移"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
