import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] ?? 9222);
const provider = process.argv[3] ?? "kimi";
const timeoutMs = Number(process.argv[4] ?? 240_000);
const existingConversationId = process.argv[5] || undefined;
const startRound = Math.min(5, Math.max(1, Number(process.argv[6] ?? 1)));
const artifactDir = process.env.AIHUB_REAL_PROVIDER_ARTIFACT_DIR
  ? path.resolve(process.env.AIHUB_REAL_PROVIDER_ARTIFACT_DIR)
  : undefined;
if (artifactDir) await mkdir(artifactDir, { recursive: true });

const roundDefinitions = [
  {
    scenario: "short-answer",
    token: `AIHUB_${provider.toUpperCase()}_SHORT_${Date.now()}`,
    minimumLength: 120,
    minimumParagraphs: 2,
    prompt:
      "Answer in exactly two natural paragraphs. Explain one practical way to make a daily learning habit reliable, with one example. " +
      "Include the unique token from the first line exactly once, on the final line, and output nothing after it.",
  },
  {
    scenario: "long-answer",
    token: `AIHUB_${provider.toUpperCase()}_LONG_${Date.now() + 1}`,
    minimumLength: 1_800,
    prompt:
      "Write a complete English answer of at least 1800 characters that defines exactly eight numbered principles for building a reliable personal AI learning and work system. " +
      "Each principle must include a concrete example and a measurable success criterion. " +
      "Finish with a short synthesis, then reproduce the unique token from the first line exactly once on the final line. Output nothing after the final token.",
  },
  {
    scenario: "context-round-1",
    token: `AIHUB_${provider.toUpperCase()}_CONTEXT_R1_${Date.now() + 2}`,
    minimumLength: 900,
    prompt:
      "Using the eight principles from your immediately previous long answer in this same conversation, create a detailed 60-day implementation roadmap of at least 900 characters. " +
      "Explicitly state that the roadmap is based on the previous eight-principle framework. " +
      "Organize it by weeks, include daily examples, checkpoints, fallback actions, and measurable exit criteria. " +
      "On the final line reproduce the unique token exactly once. Output nothing after the final token.",
  },
  {
    scenario: "context-round-2",
    token: `AIHUB_${provider.toUpperCase()}_CONTEXT_R2_${Date.now() + 3}`,
    minimumLength: 900,
    prompt:
      "Audit the 60-day roadmap you just produced in this same conversation. Write at least 900 characters. " +
      "Cite at least three specific week numbers or checkpoint names from that roadmap so the continuity is verifiable. " +
      "Identify at least ten concrete failure modes or contradictions, map every finding back to the previous roadmap or its eight-principle foundation, and provide a corrected action, owner, trigger, and verification method. " +
      "On the final line reproduce the unique token exactly once. Output nothing after the final token.",
  },
  {
    scenario: "context-round-3",
    token: `AIHUB_${provider.toUpperCase()}_CONTEXT_R3_${Date.now() + 4}`,
    minimumLength: 900,
    prompt:
      "Produce the final go/no-go review for the corrected roadmap from your immediately previous answer. Write at least 900 characters. " +
      "Reference at least two concrete failure modes from that audit and at least two earlier roadmap checkpoints, then give owners, triggers, and verification evidence. " +
      "End with a concise go/no-go checklist. On the final line reproduce the unique token exactly once. Output nothing after the final token.",
  },
];

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
);
const target = targets.find((item) =>
  item.type === "page" &&
  item.title === "AIHub" &&
  item.webSocketDebuggerUrl
);
if (!target) {
  throw new Error(`AIHub renderer target was not found on CDP port ${port}.`);
}

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

function cdpCommand(method, params, evaluationTimeoutMs = 30_000) {
  commandId += 1;
  const id = commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP evaluation ${id} timed out.`));
    }, evaluationTimeoutMs);
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
      resolve(message.result);
    });
    socket.send(JSON.stringify({
      id,
      method,
      params,
    }));
  });
}

async function evaluate(expression, evaluationTimeoutMs = 30_000) {
  const result = await cdpCommand("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, evaluationTimeoutMs);
  return result?.result?.value;
}

function apiCall(method, ...args) {
  return evaluate(
    `window.aihub[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
    60_000,
  );
}

