import { buildChatUserMsg } from "../llm/chatPrompt";
import { ChatSchema } from "../llm/schemas";
import { respondJSON } from "../llm/client";

export async function chat(input: Parameters<typeof buildChatUserMsg>[0]) {
  const userMsg = buildChatUserMsg(input);
  const raw = await respondJSON({
    userMessage: userMsg,
    jsonSchema: { name: "Chat", schema: ChatSchema.toJSON() }
  });

  const parsed = ChatSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Model returned invalid Chat JSON");
  return parsed.data;
}
