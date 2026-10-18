import assert from "node:assert/strict";
import { test } from "node:test";
import { alertIsDue } from "./alerts";
import { config } from "./config";
import { connectionCode, connectionMessage } from "./notifications";

test("alerts: photos of you wait two minutes, then the grouped count is due", () => {
  assert.equal(config.alertDebounceMs, 2 * 60 * 1000);
  const start = new Date("2026-10-18T12:00:00Z");
  const guest = { pendingPhotoAlerts: 4, pendingMentionAlerts: 1, alertBatchStartedAt: start };
  assert.equal(alertIsDue(guest, start.getTime() + config.alertDebounceMs - 1), false);
  assert.equal(alertIsDue(guest, start.getTime() + config.alertDebounceMs), true);
  assert.equal(alertIsDue({ pendingPhotoAlerts: 0, pendingMentionAlerts: 0, alertBatchStartedAt: start }, start.getTime() + config.alertDebounceMs), false);
  assert.equal(alertIsDue({ pendingPhotoAlerts: 2, pendingMentionAlerts: 0 }, start.getTime()), true);
});

test("notifications: reconnecting shows the same message for the same number", () => {
  const message = connectionMessage("guest-a", "+12065550101");
  assert.equal(connectionMessage("guest-a", "+12065550101"), message);
  assert.match(message, /^connect [A-Za-z0-9_-]{16}$/);
  assert.equal(connectionCode("guest-a", "+12065550101"), message.slice("connect ".length));
  assert.notEqual(connectionMessage("guest-a", "+12065550102"), message);
  assert.notEqual(connectionMessage("guest-b", "+12065550101"), message);
});
