import { describe, expect, it } from "vitest";
import { collectUrlParams, parseUrlCredentials } from "@/lib/panel-credentials";

const TOKEN = "Kx8Qm2_r-tZ1vB4nS7yH0pL3dC6fA9gJ";

describe("collectUrlParams", () => {
  it("reads the fragment and the query string", () => {
    const params = collectUrlParams("?a=1", "#b=2");
    expect(params.get("a")).toBe("1");
    expect(params.get("b")).toBe("2");
  });

  it("reads a query GHL appended after the fragment", () => {
    const params = collectUrlParams("", `#location=LOC&token=${TOKEN}?userId=42`);
    expect(params.get("userid")).toBe("42");
  });

  it("ignores empty values and lowercases keys", () => {
    const params = collectUrlParams("?Location=LOC&token=", "");
    expect(params.get("location")).toBe("LOC");
    expect(params.has("token")).toBe(false);
  });
});

describe("parseUrlCredentials", () => {
  it("accepts the documented fragment link", () => {
    const result = parseUrlCredentials("", `#location=LOC&token=${TOKEN}`);
    expect(result.credentials).toEqual({ locationId: "LOC", token: TOKEN });
    expect(result.issues).toEqual([]);
  });

  it("accepts the same values in the query string", () => {
    const result = parseUrlCredentials(`?location=LOC&token=${TOKEN}`, "");
    expect(result.credentials).toEqual({ locationId: "LOC", token: TOKEN });
  });

  it("accepts the location_id alias GHL uses", () => {
    const result = parseUrlCredentials(`?location_id=LOC&token=${TOKEN}`, "");
    expect(result.credentials).toEqual({ locationId: "LOC", token: TOKEN });
  });

  it("splits a query GHL appended after the fragment", () => {
    const result = parseUrlCredentials("", `#location=LOC&token=${TOKEN}?userId=42`);
    expect(result.credentials).toEqual({ locationId: "LOC", token: TOKEN });
    expect(result.issues).toEqual([]);
  });

  it("salvages a token with trailing characters outside the base64url alphabet", () => {
    const result = parseUrlCredentials(`?location=LOC&token=${TOKEN}?userId=42`, "");
    expect(result.credentials).toEqual({ locationId: "LOC", token: TOKEN });
    expect(result.issues).toContain("malformed-token");
  });

  it("reports merge tags GHL failed to replace", () => {
    const result = parseUrlCredentials("", "#location=LOC&token={{custom_values.frutitodo_panel_token}}");
    expect(result.credentials).toBeNull();
    expect(result.issues).toContain("unresolved-merge-tag");
    expect(result.issues).toContain("missing-token");
  });

  it("reports percent encoded merge tags", () => {
    const result = parseUrlCredentials("?location=LOC&token=%7B%7Bcustom_values.x%7D%7D", "");
    expect(result.issues).toContain("unresolved-merge-tag");
  });

  it("reports a link that carries no parameter at all", () => {
    const result = parseUrlCredentials("", "");
    expect(result.credentials).toBeNull();
    expect(result.issues).toEqual(["no-parameters"]);
  });

  it("reports which half of the link is missing", () => {
    expect(parseUrlCredentials("?location=LOC", "").issues).toEqual(["missing-token"]);
    expect(parseUrlCredentials(`?token=${TOKEN}`, "").issues).toEqual(["missing-location"]);
  });
});
