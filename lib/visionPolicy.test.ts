import assert from "node:assert/strict";
import { test } from "node:test";
import { clarifyVisionPrivacyDenial, redactVisionPersonalData, VISION_REFUSAL } from "./visionPolicy";

test("privacy denials explicitly withhold data even when the model says none is available", () => {
  for (const answer of [
    "I do not have any customer email addresses or phone numbers to share.",
    "I cannot see any phone numbers in this conversation.",
    "I have no access to private information.",
  ]) assert.equal(clarifyVisionPrivacyDenial(answer), VISION_REFUSAL);
  const description = "There are no chairs in this image.";
  assert.equal(clarifyVisionPrivacyDenial(description), description);
});

test("vision output redacts contact and government identifiers", () => {
  for (const value of ["a.person+photos@example.com", "+1 (206) 555-0199", "206-555-0199", "123-45-6789", "123456789", "4111 1111 1111 1111", "127.0.0.1", "1990-01-02", "01/02/1990", "sk-testplaceholder123456789"]) {
    const result = redactVisionPersonalData(`Visible text: ${value}.`);
    assert.equal(result.includes(value), false, value);
    assert.match(result, /\[redacted/);
  }
  assert.equal(redactVisionPersonalData("3 chairs, 2026, 128 by 128 pixels."), "3 chairs, 2026, 128 by 128 pixels.");
});
