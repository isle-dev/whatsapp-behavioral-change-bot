import { decide } from "../src/services/decider";

(async () => {
  const out = await decide({
    user_id: "user-123",
    now_iso: new Date().toISOString(),
    local_time: "2025-11-06T08:15:00-05:00",
    is_quiet_hours: false,
    decision_point: "morning",
    consecutive_nonresponses: 0,
    recent_adherence: { last_7: { taken: 5, missed: 2 }, streak: 1 },
    last_message: null,
    last_user_reply: null,
    known_barriers: ["forgetfulness"],
    preferences: { tone: "friendly", language: "en", name: "Winston" },
    windows: { morning_window: "07:00-09:00", evening_window: "18:00-20:00" }
  });

  console.log(JSON.stringify(out, null, 2));
})();
