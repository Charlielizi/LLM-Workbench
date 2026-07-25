const port = Number(process.argv[2] ?? 9222);
const conversationId = process.argv[3];
if (!conversationId) throw new Error("A conversation ID is required.");

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

function readConversation() {
  return evaluate(`window.aihub.getSnapshot().then((snapshot) => {
    const conversation = snapshot.conversations.find(
      (item) => item.id === ${JSON.stringify(conversationId)}
    );
    if (!conversation) return null;
    return conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      text: (message.content || [])
        .filter((block) => block.type === "text")
        .map((block) => block.text || "")
        .join("")
    }));
  })`);
}

let messages = await readConversation();
const failedUsers = messages.filter(
  (message) => message.role === "user" && message.status === "failed",
);
for (const message of failedUsers) {
  await evaluate(
    `window.aihub.deleteMessage(${JSON.stringify(conversationId)}, ${JSON.stringify(message.id)})`,
  );
}
messages = await readConversation();
const users = messages.filter((message) => message.role === "user");
const assistants = messages.filter((message) => message.role === "assistant");
const second = assistants[1]?.text.toLowerCase() ?? "";
const third = assistants[2]?.text.toLowerCase() ?? "";
const summary = {
  conversationId,
  removedFailedUserMessages: failedUsers.length,
  messageCount: messages.length,
  userMessageCount: users.length,
  assistantMessageCount: assistants.length,
  allTerminalCompleted: assistants.every((message) => message.status === "completed"),
  assistantLengths: assistants.map((message) => message.text.length),
  contextChecks: {
    round2ReferencesPreviousFramework:
      second.includes("previous") &&
      second.includes("eight") &&
      second.includes("principle") &&
      second.includes("roadmap"),
    round3AuditsRoadmap:
      third.includes("roadmap") &&
      third.includes("failure") &&
      third.includes("owner") &&
      third.includes("trigger") &&
      third.includes("verification"),
  },
};
summary.passed =
  summary.userMessageCount === 3 &&
  summary.assistantMessageCount === 3 &&
  summary.allTerminalCompleted &&
  Object.values(summary.contextChecks).every(Boolean);
console.log(JSON.stringify(summary, null, 2));
socket.close();
if (!summary.passed) process.exitCode = 1;
