export function buildChatUserMsg(payload: {
    user_id: string;
    now_iso: string;
    local_time: string;
    user_message: string;
    last_message: string | null;
    recent_adherence: { last_7: { taken: number; missed: number }; streak: number };
    known_barriers: string[];
    preferences: { tone?: string; language?: string; name?: string };
  }) {
    return `
  TASK: CHAT
  
  Inputs:
  - user_id: ${payload.user_id}
  - now_iso: ${payload.now_iso}
  - local_time: ${payload.local_time}
  - user_message: ${JSON.stringify(payload.user_message)}
  - last_message: ${payload.last_message ?? "null"}
  - recent_adherence: ${JSON.stringify(payload.recent_adherence)}
  - known_barriers: ${JSON.stringify(payload.known_barriers)}
  - preferences: ${JSON.stringify(payload.preferences)}
  
  Required JSON schema:
  {
    "message": string,
    "com_b_tags": ["Motivation"|"Capability"|"Opportunity"...],
    "safety_flags": ["crisis"|"medical_advice"|"self_harm"|"none"...],
    "suggested_buttons": [string],
    "ask": [string],
    "log_notes": string
  }
  
  Rules:
  - You may ask scheduling questions directly if helpful.
  - Stay within scope. If the user asks about dosage or diagnosis, refuse briefly and encourage contacting a clinician.
  - If crisis or self-harm is detected, set a safety flag and craft a supportive, resource-oriented message.
  
  Produce only the JSON.
  `;
  }  