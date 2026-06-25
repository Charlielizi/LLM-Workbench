using System.Text.Json;

namespace AIHub.Windows;

public static class ProviderBridgeScript
{
    public static string Build(ProviderDefinition definition)
    {
        var config = JsonSerializer.Serialize(new
        {
            providerId = definition.Id.ToString(),
            strictAssistant = definition.Id is ProviderId.Kimi or ProviderId.Hunyuan,
            composerSelectors = definition.ComposerSelectors,
            submitSelectors = definition.SubmitSelectors,
            stopSelectors = definition.StopSelectors,
            assistantSelectors = definition.AssistantSelectors,
            loginMarkers = definition.LoginMarkers,
            authBlockerSelectors = definition.AuthBlockerSelectors,
            documentSelectors = definition.ConversationDocumentSelectors,
            submitWithEnter = definition.SubmitWithEnter,
            fileInputSelectors = definition.FileInputSelectors,
            attachmentControlSelectors = definition.AttachmentControlSelectors,
            modelControlSelectors = definition.ModelControlSelectors,
            modeDefinitions = definition.ModeDefinitions.Select(mode => new
            {
                mode = (int)mode.Mode,
                mode.Label,
                matchLabels = mode.MatchLabels,
                openerLabels = mode.OpenerLabels ?? [],
                disabledLabels = mode.DisabledLabels ?? [],
            }),
        });

        return $$"""
        (() => {
          if (window.__aihubInstalled) return;
          window.__aihubInstalled = true;
          const config = {{config}};
          let activeId = null;
          let activePrompt = "";
          let latestText = "";
          let assistantBaseline = "";
          let assistantHtmlBaseline = "";
          let assistantHtml = "";
          let documentBaseline = "";
          let lastChange = 0;
          let startedAt = 0;
          let completionTimer = null;
          let capabilitySignature = "";
          const pendingUiActions = new Map();

          const post = payload => window.chrome.webview.postMessage(payload);
          const visible = element => {
            if (!element) return false;
            if (element.disabled || element.getAttribute("aria-disabled") === "true")
              return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" &&
              rect.width > 2 && rect.height > 2;
          };
          const rendered = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" &&
              rect.width > 2 && rect.height > 2;
          };
          const roots = () => {
            const result = [document];
            const visit = root => root.querySelectorAll("*").forEach(node => {
              if (!node.shadowRoot) return;
              result.push(node.shadowRoot);
              visit(node.shadowRoot);
            });
            visit(document);
            return result;
          };
          const first = selectors => {
            for (const root of roots()) {
              for (const selector of selectors || []) {
                const element = [...root.querySelectorAll(selector)].find(visible);
                if (element) return element;
              }
            }
            return null;
          };
          const firstRendered = selectors => {
            for (const root of roots()) {
              for (const selector of selectors || []) {
                const element = [...root.querySelectorAll(selector)].find(rendered);
                if (element) return element;
              }
            }
            return null;
          };
          const firstExisting = selectors => {
            for (const root of roots()) {
              for (const selector of selectors || []) {
                const element = root.querySelector(selector);
                if (element) return element;
              }
            }
            return null;
          };
          const allLast = selectors => {
            for (const selector of selectors || []) {
              const matches = [];
              for (const root of roots())
                matches.push(...[...root.querySelectorAll(selector)].filter(visible));
              if (matches.length) return matches.at(-1);
            }
            return null;
          };
          const textOf = (element, markdown) => {
            if (!element) return "";
            if (markdown) return htmlToMd(element);
            return (element.innerText || element.textContent || "")
              .replace(/\r/g, "")
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
          };
          const htmlToMd = root => {
            const SKIP = new Set(["SCRIPT","STYLE","BUTTON","SVG","NAV","FOOTER",
              "HEADER","IFRAME","NOSCRIPT"]);
            const isMathChild = node => {
              let el = node?.parentElement;
              while (el) {
                if (el.classList?.contains("katex") ||
                    el.tagName?.toUpperCase() === "MJX-CONTAINER") return true;
                el = el.parentElement;
              }
              return false;
            };
            const walk = node => {
              if (node.nodeType === 3) {
                if (isMathChild(node)) return [];
                return [node.textContent];
              }
              if (node.nodeType !== 1) return [];
              const tag = node.tagName.toUpperCase();
              if (SKIP.has(tag) || isMathChild(node)) return [];
              if (tag === "PRE") {
                const code = node.querySelector("code");
                const lang = (code?.className?.match(/language-(\w+)/)?.[1]) ||
                  (code?.className?.match(/lang-(\w+)/)?.[1]) || "";
                const raw = (code || node).textContent || "";
                return ["\n```" + lang + "\n" + raw.trimEnd() + "\n```\n"];
              }
              if (tag === "CODE") return ["`" + (node.textContent || "") + "`"];
              // KaTeX: <span class="katex"><annotation encoding="application/x-tex">
              if (node.classList?.contains("katex")) {
                const ann = node.querySelector("annotation[encoding*='tex']");
                const latex = ann?.textContent?.trim();
                if (latex) {
                  const isBlock = node.closest?.(".katex-display") ||
                    getComputedStyle(node).display === "block";
                  return isBlock ? ["\n$$" + latex + "$$\n"] : ["$" + latex + "$"];
                }
              }
              // MathJax v3: <mjx-container>
              if (tag === "MJX-CONTAINER") {
                const ann = node.querySelector("annotation[encoding*='tex']");
                const latex = ann?.textContent?.trim();
                if (latex) {
                  const isBlock = node.getAttribute("display") === "true" ||
                    getComputedStyle(node).display === "block";
                  return isBlock ? ["\n$$" + latex + "$$\n"] : ["$" + latex + "$"];
                }
              }
              if (tag === "IMG") {
                const src = node.getAttribute("src") || "";
                if (!src || src.startsWith("data:image/svg") || /icon|logo|avatar/i.test(src))
                  return [];
                return [" ![" + (node.getAttribute("alt") || "") + "](" + src + ") "];
              }
              if (tag === "BR") return ["\n"];
              if (tag === "HR") return ["\n---\n"];
              if (/^H[1-6]$/.test(tag)) {
                const level = parseInt(tag[1]);
                return ["\n" + "#".repeat(level) + " " + walkChildren(node).join("").trim() + "\n"];
              }
              if (tag === "STRONG" || tag === "B") {
                const inner = walkChildren(node, []).join("").trim();
                return inner ? ["**" + inner + "**"] : [];
              }
              if (tag === "EM" || tag === "I") {
                const inner = walkChildren(node, []).join("").trim();
                return inner ? ["*" + inner + "*"] : [];
              }
              if (tag === "A") {
                const href = node.getAttribute("href") || "";
                const inner = walkChildren(node, []).join("").trim();
                return href && inner ? ["[" + inner + "](" + href + ")"] : [inner];
              }
              if (tag === "BLOCKQUOTE")
                return ["\n> " + walkChildren(node, []).join("").split("\n").join("\n> ") + "\n"];
              if (tag === "UL" || tag === "OL") {
                const out = [];
                let idx = 1;
                for (const li of node.children) {
                  if (li.tagName?.toUpperCase() !== "LI") continue;
                  const bullet = tag === "OL" ? (idx++ + ". ") : "- ";
                  out.push(bullet + walkChildren(li, []).join("").trim() + "\n");
                }
                return ["\n" + out.join("")];
              }
              if (tag === "TABLE") {
                const rows = [];
                for (const tr of node.querySelectorAll("tr"))
                  rows.push([...tr.children].map(c => walkChildren(c, []).join("").trim()));
                if (!rows.length) return [];
                const md = rows.map(r => "| " + r.join(" | ") + " |").join("\n");
                const sep = "| " + rows[0].map(() => "---").join(" | ") + " |";
                return ["\n" + md.split("\n")[0] + "\n" + sep + "\n" +
                  md.split("\n").slice(1).join("\n") + "\n"];
              }
              const display = getComputedStyle(node).display;
              const parts = walkChildren(node);
              if (display === "block" || display === "flex" || display === "grid" ||
                  display === "list-item" || /^DIV|P|SECTION|ARTICLE|LI|DD|DT$/.test(tag))
                return ["\n", ...parts, "\n"];
              return parts;
            };
            const walkChildren = node => {
              const parts = [];
              for (const child of node.childNodes) parts.push(...walk(child));
              return parts;
            };
            return walkChildren(root)
              .join("")
              .replace(/\n{3,}/g, "\n\n")
              .replace(/[ \t]+\n/g, "\n")
              .trim();
          };
          const conversationRoot = () => first([
            ...config.documentSelectors,
            "[role='main']",
            "main",
            "#app",
            "body"
          ]);
          const documentText = () => {
            const root = conversationRoot();
            if (!root) return "";
            const clone = root.cloneNode(true);
            clone.querySelectorAll(
              "textarea,input,button,svg,[role=button],[aria-hidden=true]," +
              "[class*=suggest],[class*=recommend],[class*=sidebar],[class*=header]"
            ).forEach(node => node.remove());
            return textOf(clone);
          };
          const cleanFallback = text => {
            const lines = text.split("\n");
            const out = [];
            let inBlock = false;
            for (const line of lines) {
              const trimmed = line.trim();
              if (/^\$\$/.test(trimmed)) { inBlock = !inBlock; out.push(line); continue; }
              if (inBlock) { out.push(line); continue; }
              if (!trimmed || trimmed === activePrompt) continue;
              if (/^(澶嶅埗|閲嶈瘯|缂栬緫|鍒嗕韩|涓嬭浇|鍋滄|鍙戦€亅Copy|Retry|Edit|Share)$/.test(trimmed)) continue;
              out.push(line);
            }
            return out.join("\n").trim();
          };
          const boilerplate = [
            /^\u4e0b\u8f7d$/,
            /^\u5185\u5bb9\u7531\s*AI\s*\u751f\u6210[锛?]?\s*\u4ec5\u4f9b\u53c2\u8003[銆?]?$/i,
            /^AI\s*\u751f\u6210\u5185\u5bb9\u4ec5\u4f9b\u53c2\u8003[銆?]?$/i,
            /^AI\s*\u751f\u6210\u53ef\u80fd\u6709\u8bef[锛?]?\s*\u8bf7\u6838\u5b9e[銆?]?$/i,
            /^(\u590d\u5236|\u91cd\u8bd5|\u7f16\u8f91|\u5206\u4eab|\u505c\u6b62|\u53d1\u9001)$/,
            /^(Copy|Retry|Edit|Share|Download|Stop|Send)$/i
          ];
          const cleanResponse = text => {
            const cleaned = cleanFallback(text);
            const lines = cleaned.split("\n");
            const out = [];
            let inBlock = false;
            for (const line of lines) {
              const trimmed = line.trim();
              if (/^```/.test(trimmed) || /^\$\$/.test(trimmed))
                { inBlock = !inBlock; out.push(line); continue; }
              if (inBlock) { out.push(line); continue; }
              if (!trimmed) continue;
              if (boilerplate.some(pattern => pattern.test(trimmed))) continue;
              out.push(line);
            }
            return out.join("\n")
              .replace(/涓嬭浇\s*鍐呭鐢盶s*AI\s*鐢熸垚[锛?]?\s*浠呬緵鍙傝€僛銆?]?/gi, "")
              .trim();
          };
          const promptElement = () => {
            if (!activePrompt) return null;
            const matches = [];
            for (const root of roots()) {
              for (const element of root.querySelectorAll("p,div,span,article")) {
                const text = textOf(element);
                if (visible(element) && text && text.includes(activePrompt))
                  matches.push(element);
              }
            }
            return matches.sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
          };
          const candidateScore = text => {
            if (!text || text === activePrompt || text.length < 8) return -1;
            const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
            const paragraphs = (text.match(/\n/g) || []).length;
            return text.length + cjk * 2 + paragraphs * 12;
          };
          const semanticResponseText = () => {
            const prompt = promptElement();
            const candidates = [];
            const selectors = [
              ...config.assistantSelectors,
              "[data-role='assistant']",
              "[data-testid*='assistant']",
              "[class*='assistant']",
              "[class*='answer']",
              "[class*='agent-message']",
              "[class*='message-content']",
              "[class*='markdown']",
              "article"
            ];
            for (const root of roots()) {
              for (const selector of selectors) {
                for (const element of root.querySelectorAll(selector)) {
                  if (!visible(element) || element === prompt ||
                      (prompt && element.contains(prompt))) continue;
                  if (prompt && prompt.getRootNode() === element.getRootNode() &&
                      !(prompt.compareDocumentPosition(element) &
                        Node.DOCUMENT_POSITION_FOLLOWING)) continue;
                  const text = cleanResponse(htmlToMd(element));
                  const score = candidateScore(text);
                  if (score > 0) candidates.push({ text, score });
                }
              }
            }
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0]?.text || "";
          };
          const textAfterPrompt = current => {
            if (!activePrompt) return "";
            const index = current.lastIndexOf(activePrompt);
            if (index < 0) return "";
            return cleanResponse(current.slice(index + activePrompt.length));
          };
          const changedSuffix = (before, after) => {
            let index = 0;
            const limit = Math.min(before.length, after.length);
            while (index < limit && before.charCodeAt(index) === after.charCodeAt(index)) index++;
            return cleanResponse(after.slice(index));
          };
          const assistantText = () => {
            const direct = textOf(allLast(config.assistantSelectors), true);
            const cleanedDirect = cleanResponse(direct);
            if (cleanedDirect && cleanedDirect !== assistantBaseline &&
                cleanedDirect !== activePrompt && candidateScore(cleanedDirect) > 0)
              return cleanedDirect;
            if (config.strictAssistant) return "";
            const semantic = semanticResponseText();
            if (semantic) return semantic;
            const current = documentText();
            const afterPrompt = textAfterPrompt(current);
            if (candidateScore(afterPrompt) > 0) return afterPrompt;
            const changed = documentBaseline ? changedSuffix(documentBaseline, current) : "";
            return candidateScore(changed) > 0 ? changed : "";
          };
          const assistantHtmlContent = () => {
            const el = allLast(config.assistantSelectors);
            if (!el) return "";
            const clone = el.cloneNode(true);
            const removable =
              "button,nav,footer,header,script,style,iframe,form,input,textarea," +
              "select,[role=button],[contenteditable=true]";
            const styleProperties = [
              "display", "font-family", "font-size", "font-weight", "font-style",
              "line-height", "letter-spacing", "color", "text-align",
              "text-decoration-line", "text-decoration-color", "white-space",
              "margin-top", "margin-right", "margin-bottom", "margin-left",
              "padding-top", "padding-right", "padding-bottom", "padding-left",
              "list-style-type", "list-style-position", "background-color",
              "border-top-width", "border-right-width", "border-bottom-width",
              "border-left-width", "border-top-style", "border-right-style",
              "border-bottom-style", "border-left-style", "border-top-color",
              "border-right-color", "border-bottom-color", "border-left-color",
              "border-radius", "max-width", "overflow-wrap"
            ];
            const copyNode = (source, target) => {
              if (!(source instanceof Element) || !(target instanceof Element)) return;
              if (source.matches(removable)) {
                target.remove();
                return;
              }
              for (const attribute of [...target.attributes]) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith("on") || name === "srcdoc")
                  target.removeAttribute(attribute.name);
              }
              for (const name of ["src", "href", "poster"]) {
                const value = target.getAttribute(name);
                if (!value) continue;
                try { target.setAttribute(name, new URL(value, location.href).href); }
                catch { target.removeAttribute(name); }
              }
              const insideMath = source.closest(
                "mjx-container,.katex,.katex-display,mjx-assistive-mml,math");
              if (!insideMath) {
                const computed = getComputedStyle(source);
                const style = styleProperties
                  .map(name => [name, computed.getPropertyValue(name)])
                  .filter(([, value]) => value && value !== "normal" && value !== "none")
                  .map(([name, value]) => name + ":" + value)
                  .join(";");
                if (style) target.setAttribute("style", style);
              } else {
                const computed = getComputedStyle(source);
                const style = [...computed]
                  .map(name => [name, computed.getPropertyValue(name)])
                  .filter(([, value]) => value)
                  .map(([name, value]) => name + ":" + value)
                  .join(";");
                target.setAttribute("style", style);
              }
              const sourceChildren = [...source.children];
              const targetChildren = [...target.children];
              for (let index = targetChildren.length - 1; index >= 0; index--)
                copyNode(sourceChildren[index], targetChildren[index]);
            };
            copyNode(el, clone);
            for (const container of [...clone.querySelectorAll("mjx-container")]) {
              const annotation = container.querySelector(
                "annotation[encoding*='tex']");
              const tex = annotation?.textContent?.trim();
              if (!tex) continue;
              const replacement = document.createElement(
                container.getAttribute("display") === "true" ? "div" : "span");
              replacement.className = "aihub-math";
              replacement.dataset.tex = tex;
              replacement.dataset.display =
                container.getAttribute("display") === "true" ? "true" : "false";
              container.replaceWith(replacement);
            }
            for (const container of [...clone.querySelectorAll(".katex")]) {
              const annotation = container.querySelector(
                "annotation[encoding*='tex']");
              const tex = annotation?.textContent?.trim();
              if (!tex) {
                container.classList.add("aihub-provider-math");
                continue;
              }
              const display = container.closest(".katex-display");
              const replacement = document.createElement(display ? "div" : "span");
              replacement.className = "aihub-math";
              replacement.dataset.tex = tex;
              replacement.dataset.display = display ? "true" : "false";
              if (display) display.replaceWith(replacement);
              else container.replaceWith(replacement);
            }
            const cleaned = clone.innerHTML || "";
            if (!cleaned || cleaned === assistantHtmlBaseline) return "";
            return cleaned;
          };
          const composer = () => first([
            ...config.composerSelectors,
            "textarea:not([disabled])",
            "[contenteditable='true'][role='textbox']",
            "div[contenteditable='true']"
          ]);
          const waitForComposer = async () => {
            for (let attempt = 0; attempt < 80; attempt++) {
              const input = composer();
              if (input) return input;
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            return null;
          };
          const nearbySubmit = input => {
            const source = input.getBoundingClientRect();
            const controls = [];
            for (const root of roots()) {
              controls.push(...[
                ...root.querySelectorAll("button:not([disabled]),[role='button']")
              ].filter(visible));
            }
            return controls
              .map(element => {
                const rect = element.getBoundingClientRect();
                const dx = Math.abs(rect.right - source.right);
                const dy = Math.abs(rect.bottom - source.bottom);
                const distance = dx + dy * 1.5;
                const label = (
                  element.getAttribute("aria-label") ||
                  element.getAttribute("title") ||
                  element.innerText || ""
                ).trim();
                return { element, distance, label };
              })
              .filter(item => item.distance < 260)
              .filter(item => !/闄勪欢|涓婁紶|鍥剧墖|璇煶|妯″紡|鎬濊€億鎼滅储|attach|upload/i.test(item.label))
              .sort((a, b) => a.distance - b.distance)[0]?.element || null;
          };
          const waitForSubmit = async (input, timeoutMs) => {
            const deadline = performance.now() + timeoutMs;
            do {
              const submit = first([
                ...config.submitSelectors,
                "button[type='submit']:not([disabled])",
                "button[aria-label*='Send']:not([disabled])",
                "button[aria-label*='\u53d1\u9001']:not([disabled])"
              ]) || (config.providerId === "DeepSeek" ? nearbySubmit(input) : null);
              if (submit) return submit;
              await new Promise(resolve => setTimeout(resolve, 50));
            } while (performance.now() < deadline);
            return null;
          };
          const inputText = element =>
            element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
              ? element.value.trim()
              : textOf(element);
          const messageVisible = text => {
            if (!text) return false;
            for (const root of roots()) {
              for (const element of root.querySelectorAll(
                "[data-message-author-role='user'],[data-role='user']," +
                "[class*='message-user'],[class*='chat-content-item-user']," +
                "[class*='list__item--user']"
              )) {
                if (visible(element) && textOf(element).includes(text)) return true;
              }
            }
            return false;
          };
          const sentSuccessfully = input =>
            !inputText(input) || messageVisible(activePrompt);
          const controlLabel = element => (
            element?.getAttribute?.("aria-label") ||
            element?.getAttribute?.("title") ||
            element?.innerText ||
            element?.textContent ||
            ""
          ).replace(/\s+/g, " ").trim();
          const domDistance = (source, target) => {
            if (!source || !target) return Number.MAX_SAFE_INTEGER;
            const ancestors = new Map();
            let current = source;
            let depth = 0;
            while (current && depth < 20) {
              ancestors.set(current, depth++);
              current = current.parentElement;
            }
            current = target;
            depth = 0;
            while (current && depth < 20) {
              if (ancestors.has(current)) return depth + ancestors.get(current);
              current = current.parentElement;
              depth++;
            }
            return Number.MAX_SAFE_INTEGER;
          };
          const composerDistance = element => {
            const input = composer();
            if (!input || !element) return Number.MAX_SAFE_INTEGER;
            const source = input.getBoundingClientRect();
            const target = element.getBoundingClientRect();
            const visual = Math.abs(target.left - source.left) +
              Math.abs(target.top - source.top);
            return Math.min(visual, domDistance(input, element) * 80);
          };
          const controlMatching = (labels, maxDistance = 650, excluded = null) => {
            const normalizedLabels = (labels || [])
              .map(value => value.toLocaleLowerCase());
            if (!normalizedLabels.length) return null;
            for (const root of roots()) {
              for (const element of root.querySelectorAll(
                "button,[role=button],[role=checkbox],[role=switch]," +
                "[role=menuitem],[aria-pressed],[data-state]," +
                "[class*=mode],[class*=tool],[class*=menu]"
              )) {
                if (element === excluded) continue;
                if (!rendered(element)) continue;
                const label = controlLabel(element).toLocaleLowerCase();
                if (!label || !normalizedLabels.some(value =>
                    label === value || label.includes(value))) continue;
                if (composerDistance(element) <= maxDistance) return element;
              }
            }
            return null;
          };
          const modeControl = definition =>
            controlMatching(definition.matchLabels);
          const modeOpener = definition =>
            controlMatching(definition.openerLabels, 850);
          const controlEnabled = element =>
            element?.getAttribute("aria-pressed") === "true" ||
            element?.getAttribute("aria-checked") === "true" ||
            element?.getAttribute("data-state") === "on" ||
            element?.getAttribute("data-state") === "checked" ||
            /(^|\s)(active|selected|checked|enabled)(\s|$)/i.test(
              element?.className?.toString?.() || "");
          const modeState = definition => {
            const opener = modeOpener(definition);
            const openerLabel = controlLabel(opener).toLocaleLowerCase();
            const enabledLabels = (definition.matchLabels || [])
              .map(value => value.toLocaleLowerCase());
            const disabledLabels = (definition.disabledLabels || [])
              .map(value => value.toLocaleLowerCase());
            if (openerLabel && enabledLabels.some(value =>
                openerLabel === value || openerLabel.includes(value)))
              return true;
            if (openerLabel && disabledLabels.some(value =>
                openerLabel === value || openerLabel.includes(value)))
              return false;
            const control = modeControl(definition);
            return control ? controlEnabled(control) : false;
          };
          const trustedClick = element => {
            const rect = element.getBoundingClientRect();
            const actionId = crypto.randomUUID();
            return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                pendingUiActions.delete(actionId);
                reject(new Error("Trusted website click timed out."));
              }, 5000);
              pendingUiActions.set(actionId, { resolve, reject, timeout });
              post({
                type: "ui.click.required",
                actionId,
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              });
            });
          };
          const revealModeControl = async (definition, desired) => {
            const labels = desired
              ? definition.matchLabels
              : definition.disabledLabels;
            const opener = modeOpener(definition);
            let control = controlMatching(labels, 950, opener);
            if (control) return control;
            if (!opener) return null;
            await trustedClick(opener);
            const deadline = performance.now() + 1500;
            while (performance.now() < deadline) {
              control = controlMatching(labels, 950, opener);
              if (control) return control;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            return null;
          };
          const modelControl = () => {
            const candidates = [];
            for (const root of roots()) {
              for (const selector of config.modelControlSelectors || [])
                candidates.push(...root.querySelectorAll(selector));
            }
            return candidates
              .filter(rendered)
              .sort((a, b) => composerDistance(a) - composerDistance(b))[0] || null;
          };
          const attachmentInput = () => {
            document.querySelectorAll("[data-aihub-file-input]")
              .forEach(element => element.removeAttribute("data-aihub-file-input"));
            const candidates = [];
            for (const root of roots()) {
              for (const selector of [
                ...config.fileInputSelectors,
                "input[type=file]"
              ]) {
                candidates.push(...root.querySelectorAll(selector));
              }
            }
            const unique = [...new Set(candidates)];
            const selected = unique
              .filter(element => element instanceof HTMLInputElement)
              .sort((a, b) => domDistance(composer(), a) - domDistance(composer(), b))[0] || null;
            selected?.setAttribute("data-aihub-file-input", "true");
            return selected;
          };
          const inputMatchesAttachmentMode = (input, attachmentMode) => {
            const accept = (input?.getAttribute("accept") || "").toLowerCase();
            if (!accept.trim()) return true;
            const acceptsImage = /image\/|\.(png|jpe?g|webp|gif|bmp)/.test(accept);
            const acceptsDocument =
              /pdf|doc|xls|ppt|txt|csv|json|md|markdown|epub|html|yaml|ipynb/.test(accept);
            return attachmentMode === "image"
              ? acceptsImage
              : acceptsDocument || (!acceptsImage && !acceptsDocument);
          };
          const attachmentControl = (attachmentMode = "document") => {
            const labels = attachmentMode === "image"
              ? [
                  "上传图片", "添加图片", "图片",
                  "upload image", "add photo", "add image"
                ]
              : [
                  "上传文档", "上传文件", "添加文件", "附件",
                  "upload document", "upload file", "attach", "add file"
                ];
            const preferred = [];
            const candidates = [];
            for (const root of roots()) {
              for (const selector of config.attachmentControlSelectors || [])
                preferred.push(...root.querySelectorAll(selector));
              candidates.push(...root.querySelectorAll(
                "button,[role=button],[aria-label],[title]"
              ));
            }
            const labeledControl = candidates
              .filter(rendered)
              .filter(element => {
                const label = controlLabel(element).toLocaleLowerCase();
                return labels.some(value => label.includes(value.toLocaleLowerCase()));
              })
              .filter(element => composerDistance(element) <= 650)
              .sort((a, b) => composerDistance(a) - composerDistance(b))[0];
            if (labeledControl) return labeledControl;
            const preferredControl = preferred
              .filter(rendered)
              .filter(element => composerDistance(element) <= 650)
              .sort((a, b) => composerDistance(a) - composerDistance(b))[0];
            if (preferredControl) return preferredControl;
            return null;
          };
          const modelOptionElements = () => {
            const options = [];
            for (const root of roots()) {
              options.push(...root.querySelectorAll(
                "option,[role=option],[role=menuitem]," +
                "[data-testid*=model-option],[class*=model-option]," +
                ".model-item-content,[role=dialog] .cursor-pointer"
              ));
            }
            return options.filter(element =>
              element.tagName === "OPTION" || rendered(element));
          };
          const modelOptionLabel = element =>
            element?.querySelector?.(".name,.truncate")?.textContent?.trim() ||
            controlLabel(element);
          const modelSnapshot = () => {
            const control = modelControl();
            if (!control) return { model: null, models: [] };
            if (control instanceof HTMLSelectElement) {
              return {
                model: control.value || control.selectedOptions[0]?.textContent?.trim() || null,
                models: [...control.options].map(option => ({
                  id: option.value || option.textContent.trim(),
                  label: option.textContent.trim()
                })).filter(option => option.label)
              };
            }
            const current = controlLabel(control);
            const models = modelOptionElements().map(option => ({
              id: option.getAttribute("data-value") ||
                option.getAttribute("value") ||
                modelOptionLabel(option),
              label: modelOptionLabel(option)
            })).filter(option => option.label);
            if (current && !models.some(option => option.label === current))
              models.unshift({ id: current, label: current });
            return { model: current || null, models };
          };
          const attachmentKinds = input => {
            if (!input) return [];
            const accept = (input.getAttribute("accept") || "").toLowerCase();
            if (!accept || accept === "*/*") return [0, 1, 2, 3, 4, 5];
            const kinds = new Set();
            if (/image\/|\.(png|jpe?g|webp|gif|bmp)/.test(accept)) kinds.add(0);
            if (/pdf|\.pdf/.test(accept)) kinds.add(1);
            if (/word|officedocument\.word|\.docx?/.test(accept)) kinds.add(2);
            if (/excel|spreadsheet|\.xlsx?|\.csv/.test(accept)) kinds.add(3);
            if (/powerpoint|presentation|\.pptx?/.test(accept)) kinds.add(4);
            if (/text\/|\.txt|\.md|\.json/.test(accept)) kinds.add(5);
            return [...kinds];
          };
          const detectCapabilities = () => {
            const input = attachmentInput();
            const attachControl = attachmentControl();
            const model = modelSnapshot();
            const capabilities = {
              attachments: input
                ? attachmentKinds(input)
                : attachControl ? [0, 1, 2, 3, 4, 5] : [],
              modes: config.modeDefinitions.flatMap(definition => {
                const control = modeControl(definition);
                const opener = modeOpener(definition);
                return (control || opener) ? [{
                  mode: definition.mode,
                  label: definition.label,
                  enabled: modeState(definition)
                }] : [];
              }),
              model: model.model,
              models: model.models,
              multipleAttachments: !!input?.multiple,
              acceptedTypes: (input?.getAttribute("accept") || "")
                .split(",").map(value => value.trim()).filter(Boolean)
            };
            const signature = JSON.stringify(capabilities);
            if (signature !== capabilitySignature) {
              capabilitySignature = signature;
              post({ type: "capabilities.changed", capabilities });
            }
            return capabilities;
          };
          const configureModes = async requestedModes => {
            const desired = new Set(requestedModes || []);
            for (const definition of config.modeDefinitions) {
              const requested = desired.has(definition.mode);
              const directControl = modeControl(definition);
              const opener = modeOpener(definition);
              if (!directControl && !opener) {
                if (requested)
                  throw new Error(definition.label + " is not available on the current website.");
                continue;
              }
              if (modeState(definition) === requested) continue;
              const control = await revealModeControl(definition, requested);
              if (!control) {
                if (!requested && !(definition.disabledLabels || []).length)
                  continue;
                throw new Error("Failed to reveal " + definition.label + ".");
              }
              await trustedClick(control);
              await new Promise(resolve => setTimeout(resolve, 180));
              if (opener && !(definition.disabledLabels || []).length)
                continue;
              if (modeState(definition) !== requested)
                throw new Error("Failed to switch " + definition.label + ".");
            }
            detectCapabilities();
            return true;
          };
          window.__aihubConfigureModes = configureModes;
          window.__aihubPrepareAttachmentInput = async (attachmentMode = "document") => {
            const input = attachmentInput();
            if (input && inputMatchesAttachmentMode(input, attachmentMode)) return true;
            const control = attachmentControl(attachmentMode);
            if (!control) return false;
            await trustedClick(control);
            const deadline = performance.now() + 3000;
            while (performance.now() < deadline) {
              const nextInput = attachmentInput();
              if (nextInput && inputMatchesAttachmentMode(nextInput, attachmentMode)) {
                detectCapabilities();
                return true;
              }
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            return false;
          };
          window.__aihubDiscoverModels = async () => {
            const control = modelControl();
            if (!control) return detectCapabilities();
            if (!(control instanceof HTMLSelectElement)) {
              await trustedClick(control);
              await new Promise(resolve => setTimeout(resolve, 180));
            }
            return detectCapabilities();
          };
          window.__aihubConfigureModel = async requestedModel => {
            if (!requestedModel) return true;
            const control = modelControl();
            if (!control)
              throw new Error("The website model selector is not available.");
            if (control instanceof HTMLSelectElement) {
              const option = [...control.options].find(item =>
                item.value === requestedModel ||
                item.textContent.trim() === requestedModel);
              if (!option) throw new Error("The requested model is not available.");
              control.value = option.value;
              control.dispatchEvent(new Event("change", { bubbles: true }));
              detectCapabilities();
              return true;
            }
            if (controlLabel(control) === requestedModel) return true;
            await trustedClick(control);
            await new Promise(resolve => setTimeout(resolve, 180));
            const option = modelOptionElements().find(element => {
              const label = modelOptionLabel(element);
              const id = element.getAttribute("data-value") ||
                element.getAttribute("value") || label;
              return id === requestedModel || label === requestedModel;
            });
            if (!option)
              throw new Error("The requested model is not available.");
            await trustedClick(option);
            await new Promise(resolve => setTimeout(resolve, 180));
            detectCapabilities();
            return true;
          };
          window.__aihubWaitForAttachments = async names => {
            const expected = names || [];
            if (!expected.length) return true;
            const deadline = performance.now() + 30000;
            let stable = 0;
            while (performance.now() < deadline) {
              const input = attachmentInput();
              const selectedNames = [...(input?.files || [])].map(file => file.name);
              const pageText = document.body?.innerText || "";
              const represented = expected.every(name =>
                selectedNames.includes(name) || pageText.includes(name));
              const busy = [...document.querySelectorAll(
                "[aria-busy=true],[role=progressbar]," +
                "[class*=upload][class*=loading],[class*=upload][class*=progress]"
              )].some(rendered);
              if (represented && !busy) {
                stable++;
                if (stable >= 3) return true;
              } else {
                stable = 0;
              }
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            throw new Error("Attachment upload did not finish within 30 seconds.");
          };
          const detect = () => {
            const loginMarker = firstRendered(config.loginMarkers);
            const authBlocker = firstRendered(config.authBlockerSelectors);
            const authenticated = !!composer() && !authBlocker;
            post({ type: "auth.changed", authenticated });
            detectCapabilities();
            return authenticated;
          };
          const stopVisible = () => !!first(config.stopSelectors);
          const complete = () => {
            if (!activeId || !latestText) return;
            post({ type: "message.completed", messageId: activeId, text: latestText, html: assistantHtml });
            activeId = null;
            activePrompt = "";
            latestText = "";
            assistantHtml = "";
          };
          const inspect = () => {
            if (!activeId) return;
            const next = assistantText();
            const html = assistantHtmlContent();
            if (html) assistantHtml = html;
            if (!next || next === latestText) return;
            latestText = next;
            lastChange = Date.now();
            post({ type: "message.snapshot", messageId: activeId, text: next, html: html || undefined });
          };
          const scheduleCompletion = () => {
            clearTimeout(completionTimer);
            completionTimer = setTimeout(() => {
              if (!activeId) return;
              inspect();
              const quietFor = Date.now() - lastChange;
              if (!latestText && Date.now() - startedAt > 60000) {
                post({
                  type: "generation.failed",
                  reason: "No website response was detected. Open the provider panel to inspect the page."
                });
                activeId = null;
                return;
              }
              if (latestText && !stopVisible() && quietFor > 3500) complete();
              else scheduleCompletion();
            }, 900);
          };
          const observe = () => {
            new MutationObserver(() => {
              detect();
              inspect();
            }).observe(document.documentElement, {
              subtree: true, childList: true, characterData: true
            });
            setInterval(() => {
              detect();
              inspect();
            }, 600);
            detect();
            post({ type: "bridge.ready" });
          };
          const setText = (element, text) => {
            element.focus();
            if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
              const proto = element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, text);
            } else {
              const selection = getSelection();
              const range = document.createRange();
              range.selectNodeContents(element);
              selection?.removeAllRanges();
              selection?.addRange(range);
              if (!document.execCommand("insertText", false, text)) element.textContent = text;
            }
            element.dispatchEvent(new InputEvent("input", {
              bubbles: true, composed: true, inputType: "insertText", data: text
            }));
            element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          };
          const send = async text => {
            const input = await waitForComposer();
            if (!input)
              throw new Error("The website composer is not ready. Open the provider panel to sign in.");
            activePrompt = String(text || "").trim();
            assistantBaseline = textOf(allLast(config.assistantSelectors), true);
            assistantHtmlBaseline = allLast(config.assistantSelectors)?.innerHTML || "";
            documentBaseline = documentText();
            setText(input, text);
            await new Promise(resolve => requestAnimationFrame(() =>
              requestAnimationFrame(resolve)));
            const submit = await waitForSubmit(
              input, config.submitWithEnter ? 350 : 5000);
            if (!submit && !config.submitWithEnter)
              throw new Error("The website send control was not found.");
            activeId = crypto.randomUUID();
            latestText = "";
            startedAt = lastChange = Date.now();
            // Use CDP trusted events for submit 鈥?JS synthetic events are ignored by modern web apps
            if (submit) {
              const rect = submit.getBoundingClientRect();
              post({
                type: "send.click.required",
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              });
            } else {
              post({ type: "send.enter.required" });
            }
            post({ type: "message.dispatched", messageId: activeId });
            for (let attempt = 0; attempt < 30 && !sentSuccessfully(input); attempt++)
              await new Promise(resolve => setTimeout(resolve, 100));
            if (!sentSuccessfully(input))
              throw new Error("The provider did not accept the send action. Open the provider panel and retry.");
            post({ type: "message.started", messageId: activeId });
            scheduleCompletion();
          };
          const cancel = () => {
            first(config.stopSelectors)?.click();
            if (activeId) post({ type: "generation.failed", reason: "Generation stopped." });
            activeId = null;
          };
          window.chrome.webview.addEventListener("message", async event => {
            const command = event.data || {};
            if (command.type === "ui.click.completed" && command.actionId) {
              const pending = pendingUiActions.get(command.actionId);
              if (!pending) return;
              clearTimeout(pending.timeout);
              pendingUiActions.delete(command.actionId);
              if (command.ok) pending.resolve();
              else pending.reject(new Error("Trusted mode click failed."));
              return;
            }
            try {
              if (command.type === "send") await send(command.text);
              if (command.type === "cancel") cancel();
              if (command.type === "probe") detect();
            } catch (error) {
              post({ type: "command.failed", reason: String(error?.message || error) });
            }
          });
          if (document.readyState === "loading")
            addEventListener("DOMContentLoaded", observe, { once: true });
          else observe();
        })();
        """;
    }
}
