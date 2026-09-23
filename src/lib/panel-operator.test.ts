import { describe, expect, it } from "vitest";
import { normalizeOperator, operatorFromUrl } from "@/lib/panel-operator";

describe("operator from the menu link", () => {
  it("reads the GHL user name passed in the link", () => {
    expect(operatorFromUrl("?location=l&token=t&user=Isabel%20Quintero", "")).toBe("Isabel Quintero");
  });

  it("ignores a merge tag GHL left unresolved", () => {
    expect(operatorFromUrl("?user={{user.name}}", "")).toBeNull();
  });

  it("collapses whitespace and caps the length", () => {
    expect(normalizeOperator("  María   Isabel  ")).toBe("María Isabel");
    expect(normalizeOperator("x".repeat(200))).toHaveLength(80);
    expect(normalizeOperator("   ")).toBeNull();
  });
});
