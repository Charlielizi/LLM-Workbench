import { useMemo } from "react";
import "katex/dist/katex.min.css";
import { renderProviderHtml } from "../../utils/provider-html";

export function ProviderHtmlContent({
  html,
  suppressImages = false,
}: {
  html: string;
  suppressImages?: boolean;
}) {
  const sanitizedHtml = useMemo(
    () => renderProviderHtml(html, suppressImages),
    [html, suppressImages],
  );

  return (
    <div
      className="provider-html"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const link = target.closest("a");
        const href = link?.getAttribute("href");
        if (!href) return;
        event.preventDefault();
        void window.aihub.openExternal(href);
      }}
    />
  );
}
