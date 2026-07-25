const port = Number(process.argv[2] ?? 9222);
const provider = process.argv[3] ?? "deepseek";

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
let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  handler(message);
});
function evaluate(expression) {
  commandId += 1;
  const id = commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("CDP evaluation timed out."));
    }, 30_000);
    pending.set(id, (message) => {
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
      id,
      method: "Runtime.evaluate",
      params: {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
    }));
  });
}

const result = await evaluate(`Promise.all([
  window.aihub.getProviderDebugSnapshot(${JSON.stringify(provider)}),
  window.aihub.listProviderAdapterEvents(${JSON.stringify(provider)}, 100)
]).then(([debug, events]) => ({ debug, events }))`);
console.log(JSON.stringify(result, null, 2));
socket.close();
