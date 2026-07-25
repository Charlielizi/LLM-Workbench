import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import katex from "katex";
import type { NormalizedMessage } from "@aihub/core";
import { useI18n } from "../../i18n";
import { CodeBlock, MarkdownPre } from "./CodeBlock";
import { ProviderHtmlContent } from "./ProviderHtmlContent";

export function MessageContent({
  message,
}: {
  message: NormalizedMessage;
}) {
  const { t } = useI18n();
  const detail =
    message.statusPhase === "recoverable-blocked"
      ? t("message.status.openToSubmit")
      : message.failureOrigin === "auth" || message.errorCode === "auth_required"
        ? t("message.status.openToSignIn")
        : message.status === "failed" || message.status === "pending"
          ? message.statusDetail
          : undefined;
  const htmlBlock = message.content.find((block) => block.type === "html");
  const providerHtml = htmlBlock?.type === "html"
    ? htmlBlock.html
    : message.providerHtml;
  const imageBlocks = message.content.filter((block) => block.type === "image");

  if (
    message.role === "assistant" &&
    providerHtml
  ) {
    return (
      <div className="message-markdown text-[15px] leading-7">
        <ProviderHtmlContent html={providerHtml} suppressImages={imageBlocks.length > 0} />
        {imageBlocks.map((block, index) => (
          <img
            key={`${block.src}-${index}`}
            src={block.src}
            alt={block.alt ?? t("message.assistantImage")}
            title={block.title}
            loading="lazy"
            className="my-4 max-h-[32rem] max-w-full rounded-lg border border-[var(--color-border)] object-contain"
          />
        ))}
        {detail && (
          <p className="mt-3 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-soft)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
            {detail}
          </p>
        )}
        {message.status === "streaming" && (
          <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-[var(--color-accent)] align-middle" />
        )}
      </div>
    );
  }

  return (
    <div className="message-markdown text-[15px] leading-7">
      {message.content.map((block, index) => {
        if (block.type === "text") {
          return (
            <div key={index}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  pre: MarkdownPre,
                  a: ({ children, ...props }) => (
                    <a
                      {...props}
                      className="text-[var(--color-text-primary)] underline decoration-[var(--color-border-strong)] underline-offset-4"
                      onClick={(event) => {
                        event.preventDefault();
                        if (props.href) {
                          void window.aihub.openExternal(props.href);
                        }
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {block.text}
              </ReactMarkdown>
              {message.status === "streaming" &&
                index === message.content.length - 1 && (
                  <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-[var(--color-accent)] align-middle" />
                )}
            </div>
          );
        }
        if (block.type === "code") {
          return (
            <CodeBlock
              key={index}
              language={block.language}
              code={block.text}
            />
          );
        }
        if (block.type === "citation") {
          return (
            <a
              key={index}
              href={block.url}
              className="text-[var(--color-accent)] underline"
              onClick={(event) => {
                event.preventDefault();
                void window.aihub.openExternal(block.url);
              }}
            >
              {block.title ?? block.url}
            </a>
          );
        }
        if (block.type === "image") {
          return (
            <img
              key={index}
              src={block.src}
              alt={block.alt ?? t("message.assistantImage")}
              title={block.title}
              className="my-4 max-h-[32rem] rounded-2xl border border-[var(--color-border)]"
            />
          );
        }
        if (block.type === "math") {
          return (
            <div
              key={index}
              className="my-4 overflow-x-auto"
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(block.tex, {
                  displayMode: block.display,
                  throwOnError: false,
                  strict: "ignore",
                  trust: false,
                  output: "html",
                }),
              }}
            />
          );
        }
        if (block.type === "html") {
          return <ProviderHtmlContent key={index} html={block.html} />;
        }
        return (
          <span
            key={index}
            className="inline-flex rounded-lg bg-[var(--color-bg-inset)] px-2 py-1 text-sm"
          >
            {block.name}
          </span>
        );
      })}
      {detail && (
        <p className="mt-3 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-soft)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
          {detail}
        </p>
      )}
    </div>
  );
}
