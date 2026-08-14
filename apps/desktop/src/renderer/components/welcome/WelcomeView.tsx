import { useState } from "react";
import {
  ArrowRight,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Globe2,
  LogIn,
  Sparkles,
} from "lucide-react";
import { PROVIDER_LABELS } from "@aihub/core";
import { useI18n, type TranslationKey } from "../../i18n";
import { useAppStore } from "../../stores/app-store";
import { useComposerStore } from "../../stores/composer-store";
import { useSettingsStore } from "../../stores/settings-store";

const SUGGESTIONS: Array<{
  title: TranslationKey;
  prompt: TranslationKey;
  icon: typeof Sparkles;
}> = [
  {
    title: "welcome.suggestion1Title",
    prompt: "welcome.suggestion1Prompt",
    icon: Sparkles,
  },
  {
    title: "welcome.suggestion2Title",
    prompt: "welcome.suggestion2Prompt",
    icon: Database,
  },
  {
    title: "welcome.suggestion3Title",
    prompt: "welcome.suggestion3Prompt",
    icon: Globe2,
  },
];

export function WelcomeView() {
  const { t } = useI18n();
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
  const providerOrder = useSettingsStore((state) => state.providerOrder);
  const enabledProviders = useSettingsStore((state) => state.enabledProviders);

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
        title: t("welcome.step1Title"),
        description: t("welcome.step1Description"),
      },
      {
        icon: Globe2,
        title: t("welcome.step2Title"),
        description: t("welcome.step2Description"),
      },
      {
        icon: Sparkles,
        title: t("welcome.step3Title"),
        description: t("welcome.step3Description"),
      },
    ];
    const current = steps[step] ?? steps[0]!;
    const Icon = current.icon;
    return (
      <main
        data-testid="welcome-onboarding"
        className="grid h-full min-h-0 place-items-center overflow-y-auto px-8 py-14"
      >
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
              if (step < steps.length - 1) setStep((currentStep) => currentStep + 1);
              else setCompleted(true);
            }}
          >
            {step < steps.length - 1
              ? t("welcome.next")
              : t("welcome.enter")}
            <ArrowRight size={16} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main
      data-testid="welcome-workspace"
      className="h-full min-h-0 overflow-y-auto px-8 py-12"
    >
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
            {t("welcome.headline")}
          </h1>
          <p className="mt-3 text-base text-[var(--color-text-secondary)]">
            {t("welcome.subhead")}
          </p>
        </div>

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {SUGGESTIONS.map(({ title, prompt, icon: Icon }) => (
            <button
              key={title}
              className="interactive-chip rounded-[1.75rem] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 text-left shadow-[var(--shadow-sm)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)] hover:shadow-[var(--shadow-md)]"
              onClick={() => void startWithPrompt(t(prompt))}
            >
              <Icon size={18} className="text-[var(--color-text-secondary)]" />
              <div className="mt-4 text-sm font-semibold">{t(title)}</div>
              <div className="mt-2 text-sm leading-6 text-[var(--color-text-tertiary)]">
                {t(prompt)}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-center">
          <button
            className="interactive-chip rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={() => setComparisonSetupOpen(true)}
          >
            {t("welcome.createComparison")}
          </button>
        </div>

        <section className="mx-auto mt-12 max-w-3xl">
          <div className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
            {t("welcome.providerStatus")}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {providerOrder
              .filter((provider) => enabledProviders.includes(provider))
              .map((provider) => {
              const state = providers.find((item) => item.id === provider);
              const ready = Boolean(state?.authenticated && state.ready);
              const degraded = Boolean(state?.degraded);
              const StatusIcon = degraded
                ? AlertTriangle
                : ready
                  ? CheckCircle2
                  : LogIn;
              const status = degraded
                ? t("provider.status.degraded")
                : ready
                  ? t("provider.status.online")
                  : t("provider.status.login");
              const action = degraded
                ? t("provider.action.openRecovery")
                : ready
                  ? t("provider.action.startChat")
                  : t("provider.action.openLogin");
              return (
                <button
                  key={provider}
                  className="interactive-chip grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 text-left hover:bg-[var(--color-bg-hover)]"
                  onClick={() => {
                    if (ready) {
                      void createConversation(provider);
                    } else {
                      void window.aihub.setProviderWebsiteVisible(provider, true);
                    }
                  }}
                >
                  <StatusIcon
                    size={15}
                    className={
                      degraded
                        ? "text-[var(--color-danger)]"
                        : ready
                          ? "text-[var(--color-online)]"
                          : "text-[var(--color-offline)]"
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--color-text-secondary)]">
                      {PROVIDER_LABELS[provider]}
                    </span>
                    <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                      {status}
                    </span>
                  </span>
                  <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
                    {action}
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
