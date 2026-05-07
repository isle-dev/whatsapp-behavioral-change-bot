import { z } from "zod";

// ─── JSON Schema objects for OpenAI structured outputs ───────────────────────
// Zod schemas are used for runtime validation; these are passed to the API.

export const DecisionInputSchema = {
  type: "object",
  properties: {
    send:                { type: "boolean" },
    short_notification:  { type: "string" },
    long_message:        { type: "string" },
    com_b_tags:          { type: "array", items: { type: "string", enum: ["Motivation", "Capability", "Opportunity"] } },
    safety_flags:        { type: "array", items: { type: "string", enum: ["none", "medical_advice", "crisis", "self_harm", "suspicious_request"] } },
    follow_up_in_hours:  { type: "number" },
    reason_codes:        { type: "array", items: { type: "string" } },
    suggested_buttons:   { type: "array", items: { type: "string" } },
    ask:                 { type: "array", items: { type: "string" } },
    log_notes:           { type: "string" },
  },
  required: ["send", "short_notification", "long_message", "com_b_tags", "safety_flags", "follow_up_in_hours", "reason_codes", "suggested_buttons", "ask", "log_notes"],
  additionalProperties: false,
} as const;

export const ChatInputSchema = {
  type: "object",
  properties: {
    message:           { type: "string" },
    com_b_tags:        { type: "array", items: { type: "string", enum: ["Motivation", "Capability", "Opportunity"] } },
    safety_flags:      { type: "array", items: { type: "string", enum: ["none", "medical_advice", "crisis", "self_harm", "suspicious_request"] } },
    suggested_buttons: { type: "array", items: { type: "string" } },
    ask:               { type: "array", items: { type: "string" } },
    log_notes:         { type: "string" },
  },
  required: ["message", "com_b_tags", "safety_flags", "suggested_buttons", "ask", "log_notes"],
  additionalProperties: false,
} as const;

export const DecisionSchema = z.object({
  send: z.boolean(),
  short_notification: z.string(),
  long_message: z.string(),
  com_b_tags: z.array(z.enum(["Motivation", "Capability", "Opportunity"])),
  safety_flags: z.array(z.enum(["none", "medical_advice", "crisis", "self_harm", "suspicious_request"])),
  follow_up_in_hours: z.number(),
  reason_codes: z.array(z.string()),
  suggested_buttons: z.array(z.string()),
  ask: z.array(z.string()),
  log_notes: z.string()
});

export type Decision = z.infer<typeof DecisionSchema>;

export const ChatSchema = z.object({
  message: z.string(),
  com_b_tags: z.array(z.enum(["Motivation", "Capability", "Opportunity"])),
  safety_flags: z.array(z.enum(["none", "medical_advice", "crisis", "self_harm", "suspicious_request"])),
  suggested_buttons: z.array(z.string()).optional().default([]),
  ask: z.array(z.string()).optional().default([]),
  log_notes: z.string()
});

export type Chat = z.infer<typeof ChatSchema>;
