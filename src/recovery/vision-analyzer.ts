import type { ElementBox } from "../types.js";

export interface VisionRequest {
  screenshotPngBase64: string;
  boxes: ElementBox[];
  fieldDescription: string;
  fieldName: string;
}

export interface VisionAnswer {
  /** Index into `boxes`, or null if the model could not find the field. */
  idx: number | null;
  confidence: number;
  reason: string;
}

/** A pluggable "ask the vision model" function so tests never need a real API call. */
export type VisionBackend = (req: VisionRequest) => Promise<VisionAnswer>;

export interface VisionAnalyzerOptions {
  apiKey?: string;
  model?: string;
  backend?: VisionBackend;
}

function buildPrompt(req: VisionRequest): string {
  const list = req.boxes
    .map((b) => `${b.idx}: <${b.tag}> "${b.text}" at (${b.x},${b.y}) size ${b.width}x${b.height}`)
    .join("\n");
  return [
    `You are looking at a screenshot of a web page.`,
    `Find the element that shows this field: "${req.fieldName}" — ${req.fieldDescription}.`,
    `Here are candidate elements already detected on the page, numbered:`,
    list || "(no candidates were pre-detected; look at the screenshot directly)",
    ``,
    `Reply with ONLY a JSON object: {"idx": <number or null>, "confidence": <0 to 1>, "reason": "<short reason>"}.`,
    `Use null for idx if none of the candidates (or nothing visible) matches.`,
  ].join("\n");
}

/** Default backend: calls the OpenAI Chat Completions API with a vision-capable model. */
function createOpenAiBackend(apiKey: string, model: string): VisionBackend {
  return async (req) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(req) },
              { type: "image_url", image_url: { url: `data:image/png;base64,${req.screenshotPngBase64}` } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Vision API request failed with status ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return parseVisionReply(text);
  };
}

export function parseVisionReply(text: string): VisionAnswer {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<VisionAnswer>;
    const idx = typeof parsed.idx === "number" ? parsed.idx : null;
    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    return { idx, confidence, reason };
  } catch {
    return { idx: null, confidence: 0, reason: "Could not parse the vision model's reply." };
  }
}

export class VisionAnalyzer {
  private backend: VisionBackend | null;

  constructor(options: VisionAnalyzerOptions) {
    if (options.backend) {
      this.backend = options.backend;
    } else if (options.apiKey) {
      this.backend = createOpenAiBackend(options.apiKey, options.model ?? "gpt-4o");
    } else {
      this.backend = null;
    }
  }

  get available(): boolean {
    return this.backend !== null;
  }

  async analyze(req: VisionRequest): Promise<VisionAnswer> {
    if (!this.backend) return { idx: null, confidence: 0, reason: "Vision recovery is not configured." };
    try {
      return await this.backend(req);
    } catch (err) {
      return { idx: null, confidence: 0, reason: err instanceof Error ? err.message : "Vision request failed." };
    }
  }
}
