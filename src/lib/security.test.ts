import { describe, expect, it } from "vitest";
import { hashEmbedToken, readBearerToken, safeEqual } from "@/lib/security";

describe("security helpers", () => {
  it("compares secrets without leaking length", () => {
    expect(safeEqual("correct", "correct")).toBe(true);
    expect(safeEqual("correct", "wrong")).toBe(false);
    expect(safeEqual("a", "a much longer secret")).toBe(false);
  });

  it("parses one strict bearer token", () => {
    expect(readBearerToken(new Request("https://example.test", { headers: { Authorization: "Bearer token-1" } }))).toBe("token-1");
    expect(readBearerToken(new Request("https://example.test", { headers: { Authorization: "Basic token-1" } }))).toBeNull();
    expect(readBearerToken(new Request("https://example.test", { headers: { Authorization: "Bearer a b" } }))).toBeNull();
  });

  it("creates stable peppered token hashes", () => {
    expect(hashEmbedToken("token", "pepper")).toHaveLength(64);
    expect(hashEmbedToken("token", "pepper")).not.toBe(hashEmbedToken("token", "other"));
  });
});
