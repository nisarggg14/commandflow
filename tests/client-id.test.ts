import assert from "node:assert/strict";
import test from "node:test";

import {
  chatSubmissionErrorMessage,
  createClientId,
} from "../lib/chat-client";

test("client IDs use secure getRandomValues when randomUUID is unavailable", () => {
  const id = createClientId({
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
      return array;
    },
  });

  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("client ID creation fails clearly without a secure randomness API", () => {
  assert.throws(
    () => createClientId(null),
    /Secure random ID generation is unavailable/,
  );
  assert.match(
    chatSubmissionErrorMessage(
      new Error("Secure random ID generation is unavailable in this browser."),
    ),
    /securely create command IDs/,
  );
});

test("command submission failures produce a safe user-facing message", () => {
  assert.equal(
    chatSubmissionErrorMessage(new Error("private network detail")),
    "Unable to submit the command. Please try again.",
  );
});
