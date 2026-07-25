const port = Number(process.argv[2] ?? 9222);
const selected = new Set(
  (process.argv[3] ?? "deepseek,qianwen").split(",").map((value) => value.trim()),
);

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
);

function providerForUrl(url) {
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("qianwen")) return "qianwen";
  if (url.includes("kimi.com")) return "kimi";
  if (url.includes("doubao.com")) return "doubao";
  if (url.includes("yuanbao.tencent.com")) return "hunyuan";
  return undefined;
}

function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out inspecting ${target.url}`));
    }, 10_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text ?? "CDP evaluation failed."));
        return;
      }
      resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`Could not inspect ${target.url}`));
    });
  });
}

for (const target of targets) {
  const provider = providerForUrl(target.url);
  if (!provider || !selected.has(provider)) continue;
  const tokenPrefix = `AIHUB_${provider.toUpperCase()}_`;
  const expression = `(() => {
    const body = document.body?.innerText || "";
    const tokenPrefix = ${JSON.stringify(tokenPrefix)};
    const tokenIndex = body.lastIndexOf(tokenPrefix);
    const errors = Array.from(document.querySelectorAll(
      "[role='alert'],[role='dialog'],[class*='toast'],[class*='error'],[class*='failed'],[class*='limit']"
    )).slice(-30).map((element) => ({
      tag: element.tagName,
      className: String(element.className || "").slice(0, 240),
      text: (element.innerText || element.textContent || "").trim().slice(0, 300),
    })).filter((item) => item.text);
    const authCandidates = Array.from(document.querySelectorAll(
      "input[type='tel'],input[placeholder*='验证码'],input[placeholder*='手机号'],button,[role='button'],a[href]"
    )).filter((element) => {
      const text = (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.innerText ||
        element.textContent ||
        ""
      ).replace(/\\s+/g, " ").trim();
      const className = String(element.className || "");
      return /login|sign in|verification|verify|phone|登录|验证|手机/i.test(text) ||
        /phone-login-action|history-list__login|login/i.test(className);
    }).slice(-30).map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        className: String(element.className || "").slice(0, 240),
        text: (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.innerText ||
          element.textContent ||
          ""
        ).replace(/\\s+/g, " ").trim().slice(0, 300),
        rect: [rect.x, rect.y, rect.width, rect.height],
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    });
    const modeCandidates = Array.from(document.querySelectorAll(
      "button,[role='button'],[aria-pressed],[data-state]"
    )).filter((element) => {
      const text = (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.innerText ||
        element.textContent ||
        ""
      ).replace(/\s+/g, " ").trim();
      return /思考|研究|搜索|专家|快速|reason|research|search/i.test(text);
    }).slice(-30).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: String(element.className || "").slice(0, 240),
        text: (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.innerText ||
          element.textContent ||
          ""
        ).replace(/\s+/g, " ").trim().slice(0, 160),
        ariaPressed: element.getAttribute("aria-pressed"),
        dataState: element.getAttribute("data-state"),
        rect: [rect.x, rect.y, rect.width, rect.height],
      };
    });
    const selectors = [
      ".chat-round[data-chat]",
      "[data-chat-list-key]",
      ".message-card-wrap.question",
      ".question-text-card",
      "div[class*='message-select-wrapper-answer']",
      "div[class*='chat-answers-card-wrap']",
      "div[data-chat-answers-wrap]",
      "div.answer-common-card",
      "div.qk-markdown",
      ".ds-message",
      ".ds-message--user",
      ".ds-message--assistant",
      ".ds-markdown",
      "[data-message-id]",
      "[data-target-id='message-box-target-id']",
      "[data-container-type='block-v2']",
      ".flow-markdown-body",
      ".md-box-root",
      ".agent-chat__list__item",
      ".agent-chat__list__item--human",
      ".agent-chat__list__item--ai",
      ".hyc-common-markdown",
      ".ds-button",
      ".ds-button--primary",
      "[role='button'].ds-button--primary.ds-button--filled"
    ];
    const selectorStats = selectors.map((selector) => {
      const elements = Array.from(document.querySelectorAll(selector));
      return {
        selector,
        count: elements.length,
        samples: elements.slice(-3).map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            className: String(element.className || "").slice(0, 240),
            textLength: (element.innerText || element.textContent || "").length,
            attributes: Array.from(element.attributes).reduce((values, attribute) => {
              values[attribute.name] = attribute.value.slice(0, 160);
              return values;
            }, {}),
            html: element.outerHTML.slice(0, 1_200),
            rect: [rect.x, rect.y, rect.width, rect.height],
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
          };
        }),
      };
    });
    const leafNodes = Array.from(document.querySelectorAll("*"))
      .filter((element) =>
        element.children.length === 0 &&
        (element.textContent || "").includes(tokenPrefix)
      )
      .slice(-10)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className || "").slice(0, 240),
        attributes: Array.from(element.attributes).reduce((values, attribute) => {
          values[attribute.name] = attribute.value.slice(0, 160);
          return values;
        }, {}),
        text: (element.textContent || "").slice(0, 300),
        ancestors: (() => {
          const values = [];
          let current = element.parentElement;
          while (current && values.length < 8) {
            values.push({
              tag: current.tagName,
              className: String(current.className || "").slice(0, 240),
              textLength: (current.innerText || current.textContent || "").length,
            });
            current = current.parentElement;
          }
          return values;
        })(),
      }));
    return {
      title: document.title,
      bodyLength: body.length,
      tokenFound: tokenIndex >= 0,
      tokenContext: tokenIndex >= 0 ? body.slice(tokenIndex, tokenIndex + 1_200) : "",
      errors,
      authCandidates,
      modeCandidates,
      selectorStats,
      leafNodes,
    };
  })()`;
  try {
    const result = await evaluate(target, expression);
    console.log(JSON.stringify({
      provider,
      url: target.url,
      result,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      provider,
      url: target.url,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}
