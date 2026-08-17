import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSpeech, generateText } from "./gemini.js";
import { RetryableError } from "./retry.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("generateText returns the joined text parts", async () => {
  const text = await generateText("m", "hello", async () =>
    jsonResponse({ candidates: [{ content: { parts: [{ text: "Hel" }, { text: "lo" }] } }] }),
  );
  assert.equal(text, "Hello");
});

test("generateText posts the prompt to the model's generateContent endpoint", async () => {
  let seenUrl = "";
  let seenBody: unknown;
  let seenKey: string | null = null;

  await generateText("my-model", "prompt text", async (input, init) => {
    seenUrl = String(input);
    seenBody = JSON.parse(String(init?.body));
    seenKey = new Headers(init?.headers).get("x-goog-api-key");
    return jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
  });

  assert.match(seenUrl, /\/v1beta\/models\/my-model:generateContent$/);
  assert.deepEqual(seenBody, { contents: [{ parts: [{ text: "prompt text" }] }] });
  assert.notEqual(seenKey, null);
});

test("generateText throws RetryableError on 429", async () => {
  await assert.rejects(
    generateText("m", "p", async () => jsonResponse({ error: "rate" }, 429)),
    RetryableError,
  );
});

test("generateText throws a plain Error on 400", async () => {
  await assert.rejects(async () => {
    try {
      await generateText("m", "p", async () => jsonResponse({ error: "bad" }, 400));
    } catch (err) {
      assert.ok(!(err instanceof RetryableError));
      throw err;
    }
  });
});

test("generateText rejects an empty completion", async () => {
  await assert.rejects(
    generateText("m", "p", async () => jsonResponse({ candidates: [] })),
    /no text/,
  );
});

test("generateSpeech decodes base64 PCM and sends multiSpeakerVoiceConfig", async () => {
  const pcm = Buffer.from([0, 1, 2, 3]);
  let seenBody: any;

  const result = await generateSpeech(
    "tts-model",
    "Maya: hi",
    [{ name: "Maya", voice: "V1" }, { name: "Daniel", voice: "V2" }],
    async (_input, init) => {
      seenBody = JSON.parse(String(init?.body));
      return jsonResponse({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16", data: pcm.toString("base64") } }] } }],
      });
    },
  );

  assert.deepEqual([...result], [0, 1, 2, 3]);
  assert.deepEqual(seenBody.generationConfig.responseModalities, ["AUDIO"]);
  assert.deepEqual(
    seenBody.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs,
    [
      { speaker: "Maya", voiceConfig: { prebuiltVoiceConfig: { voiceName: "V1" } } },
      { speaker: "Daniel", voiceConfig: { prebuiltVoiceConfig: { voiceName: "V2" } } },
    ],
  );
});

test("generateSpeech rejects odd-length PCM as a truncated response", async () => {
  const odd = Buffer.from([0, 1, 2]);
  await assert.rejects(
    generateSpeech("m", "t", [{ name: "Maya", voice: "V1" }], async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { data: odd.toString("base64") } }] } }] }),
    ),
    /odd-length PCM/,
  );
});

test("generateSpeech rejects a response with no audio part", async () => {
  await assert.rejects(
    generateSpeech("m", "t", [{ name: "Maya", voice: "V1" }], async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] }),
    ),
    /no audio/,
  );
});
