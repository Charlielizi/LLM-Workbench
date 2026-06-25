import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { NormalizedMessage } from "@aihub/core";
import { CodeBlock, MarkdownPre } from "./CodeBlock";
import { ProviderHtmlContent } from "./ProviderHtmlContent";

export function MessageContent({
  message,
}: {
  message: NormalizedMessage;
}) {
  if (
    message.role === "assistant" &&
    message.providerHtml
  ) {
    return (
      <div className="message-markdown text-[15px] leading-7">
        <ProviderHtmlContent html={message.providerHtml} />
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
                      className="text-[var(--color-accent)] underline decoration-transparent underline-offset-4 hover:decoration-current"
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
        return (
          <span
            key={index}
            className="inline-flex rounded-lg bg-[var(--color-bg-inset)] px-2 py-1 text-sm"
          >
            {block.name}
          </span>
        );
      })}
    </div>
  );
}
