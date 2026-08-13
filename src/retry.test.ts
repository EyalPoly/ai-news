import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableStatus, RetryableError, withRetry } from "./retry.js";

test("isRetryableStatus accepts 429 and 5xx only", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(200), false);
});

test("withRetry retries RetryableError and eventually succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new RetryableError("429");
    return "ok";
  }, 3, 1);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry does not retry a plain Error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new Error("bad request");
    }, 3, 1),
    /bad request/,
  );
  assert.equal(calls, 1);
});

test("withRetry rethrows after exhausting attempts", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new RetryableError("still 429");
    }, 3, 1),
    /still 429/,
  );
  assert.equal(calls, 3);
});
