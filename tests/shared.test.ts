import { describe, expect, it } from "vitest";

import { isRecord } from "../src/shared.js";

describe("isRecord", () => {
  it("accepts non-null object records", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it.each([null, [], "value", 1, true, undefined])("rejects non-record value %s", (value) => {
    expect(isRecord(value)).toBe(false);
  });
});
