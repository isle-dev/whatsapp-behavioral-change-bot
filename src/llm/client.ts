import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./systemPrompt";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type SO = { name: string; schema: unknown };

export async function respondJSON(opts: {
  model?: string;
  userMessage: string;
  jsonSchema: SO;
}) {
  const model = opts.model ?? "gpt-4o-mini";
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: opts.userMessage }
    ],
    // Structured Outputs with JSON Schema
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true }
    }
  });

  // The SDK exposes a convenience property for text, use it for JSON too.
  const raw = (response as any).output_text as string;
  return raw;
}