function normalizedBody(value) {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyHash(value) {
  return createHash("sha256").update(normalizedBody(value), "utf8").digest("hex");
}

function snapshotText(message) {
  return (message?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function conversationStateExpression(conversationId) {
  return `window.aihub.getSnapshot().then((snapshot) => {
    const conversation = snapshot.conversations.find(
      (item) => item.id === ${JSON.stringify(conversationId)}
    );
    if (!conversation) return null;
    return {
      id: conversation.id,
      messageCount: conversation.messages.length,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        status: message.status,
        statusPhase: message.statusPhase,
        failureOrigin: message.failureOrigin,
        text: (message.content || [])
          .filter((block) => block.type === "text")
          .map((block) => block.text || "")
          .join("")
      }))
    };
  })`;
}

async function readConversation(conversationId) {
  return evaluate(conversationStateExpression(conversationId));
}

async function waitForRound(conversationId, priorAssistantCount, startedAt) {
  let lastProgress = "";
  while (Date.now() - startedAt < timeoutMs) {
    const state = await readConversation(conversationId);
    const assistants = state.messages.filter((message) => message.role === "assistant");
    const assistant = assistants.at(-1);
    const progress = `${assistant?.status ?? "none"}:${assistant?.statusPhase ?? "none"}:${assistant?.text.length ?? 0}`;
    if (progress !== lastProgress) {
      console.log(
        `[${new Date().toISOString()}] assistants=${assistants.length} progress=${progress}`,
      );
      lastProgress = progress;
    }
    if (
      assistants.length > priorAssistantCount &&
      (assistant?.status === "completed" || assistant?.status === "failed")
    ) {
      return { state, assistant };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Round timed out after ${timeoutMs}ms.`);
}

await apiCall("setProviderWebsiteVisible", provider, true);
const providerState = await evaluate(
  `window.aihub.getSnapshot().then((snapshot) =>
    snapshot.providers.find((item) => item.id === ${JSON.stringify(provider)}) || null
  )`,
);
if (!providerState?.authenticated) {
  const summary = {
    provider,
    status: "AuthBlocked",
    passed: true,
    completedRounds: 0,
    expectedRounds: roundDefinitions.length - startRound + 1,
    reason: providerState?.reason ?? "Provider authentication is required.",
    results: [],
  };
  console.log(`AIHUB_MULTITURN_RESULT=${JSON.stringify(summary)}`);
  socket.close();
  process.exit(0);
}
const conversation = existingConversationId
  ? { id: existingConversationId }
  : await apiCall("createConversation", provider);
await apiCall("selectConversation", conversation.id);
console.log(`conversation=${conversation.id} provider=${provider}`);

const results = [];
for (let index = startRound - 1; index < roundDefinitions.length; index += 1) {
  const round = roundDefinitions[index];
  if (index === 0) {
    await apiCall("setProviderWebsiteVisible", provider, false);
  } else if (index === 1) {
    await apiCall("setProviderWebsiteVisible", provider, true);
  }
  const before = await readConversation(conversation.id);
  const priorAssistantCount = before.messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const startedAt = Date.now();
  const fullPrompt = `${round.token}\n${round.prompt}`;
  console.log(`round=${index + 1} sending token=${round.token}`);
  await apiCall("sendMessage", {
    provider,
    conversationId: conversation.id,
    text: fullPrompt,
    modes: [],
  });
  const { state, assistant } = await waitForRound(
    conversation.id,
    priorAssistantCount,
    startedAt,
  );
  const text = assistant.text;
  const websiteSnapshot = await apiCall("getProviderWebsiteSnapshot", provider);
  const websiteAssistant = websiteSnapshot.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const websiteText = snapshotText(websiteAssistant);
  const tokenCount = text.split(round.token).length - 1;
  const result = {
    round: index + 1,
    scenario: round.scenario,
    token: round.token,
    assistantStatus: assistant.status,
    statusPhase: assistant.statusPhase,
    textLength: text.length,
    elapsedMs: Date.now() - startedAt,
    startsWithToken: text.trimStart().startsWith(round.token),
    endsWithToken: text.trimEnd().endsWith(round.token),
    tokenCount,
    paragraphCount: text
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean).length,
    minimumLength: round.minimumLength,
    lengthPassed: text.length >= round.minimumLength,
    aiHubBodyHash: bodyHash(text),
    websiteBodyHash: bodyHash(websiteText),
    bodyHashMatched: Boolean(websiteText) && bodyHash(text) === bodyHash(websiteText),
    websiteMessageKey: websiteAssistant?.key,
    websiteConversationId: websiteSnapshot.externalId,
    userMessageCount: state.messages.filter((message) => message.role === "user").length,
    assistantMessageCount: state.messages.filter(
      (message) => message.role === "assistant",
    ).length,
  };
  result.passed =
    result.assistantStatus === "completed" &&
    result.endsWithToken &&
    result.tokenCount === 1 &&
    result.lengthPassed &&
    result.bodyHashMatched &&
    (!round.minimumParagraphs || result.paragraphCount >= round.minimumParagraphs);
  const debugSnapshot = await apiCall("getProviderDebugSnapshot", provider);
  const adapterEvents = await apiCall(
    "listProviderAdapterEvents",
    provider,
    500,
  );
  result.debugSnapshot = debugSnapshot;
  result.transportTimeline = adapterEvents
    .filter((event) => event.type === "provider.transport")
    .map((event) => ({
      createdAt: event.createdAt,
      detail: event.detail,
    }));
  result.failureOrigin = state.messages
    .filter((message) => message.status === "failed")
    .at(-1)?.failureOrigin;
  result.backgroundRequested = index === 0;
  result.visibleFallbackUsed = Boolean(
    index === 0 &&
    (await evaluate(
      `window.aihub.getSnapshot().then((snapshot) =>
        snapshot.providers.find((item) => item.id === ${JSON.stringify(provider)})?.websiteVisible || false
      )`,
    )),
  );
  if (artifactDir) {
    const roundName = `round-${String(index + 1).padStart(2, "0")}-${round.scenario}`;
    await writeFile(
      path.join(artifactDir, `${roundName}-website-snapshot.json`),
      `${JSON.stringify(redactedWebsiteSnapshot(websiteSnapshot), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, `${roundName}-dom-summary.json`),
      `${JSON.stringify(debugSnapshot, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(artifactDir, `${roundName}-transport.json`),
      `${JSON.stringify(result.transportTimeline, null, 2)}\n`,
      "utf8",
    );
    const aiHubCapture = await cdpCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (aiHubCapture?.data) {
      await writeFile(
        path.join(artifactDir, `${roundName}-aihub.png`),
        Buffer.from(aiHubCapture.data, "base64"),
      );
    }
    const providerCapture = await captureProviderScreenshot(
      port,
      debugSnapshot?.url,
    );
    if (providerCapture) {
      await writeFile(
        path.join(artifactDir, `${roundName}-provider.png`),
        providerCapture,
      );
    }
  }
  results.push(result);
  console.log(JSON.stringify(result));
  console.log(`AIHUB_PROVIDER_DEBUG=${JSON.stringify(debugSnapshot)}`);
  if (!result.passed) break;
}

if (
  startRound === 1 &&
  results.length === roundDefinitions.length &&
  results.every((result) => result.passed)
) {
  const beforeStop = await readConversation(conversation.id);
  const priorAssistantCount = beforeStop.messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const stopToken = `AIHUB_${provider.toUpperCase()}_STOP_${Date.now()}`;
  await apiCall("sendMessage", {
    provider,
    conversationId: conversation.id,
    text:
      `${stopToken}\nWrite a deliberately long 4000-character analysis with at least twenty sections. ` +
      "Do not place the token in the answer.",
    modes: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await apiCall("cancelGeneration", provider);
  const cancelledRound = await waitForRound(
    conversation.id,
    priorAssistantCount,
    Date.now(),
  );
  const cancelledAssistant = cancelledRound.assistant;
  const recoveryToken = `AIHUB_${provider.toUpperCase()}_AFTER_STOP_${Date.now() + 1}`;
  const recoveryBeforeCount = cancelledRound.state.messages.filter(
    (message) => message.role === "assistant",
  ).length;
  await apiCall("sendMessage", {
    provider,
    conversationId: conversation.id,
    text:
      `${recoveryToken}\nConfirm in one concise paragraph that a new request works after cancellation. ` +
      "Put the unique token exactly once on the final line.",
    modes: [],
  });
  const recoveredRound = await waitForRound(
    conversation.id,
    recoveryBeforeCount,
    Date.now(),
  );
  const recoveryText = recoveredRound.assistant.text;
  const recoveryWebsite = await apiCall("getProviderWebsiteSnapshot", provider);
  const recoveryWebsiteText = snapshotText(
    recoveryWebsite.messages.filter((message) => message.role === "assistant").at(-1),
  );
  const stopResult = {
    round: roundDefinitions.length + 1,
    scenario: "stop-and-resend",
    token: recoveryToken,
    assistantStatus: recoveredRound.assistant.status,
    cancelledStatus: cancelledAssistant.status,
    cancelledFailureOrigin: cancelledAssistant.failureOrigin,
    recoveryTextLength: recoveryText.length,
    tokenCount: recoveryText.split(recoveryToken).length - 1,
    endsWithToken: recoveryText.trimEnd().endsWith(recoveryToken),
    aiHubBodyHash: bodyHash(recoveryText),
    websiteBodyHash: bodyHash(recoveryWebsiteText),
    bodyHashMatched:
      Boolean(recoveryWebsiteText) &&
      bodyHash(recoveryText) === bodyHash(recoveryWebsiteText),
  };
  stopResult.passed =
    stopResult.cancelledStatus === "failed" &&
    stopResult.cancelledFailureOrigin === "cancelled" &&
    stopResult.assistantStatus === "completed" &&
    stopResult.tokenCount === 1 &&
    stopResult.endsWithToken &&
    stopResult.bodyHashMatched;
  results.push(stopResult);
  console.log(JSON.stringify(stopResult));
}

const finalState = await readConversation(conversation.id);
const expectedRounds =
  roundDefinitions.length - startRound + 1 + (startRound === 1 ? 1 : 0);
const summary = {
  provider,
  status: "Completed",
  conversationId: conversation.id,
  passed: results.length === expectedRounds &&
    results.every((result) => result.passed),
  completedRounds: results.length,
  expectedRounds,
  startRound,
  finalMessageCount: finalState.messages.length,
  finalUserMessageCount: finalState.messages.filter(
    (message) => message.role === "user",
  ).length,
  finalAssistantMessageCount: finalState.messages.filter(
    (message) => message.role === "assistant",
  ).length,
  results,
};
console.log(`AIHUB_MULTITURN_RESULT=${JSON.stringify(summary)}`);
socket.close();
if (!summary.passed) process.exitCode = 1;

async function captureProviderScreenshot(debugPort, providerUrl) {
  if (!providerUrl) return undefined;
  let origin;
  try {
    origin = new URL(providerUrl).origin;
  } catch {
    return undefined;
  }
  const currentTargets = await fetch(
    `http://127.0.0.1:${debugPort}/json/list`,
  ).then((response) => response.json());
  const providerTarget = currentTargets.find((item) =>
    item.type === "page" &&
    item.webSocketDebuggerUrl &&
    item.url?.startsWith(origin) &&
    item.title !== "AIHub"
  );
  if (!providerTarget) return undefined;
  const providerSocket = new WebSocket(providerTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    providerSocket.addEventListener("open", resolve, { once: true });
    providerSocket.addEventListener("error", reject, { once: true });
  });
  try {
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Provider screenshot timed out."));
      }, 15_000);
      providerSocket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timer);
        resolve(message);
      });
      providerSocket.send(JSON.stringify({
        id: 1,
        method: "Page.captureScreenshot",
        params: {
          format: "png",
          captureBeyondViewport: false,
        },
      }));
    });
    return response.result?.data
      ? Buffer.from(response.result.data, "base64")
      : undefined;
  } finally {
    providerSocket.close();
  }
}

function redactedWebsiteSnapshot(snapshot) {
  return {
    externalId: snapshot.externalId,
    url: snapshot.url,
    scanRounds: snapshot.scanRounds,
    partial: snapshot.partial,
    limitReached: snapshot.limitReached,
    fallbackReason: snapshot.fallbackReason,
    messages: snapshot.messages.map((message) => {
      const text = snapshotText(message);
      return {
        key: message.key,
        role: message.role,
        order: message.order,
        textLength: text.length,
        bodyHash: bodyHash(text),
        contentBlockCount: message.content.length,
        providerHtmlLength: message.providerHtml?.length ?? 0,
      };
    }),
  };
}
