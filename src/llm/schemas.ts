import { z } from "zod";

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
