export function buildDecisionUserMsg(payload: {
    user_id: string;
    now_iso: string;
    local_time: string;
    is_quiet_hours: boolean;
    decision_point: "morning" | "evening";
    consecutive_nonresponses: number;
    recent_adherence: { last_7: { taken: number; missed: number }; streak: number };
    last_message: string | null;
    last_user_reply: string | null;
    known_barriers: string[];
    preferences: { tone?: string; language?: string; name?: string };
    windows: { morning_window: string; evening_window: string };
  }) {
    return `
  TASK: DECISION
  
  Inputs:
  - user_id: ${payload.user_id}
  - now_iso: ${payload.now_iso}
  - local_time: ${payload.local_time}
  - is_quiet_hours: ${payload.is_quiet_hours}
  - decision_point: ${payload.decision_point}
  - consecutive_nonresponses: ${payload.consecutive_nonresponses}
  - recent_adherence: ${JSON.stringify(payload.recent_adherence)}
  - last_message: ${payload.last_message ?? "null"}
  - last_user_reply: ${payload.last_user_reply ?? "null"}
  - known_barriers: ${JSON.stringify(payload.known_barriers)}
  - preferences: ${JSON.stringify(payload.preferences)}
  - windows: ${JSON.stringify(payload.windows)}
  
  Decision rules to apply:
  1) If is_quiet_hours is true then do not send, add "quiet_hours" to reason_codes.
  2) If consecutive_nonresponses >= 2 then do not send until next day, add "nonresponse_pause".
  3) Inside active window, favor Motivation first, then Capability, then Opportunity.
  4) If a recent miss occurred or streak dropped, favor a brief motivational nudge plus a simple plan.
  5) Messages must be short and WhatsApp-friendly. Offer 2 to 3 quick-tap replies.
  
  Required JSON schema (return exactly this shape):
  {
    "send": boolean,
    "short_notification": string,
    "long_message": string,
    "com_b_tags": ["Motivation"|"Capability"|"Opportunity"...],
    "safety_flags": ["crisis"|"medical_advice"|"self_harm"|"none"...],
    "follow_up_in_hours": number,
    "reason_codes": [string],
    "suggested_buttons": [string],
    "ask": [string],
    "log_notes": string
  }
  
  Produce only the JSON.
  `;
  }
  