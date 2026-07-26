import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase, DATABASE_SCHEMA_VERSION } from "../src/main/database";

describe("AppDatabase schema compatibility", () => {
  it("refuses to downgrade a database created by a newer AIHub version", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "aihub-schema-test-"),
    );
    const databasePath = path.join(directory, "aihub.sqlite");
    try {
      const newer = new DatabaseSync(databasePath);
      newer.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
      newer.close();

      expect(() => new AppDatabase(databasePath)).toThrow(
        /requires a newer AIHub version/i,
      );
      const inspection = new DatabaseSync(databasePath, { readOnly: true });
      expect(
        (
          inspection.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(DATABASE_SCHEMA_VERSION + 1);
      inspection.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
