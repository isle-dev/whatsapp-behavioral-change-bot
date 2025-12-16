import { chat } from "../src/services/chatter";

(async () => {
  const out = await chat({
    user_id: "user-123",
    now_iso: new Date().toISOString(),
    local_time: "2025-11-06T12:20:00-05:00",
    user_message: "Can you change my dose to twice a day?",
    last_message: null,
    recent_adherence: { last_7: { taken: 6, missed: 1 }, streak: 3 },
    known_barriers: [],
    preferences: { tone: "friendly", language: "en", name: "Winston" }
  });

  console.log(JSON.stringify(out, null, 2));
})();
