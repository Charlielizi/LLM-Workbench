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
    title: "Explain a complex idea",
    prompt: "Explain this concept using intuition, analogies, and step-by-step examples:",
    icon: Sparkles,
  },
  {
    title: "Structure a research plan",
    prompt: "Turn the following problem into assumptions, evidence, and next experiments:",
    icon: Database,
  },
  {
    title: "Compare multiple models",
    prompt: "Compare the options across accuracy, actionability, and risk:",
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
        title: "Welcome to AIHub",
        description:
          "Use seven official provider websites from one local workspace. Conversations and knowledge stay on your machine.",
      },
      {
        icon: Globe2,
        title: "Sign in to a provider",
        description:
          "Open any provider site, complete login, then start a real conversation backed by the public website UI.",
      },
      {
        icon: Sparkles,
        title: "Build your workflow",
        description:
          "System prompts, local knowledge, cross-provider transfer, and side-by-side comparison are already available.",
      },
    ];
    const current = steps[step] ?? steps[0]!;
    const Icon = current.icon;
    return (
      <main className="grid h-full min-h-0 place-items-center overflow-y-auto px-8 py-14">
        <section className="w-full max-w-xl text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-md)]">
            <Icon size={34} />
          </div>
          <div className="mt-5 flex justify-center gap-2">
            {steps.map((_, index) => (
              <i
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === step
                    ? "w-9 bg-[var(--color-text-primary)]"
                    : "w-2 bg-[var(--color-border-strong)]"
                }`}
              />
            ))}
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">
            {current.title}
          </h1>
          <p className="mt-3 leading-7 text-[var(--color-text-secondary)]">
            {current.description}
          </p>
          <button
            className="interactive-chip mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--color-send-bg)] px-5 py-3 font-medium text-[var(--color-send-text)] shadow-[var(--shadow-sm)]"
            onClick={() => {
              if (step < steps.length - 1) setStep(step + 1);
              else setCompleted(true);
            }}
          >
            {step < steps.length - 1 ? "Next" : "Enter workspace"}
            <ArrowRight size={16} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto px-8 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center">
            <div className="grid size-16 place-items-center rounded-[1.75rem] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-md)]">
              <Bot size={28} />
            </div>
            <div className="-ml-3 mt-8 grid size-12 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)]">
              <Sparkles size={18} />
            </div>
            <div className="-ml-3 grid size-12 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)]">
              <Globe2 size={18} />
            </div>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">
            What do you want to work on today?
          </h1>
          <p className="mt-3 text-base text-[var(--color-text-secondary)]">
            Start with a prompt, or open a multi-provider comparison workspace.
          </p>
        </div>

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {SUGGESTIONS.map(({ title, prompt, icon: Icon }) => (
            <button
              key={title}
              className="interactive-chip rounded-[1.75rem] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 text-left shadow-[var(--shadow-sm)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)] hover:shadow-[var(--shadow-md)]"
              onClick={() => void startWithPrompt(prompt)}
            >
              <Icon size={18} className="text-[var(--color-text-secondary)]" />
              <div className="mt-4 text-sm font-semibold">{title}</div>
              <div className="mt-2 text-sm leading-6 text-[var(--color-text-tertiary)]">
                {prompt}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-center">
          <button
            className="interactive-chip rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={() => setComparisonSetupOpen(true)}
          >
            Create comparison workspace
          </button>
        </div>

        <section className="mx-auto mt-12 max-w-3xl">
          <div className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
            Provider status
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PROVIDER_IDS.map((provider) => {
              const state = providers.find((item) => item.id === provider);
              return (
                <button
                  key={provider}
                  className="interactive-chip flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 text-left hover:bg-[var(--color-bg-hover)]"
                  onClick={() =>
                    void window.aihub.setProviderWebsiteVisible(provider, true)
                  }
                >
                  <CheckCircle2
                    size={15}
                    className={
                      state?.authenticated
                        ? "text-[var(--color-online)]"
                        : "text-[var(--color-offline)]"
                    }
                  />
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    {PROVIDER_LABELS[provider]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
