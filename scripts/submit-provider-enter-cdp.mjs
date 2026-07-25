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
const expression =
  `window.aihub.submitProviderEnter(${JSON.stringify(provider)})`;
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("CDP evaluation timed out.")), 30_000);
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
console.log(JSON.stringify({ provider, result }));
socket.close();
