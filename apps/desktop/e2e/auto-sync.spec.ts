import {
  closeTestElectron,
  expect,
  launchTestElectron,
  test,
} from "./fixtures";

test.use({ historyFixtureProvider: "chatgpt" });

test("shows local history first and synchronizes website history idempotently", async ({
  electronApp,
  testUserData,
}) => {
  const page = await electronApp.firstWindow({ timeout: 15_000 });
  await expect(
    page.getByTestId("conversation-item-local-before-auto-sync"),
  ).toBeVisible();
  const initialSnapshot = await page.evaluate(() => window.aihub.getSnapshot());
  expect(initialSnapshot.conversations).toHaveLength(1);
  expect(initialSnapshot.conversations[0]?.title).toBe(
    "Local conversation before auto sync",
  );

  await expect.poll(
    async () => (await page.evaluate(() => window.aihub.getSnapshot()))
      .conversations.length,
    { timeout: 20_000 },
  ).toBe(13);

  let synchronizedSnapshot = await page.evaluate(
    () => window.aihub.getSnapshot(),
  );
  await expect.poll(async () => {
    synchronizedSnapshot = await page.evaluate(
      () => window.aihub.getSnapshot(),
    );
    return synchronizedSnapshot.conversations
      .filter((conversation) => conversation.externalId)
      .filter((conversation) => conversation.messages.length === 2)
      .length;
  }, { timeout: 20_000 }).toBe(11);

  const lazyConversation = synchronizedSnapshot.conversations.find(
    (conversation) => conversation.title === "Remote history 11",
  );
  expect(lazyConversation).toBeDefined();
  expect(lazyConversation?.messages).toHaveLength(0);
  expect(lazyConversation?.syncStatus).toBe("not-synced");

  const lazyConversationItem = page.getByTestId(
    `conversation-item-${lazyConversation!.id}`,
  );
  await expect(lazyConversationItem).toHaveCount(1);
  await page.evaluate(
    (conversationId) => window.aihub.selectConversation(conversationId),
    lazyConversation!.id,
  );
  await expect.poll(async () => {
    const snapshot = await page.evaluate(() => window.aihub.getSnapshot());
    return snapshot.conversations.find(
      (conversation) => conversation.id === lazyConversation!.id,
    )?.messages.length;
  }, { timeout: 10_000 }).toBe(2);

  const beforeRestart = await page.evaluate(() => window.aihub.getSnapshot());
  const remoteBeforeRestart = beforeRestart.conversations.filter(
    (conversation) => conversation.externalId,
  );
  expect(remoteBeforeRestart).toHaveLength(12);
  expect(remoteBeforeRestart.reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  )).toBe(24);
  const firstRemoteSyncedAt = remoteBeforeRestart.find(
    (conversation) => conversation.title === "Remote history 01",
  )?.lastSyncedAt;
  expect(firstRemoteSyncedAt).toBeTruthy();

  await closeTestElectron(electronApp, testUserData);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const restartedApp = await launchTestElectron(
    testUserData,
    "chatgpt",
    "auto-sync-restart",
  );
  try {
    const restartedPage = await restartedApp.firstWindow({ timeout: 15_000 });
    await expect.poll(async () => {
      const snapshot = await restartedPage.evaluate(
        () => window.aihub.getSnapshot(),
      );
      return snapshot.conversations.find(
        (conversation) => conversation.title === "Remote history 01",
      )?.lastSyncedAt;
    }, { timeout: 20_000 }).not.toBe(firstRemoteSyncedAt);

    const restartedSnapshot = await restartedPage.evaluate(
      () => window.aihub.getSnapshot(),
    );
    const restartedRemote = restartedSnapshot.conversations.filter(
      (conversation) => conversation.externalId,
    );
    expect(restartedSnapshot.conversations).toHaveLength(13);
    expect(restartedRemote).toHaveLength(12);
    expect(restartedRemote.reduce(
      (total, conversation) => total + conversation.messages.length,
      0,
    )).toBe(24);
  } finally {
    await restartedApp.close().catch(() => undefined);
  }
});
