const port = Number(process.argv[2] ?? 9222);
const method = process.argv[3];
const rawArgs = process.argv.slice(4);
const args =
  rawArgs.length === 1 && rawArgs[0]?.trimStart().startsWith("[")
    ? JSON.parse(rawArgs[0])
    : rawArgs;
if (!method || !Array.isArray(args)) {
  throw new Error(
    "Usage: node invoke-aihub-cdp.mjs <port> <method> [<json-array> | <arg> ...]",
  );
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
);
const target = targets.find((item) =>
  item.type === "page" &&
  item.title === "AIHub" &&
  item.webSocketDebuggerUrl
);
if (!target) throw new Error("AIHub renderer target was not found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const expression =
  method === "inspectConversation"
    ? `window.aihub.getSnapshot().then((snapshot) => {
        const conversation = snapshot.conversations.find(
          (item) => item.id === ${JSON.stringify(args[0])},
        );
        if (!conversation) return null;
        return {
          provider: snapshot.providers.find(
            (item) => item.id === conversation.provider,
          ),
          conversation: {
            id: conversation.id,
            externalId: conversation.externalId,
            messages: conversation.messages.map((message) => {
              const text = message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("\\n");
              return {
                role: message.role,
                status: message.status,
                statusPhase: message.statusPhase,
                statusDetail: message.statusDetail,
                errorCode: message.errorCode,
                textLength: text.length,
                textPreview: text.slice(0, 160),
              };
            }),
          },
        };
      })`
    : `window.aihub[${JSON.stringify(method)}](...${JSON.stringify(args)})`;
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("CDP evaluation timed out.")), 60_000);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.result?.exceptionDetails) {
      reject(new Error(
        message.result.exceptionDetails.exception?.description ??
          message.result.exceptionDetails.text ??
          "CDP evaluation failed.",
      ));
      return;
    }
    resolve(message.result?.result?.value);
  });
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
console.log(JSON.stringify({ method, result }));
socket.close();
