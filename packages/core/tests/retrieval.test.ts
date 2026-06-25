import { describe, expect, it } from "vitest";
import {
  buildKnowledgeContext,
  retrieveRelevantChunks,
} from "../src";

describe("local knowledge retrieval", () => {
  const documents = [
    {
      id: "battery",
      name: "battery.md",
      content:
        "Lithium metal batteries can form dendrites.\n\nSolid electrolytes may improve safety.",
    },
    {
      id: "unrelated",
      name: "cooking.md",
      content: "Bread fermentation depends on yeast and temperature.",
    },
  ];

  it("ranks relevant chunks above unrelated text", () => {
    const chunks = retrieveRelevantChunks(
      "How can solid electrolytes improve battery safety?",
      documents,
    );
    expect(chunks[0]?.documentId).toBe("battery");
  });

  it("injects only retrieved context before the user query", () => {
    const result = buildKnowledgeContext("battery dendrites", documents);
    expect(result).toContain("battery.md");
    expect(result.endsWith("battery dendrites")).toBe(true);
  });
});
