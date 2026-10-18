import assert from "node:assert/strict";
import { test } from "node:test";
import { redactVisionPersonalData } from "./visionPolicy";

test("vision output redacts contact and government identifiers", () => {
  for (const value of ["a.person+photos@example.com", "+1 (206) 555-0199", "206-555-0199", "123-45-6789", "123456789", "4111 1111 1111 1111", "127.0.0.1", "1990-01-02", "01/02/1990", "sk-testplaceholder123456789"]) {
    const result = redactVisionPersonalData(`Visible text: ${value}.`);
    assert.equal(result.includes(value), false, value);
    assert.match(result, /\[redacted/);
  }
  assert.equal(redactVisionPersonalData("3 chairs, 2026, 128 by 128 pixels."), "3 chairs, 2026, 128 by 128 pixels.");
});
