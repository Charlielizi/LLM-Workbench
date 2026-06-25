import { useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  Globe2,
  Sparkles,
} from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useComposerStore } from "../../stores/composer-store";
import { useSettingsStore } from "../../stores/settings-store";

const SUGGESTIONS = [
  {
    title: "解释一个复杂概念",
    prompt: "请用直观类比和分步骤示例解释这个概念：",
    icon: Sparkles,
  },
  {
    title: "整理研究思路",
    prompt: "请帮我把下面的研究问题整理成假设、证据与下一步实验：",
    icon: Database,
  },
  {
    title: "比较多个模型",
    prompt: "请从准确性、可执行性和风险三个维度分析：",
    icon: Globe2,
  },
];

export function WelcomeView() {
  const [step, setStep] = useState(0);
  const providers = useAppStore((state) => state.snapshot.providers);
  const createConversation = useAppStore(
    (state) => state.createConversation,
  );
  const setComparisonSetupOpen = useAppStore(
    (state) => state.setComparisonSetupOpen,
  );
  const completed = useSettingsStore(
    (state) => state.hasCompletedOnboarding,
  );
  const setCompleted = useSettingsStore(
    (state) => state.setHasCompletedOnboarding,
  );
  const defaultProvider =
    useSettingsStore((state) => state.defaultProvider) ?? "chatgpt";

  async function startWithPrompt(prompt: string) {
    await createConversation(defaultProvider);
    const conversationId = useAppStore.getState().selectedConversationId;
    if (conversationId) {
      useComposerStore.getState().setDraft(conversationId, prompt);
    }
  }

  if (!completed) {
    const steps = [
      {
        icon: Bot,
        title: "欢迎使用 AIHub",
        description:
          "在一个本地工作台中使用七个 Provider 官方网站，会话与知识数据留在你的电脑上。",
      },
      {
        icon: Globe2,
        title: "先登录 Provider",
        description:
          "点击顶部任一 Provider 的“登录 / 修复”，完成网页登录后即可创建真实会话。",
      },
      {
        icon: Sparkles,
        title: "开始你的工作流",
        description:
          "使用系统提示词、本地知识库、跨模型迁移和多模型并行对比。",
      },
    ];
    const current = steps[step] ?? steps[0]!;
    const Icon = current.icon;
    return (
      <main className="grid h-full min-h-0 place-items-center overflow-y-auto p-8">
        <section className="w-full max-w-xl text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-3xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] text-[var(--color-accent)] shadow-[0_0_60px_var(--color-accent-glow)]">
            <Icon size={34} />
          </div>
          <div className="mt-5 flex justify-center gap-2">
            {steps.map((_, index) => (
              <i
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === step
                    ? "w-8 bg-[var(--color-accent)]"
                    : "w-2 bg-[var(--color-border-strong)]"
                }`}
              />
            ))}
          </div>
          <h1 className="mt-6 text-2xl font-semibold">{current.title}</h1>
          <p className="mt-3 leading-7 text-[var(--color-text-secondary)]">
            {current.description}
          </p>
          <button
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[var(--color-accent-bg)] px-5 py-3 font-semibold text-[#08100c]"
            onClick={() => {
              if (step < steps.length - 1) setStep(step + 1);
              else setCompleted(true);
            }}
          >
            {step < steps.length - 1 ? "下一步" : "进入工作台"}
            <ArrowRight size={16} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--color-accent-glow)] text-[var(--color-accent)]">
            <Bot size={28} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold">今天想完成什么？</h1>
          <p className="mt-2 text-[var(--color-text-secondary)]">
            选择一个快速开始，或创建多模型并行对比。
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3">
          {SUGGESTIONS.map(({ title, prompt, icon: Icon }) => (
            <button
              key={title}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-hover)]"
              onClick={() => void startWithPrompt(prompt)}
            >
              <Icon size={19} className="text-[var(--color-accent)]" />
              <div className="mt-3 text-sm font-semibold">{title}</div>
              <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                {prompt}
              </div>
            </button>
          ))}
        </div>
        <button
          className="mt-3 w-full rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
          onClick={() => setComparisonSetupOpen(true)}
        >
          创建多模型并行对比
        </button>
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Provider 状态</h2>
          <div className="grid grid-cols-4 gap-2">
            {PROVIDER_IDS.map((provider) => {
              const state = providers.find((item) => item.id === provider);
              return (
                <button
                  key={provider}
                  className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-left text-xs hover:bg-[var(--color-bg-hover)]"
                  onClick={() =>
                    void window.aihub.setProviderWebsiteVisible(provider, true)
                  }
                >
                  <CheckCircle2
                    size={14}
                    className={
                      state?.authenticated
                        ? "text-[var(--color-online)]"
                        : "text-[var(--color-offline)]"
                    }
                  />
                  <span>{PROVIDER_LABELS[provider]}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
