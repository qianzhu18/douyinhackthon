import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { cleanText, cleanWord, readFrameImage, reviewSchedule, normalizeLookupTerm } = require("../api/_lib/learning");

describe("learning data boundaries", () => {
  it("normalizes a complete saved word", () => {
    expect(cleanWord({
      concept: "  coffee-machine  ",
      language: "en",
      text: " coffee machine ",
      meaning: " 咖啡机 ",
      detail: { cefr: "A2" }
    })).toEqual({
      concept: "coffee-machine",
      language: "en",
      text: "coffee machine",
      meaning: "咖啡机",
      detail: { cefr: "A2" }
    });
  });

  it("rejects unsupported languages and incomplete words", () => {
    expect(cleanWord({ concept: "cup", language: "fr", text: "tasse", meaning: "杯子" })).toBeNull();
    expect(cleanWord({ concept: "cup", language: "en", text: "", meaning: "杯子" })).toBeNull();
  });

  it("trims and caps user-controlled text", () => {
    expect(cleanText(`  ${"x".repeat(20)}  `, 8)).toBe("xxxxxxxx");
    expect(cleanText(null, 8)).toBe("");
  });

  it("accepts JPEG frame data and rejects oversized frames", () => {
    const frame = readFrameImage(`data:image/jpeg;base64,${Buffer.from("frame").toString("base64")}`);
    expect(frame.mimeType).toBe("image/jpeg");
    expect(frame.extension).toBe("jpg");
    expect(() => readFrameImage(`data:image/jpeg;base64,${Buffer.alloc(1024 * 1024 + 1).toString("base64")}`))
      .toThrow("截图不能超过 1MB");
  });

  it("uses spaced repetition intervals with a 60-day cap", () => {
    expect([1, 2, 3, 4, 5, 99].map(reviewSchedule)).toEqual([3, 7, 14, 30, 60, 60]);
  });

  it("normalizes a selected sentence term without swallowing punctuation", () => {
    expect(normalizeLookupTerm("  “twinkling,” ")).toBe("twinkling");
    expect(normalizeLookupTerm(" indoor   setting ")).toBe("indoor setting");
    expect(normalizeLookupTerm("...")).toBe("");
  });
});
