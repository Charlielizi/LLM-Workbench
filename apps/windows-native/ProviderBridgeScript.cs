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
            documentSelectors = definition.ConversationDocumentSelectors,
            submitWithEnter = definition.SubmitWithEnter,
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
          let documentBaseline = "";
          let lastChange = 0;
          let startedAt = 0;
          let completionTimer = null;

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
          const allLast = selectors => {
            for (const selector of selectors || []) {
              const matches = [];
              for (const root of roots())
                matches.push(...[...root.querySelectorAll(selector)].filter(visible));
              if (matches.length) return matches.at(-1);
            }
            return null;
          };
          const textOf = element =>
            (element?.innerText || element?.textContent || "")
              .replace(/\r/g, "")
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
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
          const cleanFallback = text => text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && line !== activePrompt)
            .filter(line => !/^(复制|重试|编辑|分享|下载|停止|发送|Copy|Retry|Edit|Share)$/.test(line))
            .join("\n")
            .trim();
          const boilerplate = [
            /^\u4e0b\u8f7d$/,
            /^\u5185\u5bb9\u7531\s*AI\s*\u751f\u6210[，,]?\s*\u4ec5\u4f9b\u53c2\u8003[。.]?$/i,
            /^AI\s*\u751f\u6210\u5185\u5bb9\u4ec5\u4f9b\u53c2\u8003[。.]?$/i,
            /^AI\s*\u751f\u6210\u53ef\u80fd\u6709\u8bef[，,]?\s*\u8bf7\u6838\u5b9e[。.]?$/i,
            /^(\u590d\u5236|\u91cd\u8bd5|\u7f16\u8f91|\u5206\u4eab|\u505c\u6b62|\u53d1\u9001)$/,
            /^(Copy|Retry|Edit|Share|Download|Stop|Send)$/i
          ];
          const cleanResponse = text => cleanFallback(text)
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && !boilerplate.some(pattern => pattern.test(line)))
            .join("\n")
            .replace(/\u4e0b\u8f7d\s*\u5185\u5bb9\u7531\s*AI\s*\u751f\u6210[，,]?\s*\u4ec5\u4f9b\u53c2\u8003[。.]?/gi, "")
            .trim();
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
                  const text = cleanResponse(textOf(element));
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
            const direct = textOf(allLast(config.assistantSelectors));
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
          const composer = () => first([
            ...config.composerSelectors,
            "textarea:not([disabled])",
            "[contenteditable='true'][role='textbox']",
            "div[contenteditable='true']"
          ]);
          const waitForComposer = async () => {
            for (let attempt = 0; attempt < 120; attempt++) {
              const input = composer();
              if (input) return input;
              await new Promise(resolve => setTimeout(resolve, 250));
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
              .filter(item => !/附件|上传|图片|语音|模式|思考|搜索|attach|upload/i.test(item.label))
              .sort((a, b) => a.distance - b.distance)[0]?.element || null;
          };
          const waitForSubmit = async input => {
            for (let attempt = 0; attempt < 60; attempt++) {
              const submit = first([
                ...config.submitSelectors,
                "button[type='submit']:not([disabled])",
                "button[aria-label*='Send']:not([disabled])",
                "button[aria-label*='\u53d1\u9001']:not([disabled])"
              ]) || (config.providerId === "DeepSeek" ? nearbySubmit(input) : null);
              if (submit) return submit;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            return null;
          };
          const activate = element => {
            for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
              const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
              element.dispatchEvent(new EventType(type, {
                bubbles: true, composed: true, cancelable: true,
                button: 0, buttons: type.endsWith("down") ? 1 : 0
              }));
            }
            if (element instanceof HTMLElement) element.click();
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
          const trustedActivation = async (submit, input) => {
            if (!submit) return false;
            const rect = submit.getBoundingClientRect();
            post({
              type: "send.activation.required",
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            });
            for (let attempt = 0; attempt < 20; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 150));
              if (sentSuccessfully(input)) return true;
            }
            return false;
          };
          const detect = () => {
            const authenticated = !!composer();
            post({ type: "auth.changed", authenticated });
            return authenticated;
          };
          const stopVisible = () => !!first(config.stopSelectors);
          const complete = () => {
            if (!activeId || !latestText) return;
            post({ type: "message.completed", messageId: activeId, text: latestText });
            activeId = null;
            activePrompt = "";
            latestText = "";
          };
          const inspect = () => {
            if (!activeId) return;
            const next = assistantText();
            if (!next || next === latestText) return;
            latestText = next;
            lastChange = Date.now();
            post({ type: "message.snapshot", messageId: activeId, text: next });
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
          const enter = element => {
            for (const type of ["keydown", "keypress", "keyup"]) {
              element.dispatchEvent(new KeyboardEvent(type, {
                key: "Enter", code: "Enter", keyCode: 13, which: 13,
                bubbles: true, composed: true, cancelable: true
              }));
            }
          };
          const send = async text => {
            const input = await waitForComposer();
            if (!input)
              throw new Error("The website composer is not ready. Open the provider panel to sign in.");
            activePrompt = String(text || "").trim();
            assistantBaseline = textOf(allLast(config.assistantSelectors));
            documentBaseline = documentText();
            setText(input, text);
            await new Promise(resolve => setTimeout(resolve, 500));
            const submit = await waitForSubmit(input);
            if (!submit && !config.submitWithEnter)
              throw new Error("The website send control was not found.");
            activeId = crypto.randomUUID();
            latestText = "";
            startedAt = lastChange = Date.now();
            if (submit) activate(submit); else enter(input);
            for (let attempt = 0; attempt < 10 && !sentSuccessfully(input); attempt++)
              await new Promise(resolve => setTimeout(resolve, 150));
            if (!sentSuccessfully(input)) {
              const trusted = await trustedActivation(submit, input);
              if (!trusted) {
                enter(input);
                for (let attempt = 0; attempt < 10 && !sentSuccessfully(input); attempt++)
                  await new Promise(resolve => setTimeout(resolve, 150));
              }
            }
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
