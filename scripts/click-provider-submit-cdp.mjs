const port = Number(process.argv[2] ?? 9222);
const provider = process.argv[3] ?? "deepseek";
const prompt = process.argv[4];

const providerForUrl = (url) => {
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("qianwen")) return "qianwen";
  if (url.includes("doubao")) return "doubao";
  if (url.includes("yuanbao.tencent")) return "hunyuan";
  if (url.includes("kimi.com")) return "kimi";
  return undefined;
};
const selectors = {
  deepseek: "[role='button'].ds-button--primary.ds-button--filled",
  qianwen: "button[aria-label*='发送'],button[data-testid*='send']",
  doubao: "button[aria-label*='发送'],button[data-testid*='send'],button[type='submit']",
  hunyuan: "#yuanbao-send-btn,a[class*='send-btn']",
  kimi: "button[aria-label*='发送'],button[aria-label*='Send']",
};

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
);
const target = targets.find((item) =>
  item.type === "page" &&
  providerForUrl(item.url) === provider &&
  item.webSocketDebuggerUrl
);
if (!target) throw new Error(`Provider page ${provider} was not found.`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  handler(message);
});
function command(method, params = {}) {
  commandId += 1;
  const id = commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out.`));
    }, 10_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }
      resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const selector = selectors[provider];
if (!selector) throw new Error(`No submit selector for ${provider}.`);
const evaluated = await command("Runtime.evaluate", {
  expression: `(() => {
    const prompt = ${JSON.stringify(prompt)};
    if (prompt !== undefined) {
      const composer = document.querySelector("textarea,[contenteditable='true'][role='textbox']");
      if (!composer) return null;
      composer.focus();
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const prototype = composer instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(composer, prompt);
      } else {
        composer.textContent = prompt;
      }
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: prompt,
      }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus();
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  })()`,
  returnByValue: true,
});
const point = evaluated.result.value;
if (!point || point.width <= 0 || point.height <= 0) {
  throw new Error(`Visible submit control was not found for ${provider}.`);
}
await command("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: point.x,
  y: point.y,
  button: "left",
  clickCount: 1,
});
await command("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: point.x,
  y: point.y,
  button: "left",
  clickCount: 1,
});
console.log(JSON.stringify({ provider, point }));
socket.close();
