import { GEMINI_API_KEY } from "./config.js";
import { isRetryableStatus, RetryableError } from "./retry.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface Speaker {
  name: string;
  voice: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

async function callGemini(
  model: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<GeminiResponse> {
  const response = await fetchImpl(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = `gemini ${model}: ${response.status} ${response.statusText} ${detail.slice(0, 300)}`;
    if (isRetryableStatus(response.status)) throw new RetryableError(message);
    throw new Error(message);
  }

  return (await response.json()) as GeminiResponse;
}

function parts(data: GeminiResponse): GeminiPart[] {
  return data.candidates?.[0]?.content?.parts ?? [];
}

export async function generateText(
  model: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const data = await callGemini(model, { contents: [{ parts: [{ text: prompt }] }] }, fetchImpl);
  const text = parts(data)
    .map((p) => p.text ?? "")
    .join("");
  if (text.trim() === "") throw new Error(`gemini ${model} returned no text`);
  return text;
}

export async function generateSpeech(
  model: string,
  transcript: string,
  speakers: readonly Speaker[],
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const data = await callGemini(
    model,
    {
      contents: [{ parts: [{ text: transcript }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakers.map((s) => ({
              speaker: s.name,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
            })),
          },
        },
      },
    },
    fetchImpl,
  );

  const encoded = parts(data).find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!encoded) throw new Error(`gemini ${model} returned no audio data`);

  const pcm = Buffer.from(encoded, "base64");
  // 16-bit samples: an odd length means a truncated response, and every sample
  // after that point would be byte-shifted into noise. Guarding per chunk means
  // the concatenation in tts.ts is even by construction.
  if (pcm.length % 2 !== 0) {
    throw new Error(`gemini ${model} returned odd-length PCM (${pcm.length} bytes) — truncated`);
  }
  return pcm;
}
