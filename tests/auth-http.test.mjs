import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { safeEqual, supabaseUrl } = require("../api/_lib/auth");
const { readBearer } = require("../api/_lib/http");

describe("authentication helpers", () => {
  it("compares access codes without accepting prefixes", () => {
    expect(safeEqual("demo-code", "demo-code")).toBe(true);
    expect(safeEqual("demo", "demo-code")).toBe(false);
    expect(safeEqual("", undefined)).toBe(true);
  });

  it("normalizes the configured Supabase URL", () => {
    const previous = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://example.supabase.co/";
    expect(supabaseUrl()).toBe("https://example.supabase.co");
    if (previous === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous;
  });

  it("accepts only a Bearer authorization header", () => {
    expect(readBearer({ headers: { authorization: "Bearer token-123" } })).toBe("token-123");
    expect(readBearer({ headers: { authorization: "Basic token-123" } })).toBe("");
    expect(readBearer({ headers: {} })).toBe("");
  });
});
