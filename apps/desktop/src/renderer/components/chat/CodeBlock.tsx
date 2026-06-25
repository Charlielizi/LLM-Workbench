import { isValidElement } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CodeBlock({
  code,
  language,
  highlighted,
}: {
  code: string;
  language?: string;
  highlighted?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-inset)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">
        <span>{language || "text"}</span>
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() => void copy()}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto p-4 font-mono text-[13px] leading-6">
        {highlighted ?? <code>{code}</code>}
      </pre>
    </div>
  );
}

export function MarkdownPre({
  children,
}: ComponentPropsWithoutRef<"pre">) {
  if (!isValidElement(children)) {
    return <pre>{children}</pre>;
  }

  const props = children.props as {
    className?: string;
    children?: ReactNode;
  };
  const language =
    props.className?.match(/language-([\w-]+)/)?.[1] ??
    props.className?.match(/lang-([\w-]+)/)?.[1];
  return (
    <CodeBlock
      code={plainText(props.children).replace(/\n$/, "")}
      language={language}
      highlighted={children}
    />
  );
}

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement(node)) {
    return plainText(
      (node.props as { children?: ReactNode }).children,
    );
  }
  return "";
}
