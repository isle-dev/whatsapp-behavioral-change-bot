import { buildDecisionUserMsg } from "../llm/decisionPrompt";
import { DecisionSchema } from "../llm/schemas";
import { respondJSON } from "../llm/client";

export async function decide(input: Parameters<typeof buildDecisionUserMsg>[0]) {
  const userMsg = buildDecisionUserMsg(input);
  const raw = await respondJSON({
    userMessage: userMsg,
    jsonSchema: { name: "Decision", schema: DecisionSchema.toJSON() }
  });

  const parsed = DecisionSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Model returned invalid Decision JSON");
  return parsed.data;
}
