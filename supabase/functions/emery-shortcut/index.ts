import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const USER_ID = "1804c99a-daa7-4b37-86aa-5dffbfa21226";
const EXPECTED_KEY_SHA256 = "6ebd66667eece9cd1b95ac69c06de64afa32fef22fdf8e7225b4eda758dfafbf";
const TIMEZONE = "America/New_York";
const MODEL = Deno.env.get("EMERY_ACTION_MODEL") ?? "gpt-5.6-luna";

const IDENTITY = `You are Emery, Adam's one persistent personal AI companion and second brain. You are warm, sharp, direct, ADHD-friendly, action-oriented, and grounded. There is only one Emery across the app, Apple Shortcut, HPO, Calendar, and Voice. Use the recent conversation as continuity.

SHORTCUT STYLE: respond for listening, usually 1-3 natural sentences. Ask exactly one short follow-up question at a time when required information is missing. Never invent dates, times, people, or completed actions.

CALENDAR/TASK RULES:
- Task List and Calendar are distinct. A task can stay unscheduled in the Task List.
- For tasks, due_at is an optional deadline; scheduled_start_at/scheduled_end_at are the optional Calendar time block; reminder_at is the optional notification time.
- A task may be created unscheduled if Adam explicitly asks to add/save a task without a time.
- If Adam explicitly asks to put/schedule a task on the Calendar, a date and time are required. Ask for whichever key detail is missing. Do not invent a deadline just because the task has a Calendar block.
- When Adam asks what he can do with free time, use unscheduled open tasks, priority, deadlines and estimated duration; do not create or schedule anything unless he asks.
- A meeting/event/lunch requires a title or identifiable person/purpose plus a date and start time. If details are missing, ask one question at a time.
- Event duration matters. If Adam says a range such as "7-11pm" or "7 PM to 11 PM", preserve BOTH times exactly: due_at=start and end_at=end. If he gives a duration such as "for 4 hours", calculate end_at from that duration.
- For task scheduling, use scheduled_start_at and scheduled_end_at, not due_at. If a task has a separate deadline, put that in due_at. Preserve explicit task durations exactly.
- If Adam asks for a notification/reminder tied to a task, put the exact reminder time in reminder_at.
- If Adam gives only a start time for a new event and no end/duration, default end_at to 60 minutes after due_at. Never shorten an explicit range to one hour.
- Standing instruction from Adam: whenever he clearly says he HAS a lunch and supplies enough details for who/purpose plus date and time, that statement itself authorizes create_event. Do not ask for separate permission.
- "Book a lunch" without who/when is incomplete; ask who first, then continue gathering the next missing detail in later turns.
- Only perform a database action when Adam clearly authorizes it with language like add, create, schedule, put on my calendar, mark complete, done, or move/schedule this task.
- If he is merely discussing possibilities, do not write.
- For completing or scheduling an existing task, select only an exact task id from CURRENT OPEN TASKS. If ambiguous, ask.
- If Adam asks to move/reschedule an existing event, use reschedule_event and select only an exact event id from CURRENT CALENDAR EVENTS. If he supplies a new end/duration, use it. If he only changes the start, preserve the existing event duration. If the event or new time is ambiguous, ask one short question.
- When creating a lunch, the title must include the word "Lunch" so the automatic day-before confirmation workflow attaches reliably.
- After a successful action, confirm briefly.
- continue_conversation=true only when you are asking Adam an immediate follow-up question and the Shortcut should listen again.
- continue_conversation=false when the turn is complete.
- Do not claim Apple Calendar sync. This endpoint manages Emery's internal Calendar/Tasks only.

HPO RELATIONSHIP RULES:
- HPO writes are referral-source/account/relationship intelligence only. Never store patient names, DOBs, diagnoses, claim/case identifiers, treatment details, records, or other PHI here.
- Use log_hpo_touch only when Adam clearly asks to log/save a relationship interaction and target exactly one CURRENT HPO ACCOUNT id.
- Use set_hpo_followup only when Adam clearly asks to save a next relationship action for one CURRENT HPO ACCOUNT id.
- If a request includes PHI, do not write it. Ask Adam to restate only the non-PHI relationship update.
- Respect owner/exclusion context in CURRENT HPO ACCOUNTS. If an account is marked for another owner/excluded from Adam's route, ask before changing it unless Adam explicitly overrides that context.
- Discussion such as "I might follow up" is not permission to write.
- Never invent HPO account ids, addresses, contacts, outcomes, or dates.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rpcRow(result: any) {
  const data = result?.data;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text ?? "")
    .join("")
    .trim();
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  try {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);

    const supplied = req.headers.get("x-emery-shortcut-key") ?? "";
    if (!supplied || await sha256(supplied) !== EXPECTED_KEY_SHA256) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message ?? "").trim().slice(0, 4000);
    const shortcutRequestId = String(body?.request_id ?? body?.requestId ?? "").trim().slice(0, 240);
    if (!message) return json({ error: "message is required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !serviceRole || !openaiKey) return json({ error: "Server configuration missing" }, 500);

    const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

    let { data: conversation, error: conversationError } = await db
      .from("conversations")
      .select("id, metadata")
      .eq("user_id", USER_ID)
      .eq("channel", "main")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conversationError) throw conversationError;

    if (!conversation) {
      const created = await db.from("conversations").insert({
        user_id: USER_ID,
        channel: "main",
        title: "Emery",
        metadata: { primary: true, identity: "central-v1" },
      }).select("id, metadata").single();
      if (created.error) throw created.error;
      conversation = created.data;
    }

    const userInsert = await db.from("conversation_messages").insert({
      user_id: USER_ID,
      conversation_id: conversation.id,
      role: "user",
      content: message,
      source_metadata: { entryPoint: "shortcut", inputMode: "dictated", emery_identity: "central-v1" },
    }).select("id, created_at").single();
    if (userInsert.error) throw userInsert.error;

    const nowIso = new Date().toISOString();
    const localNow = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      dateStyle: "full",
      timeStyle: "long",
    }).format(new Date());

    const [profileR, memoriesR, recentR, tasksR, projectsR, meetingsR, hpoR, hpoContactsR, configR] = await Promise.all([
      db.from("profiles").select("display_name, timezone, profile_summary").eq("user_id", USER_ID).maybeSingle(),
      db.from("memories").select("title, content, memory_type, importance, updated_at")
        .eq("user_id", USER_ID).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(16),
      db.from("conversation_messages").select("id, role, content, created_at")
        .eq("user_id", USER_ID).eq("conversation_id", conversation.id).order("created_at", { ascending: false }).limit(20),
      db.from("tasks").select("id, title, details, status, priority, due_at, scheduled_start_at, scheduled_end_at, reminder_at, estimated_minutes, project_id, metadata")
        .eq("user_id", USER_ID).neq("status", "completed").order("priority", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false }).limit(30),
      db.from("projects").select("id, name, status, priority, next_action")
        .eq("user_id", USER_ID).eq("status", "active").order("priority", { ascending: false }).limit(15),
      db.from("meetings").select("id, title, meeting_at, end_at, participants, metadata")
        .eq("user_id", USER_ID).gte("meeting_at", nowIso).order("meeting_at", { ascending: true }).limit(20),
      db.from("hpo_accounts").select("id,name,account_type,city,address,priority,owner_name,relationship_stage,relationship_health,next_action,next_action_due_at,tags,metadata")
        .eq("user_id", USER_ID).eq("status", "active").order("priority", { ascending: false }).limit(40),
      db.from("hpo_contacts").select("id,account_id,name,role_title,relationship_notes")
        .eq("user_id", USER_ID).limit(80),
      db.from("emery_config").select("response_verbosity,memory_max_items,memory_max_characters")
        .eq("user_id", USER_ID).maybeSingle(),
    ]);

    const recent = (recentR.data ?? []).reverse().filter((turn: any) => turn.id !== userInsert.data?.id).slice(-18);
    const memoryMaxItems = Math.min(30, Math.max(6, Number(configR.data?.memory_max_items ?? 16)));
    const memoryMaxCharacters = Math.min(12000, Math.max(2000, Number(configR.data?.memory_max_characters ?? 6500)));
    const memories = (memoriesR.data ?? []).slice(0, memoryMaxItems).map((m: any) => `- [${m.memory_type}] ${m.title ? m.title + ": " : ""}${m.content}`).join("\n").slice(0, memoryMaxCharacters);
    const tasks = tasksR.data ?? [];
    const rollingState = typeof conversation?.metadata?.rolling_state?.summary === "string"
      ? conversation.metadata.rolling_state.summary.slice(0, 5000)
      : "";
    const context = JSON.stringify({
      open_tasks: tasks,
      active_projects: projectsR.data ?? [],
      upcoming_calendar_events: meetingsR.data ?? [],
      hpo_accounts: hpoR.data ?? [],
      hpo_contacts: hpoContactsR.data ?? [],
      learned_config: configR.data ?? {},
    }).slice(0, 22000);

    const input = [
      { role: "system", content: IDENTITY },
      { role: "system", content: `CURRENT LOCAL TIME: ${localNow} (${TIMEZONE}). When resolving relative dates such as today/tomorrow, use this timezone.` },
      { role: "system", content: `PROFILE: ${JSON.stringify(profileR.data ?? {})}` },
      ...(memories ? [{ role: "system", content: `RELEVANT LONG-TERM MEMORY:\n${memories}` }] : []),
      ...(rollingState ? [{ role: "system", content: `WORKING STATE (active threads, commitments, referents; not long-term memory):\n${rollingState}` }] : []),
      { role: "system", content: `CURRENT OPEN TASKS / PROJECTS / CALENDAR / HPO:\n${context}` },
      ...recent.map((turn: any) => ({
        role: turn.role,
        content: [{ type: turn.role === "assistant" ? "output_text" : "input_text", text: turn.content }],
      })),
      { role: "user", content: [{ type: "input_text", text: message }] },
    ];

    const ai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input,
        text: {
          format: {
            type: "json_schema",
            name: "emery_shortcut_turn",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                reply: { type: "string" },
                continue_conversation: { type: "boolean" },
                action: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", enum: ["none", "create_task", "create_event", "complete_task", "schedule_task", "reschedule_event", "log_hpo_touch", "set_hpo_followup"] },
                    title: { type: "string" },
                    details: { type: "string" },
                    due_at: { type: ["string", "null"] },
                    scheduled_start_at: { type: ["string", "null"] },
                    scheduled_end_at: { type: ["string", "null"] },
                    reminder_at: { type: ["string", "null"] },
                    end_at: { type: ["string", "null"] },
                    priority: { type: "integer", minimum: 1, maximum: 5 },
                    participants: { type: "array", items: { type: "string" }, maxItems: 20 },
                    target_task_id: { type: ["string", "null"] },
                    target_hpo_account_id: { type: ["string", "null"] },
                    interaction_type: { type: "string" },
                    outcome: { type: "string" },
                    relationship_signal: { type: "string" },
                    next_action: { type: "string" },
                    contains_phi: { type: "boolean" },
                  },
                  required: ["type", "title", "details", "due_at", "scheduled_start_at", "scheduled_end_at", "reminder_at", "end_at", "priority", "participants", "target_task_id", "target_hpo_account_id", "interaction_type", "outcome", "relationship_signal", "next_action", "contains_phi"],
                },
              },
              required: ["reply", "continue_conversation", "action"],
            },
          },
        },
      }),
    });

    if (!ai.ok) {
      console.error("OpenAI shortcut request failed", ai.status, await ai.text());
      return json({ error: "Emery could not answer right now" }, 502);
    }

    const aiPayload = await ai.json();
    const raw = responseText(aiPayload);
    if (!raw) return json({ error: "Emery returned an empty reply" }, 502);
    const inputTokens = Number(aiPayload?.usage?.input_tokens ?? 0) || 0;
    const outputTokens = Number(aiPayload?.usage?.output_tokens ?? 0) || 0;
    const cachedInputTokens = Number(aiPayload?.usage?.input_tokens_details?.cached_tokens ?? 0) || 0;

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return json({ error: "Emery returned an unreadable reply" }, 502); }

    let reply = String(parsed.reply ?? "").trim();
    let continueConversation = parsed.continue_conversation === true;
    const action = parsed.action ?? { type: "none" };
    let actionTaken: { type: string; id?: string; title?: string; executionRunId?: string } | null = null;

    if (action.type === "create_task") {
      const title = String(action.title ?? "").trim();
      if (!title) return json({ error: "Task title missing" }, 422);
      const dueAt = action.due_at && !Number.isNaN(Date.parse(action.due_at)) ? new Date(action.due_at).toISOString() : null;
      const scheduledStartAt = action.scheduled_start_at && !Number.isNaN(Date.parse(action.scheduled_start_at))
        ? new Date(action.scheduled_start_at).toISOString() : null;
      const scheduledEndAt = action.scheduled_end_at && !Number.isNaN(Date.parse(action.scheduled_end_at))
        ? new Date(action.scheduled_end_at).toISOString() : null;
      const reminderAt = action.reminder_at && !Number.isNaN(Date.parse(action.reminder_at))
        ? new Date(action.reminder_at).toISOString() : null;
      const created = await db.rpc("emery_kernel_task_create", {
        p_user_id: USER_ID,
        p_idempotency_key: shortcutRequestId
          ? `shortcut:${shortcutRequestId}:task.create`
          : `shortcut-message:${userInsert.data.id}:task.create`,
        p_title: title,
        p_details: String(action.details ?? "").trim() || null,
        p_due_at: dueAt,
        p_scheduled_start_at: scheduledStartAt,
        p_scheduled_end_at: scheduledEndAt,
        p_reminder_at: reminderAt,
        p_priority: Math.min(5, Math.max(1, Number(action.priority ?? 3))),
        p_project_id: null,
        p_source_channel: "shortcut",
        p_source_message_id: userInsert.data.id,
        p_parent_run_id: null,
        p_execution_run_id: null,
        p_source: "emery-shortcut",
      });
      if (created.error) throw created.error;
      const receipt = created.data as any;
      if (!receipt?.ok || receipt?.status !== "completed" || !receipt?.task?.id) {
        throw new Error(receipt?.errorMessage || "Task creation failed");
      }
      const row = receipt.task;
      actionTaken = {
        type: "create_task",
        id: row.id,
        title: row.title,
        executionRunId: receipt.executionRunId ?? undefined,
      };
      if (row.scheduled_start_at) {
        const startText = new Date(row.scheduled_start_at).toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" });
        const endText = new Date(row.scheduled_end_at).toLocaleTimeString("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" });
        reply = `Added “${row.title}” to your Task List and Calendar for ${startText}–${endText}.${row.reminder_at ? " The reminder is scheduled too." : ""}`;
      } else if (row.due_at) {
        reply = `Added “${row.title}” to your Task List with its deadline saved.`;
      } else {
        reply = `Added “${row.title}” to your Task List. It stays unscheduled until you choose to time-block it.`;
      }
      continueConversation = false;
    }

    if (action.type === "create_event") {
      const title = String(action.title ?? "").trim();
      const dueAt = action.due_at && !Number.isNaN(Date.parse(action.due_at)) ? new Date(action.due_at).toISOString() : null;
      const parsedEndAt = action.end_at && !Number.isNaN(Date.parse(action.end_at)) ? new Date(action.end_at).toISOString() : null;
      if (!title || !dueAt) {
        reply = reply || "What date and time should I put that on your calendar?";
        continueConversation = true;
      } else {
        const endAt = parsedEndAt && Date.parse(parsedEndAt) > Date.parse(dueAt)
          ? parsedEndAt
          : new Date(Date.parse(dueAt) + 60 * 60 * 1000).toISOString();
        const created = await db.rpc("emery_action_create_event", {
          p_user_id: USER_ID,
          p_title: title,
          p_start_at: dueAt,
          p_end_at: endAt,
          p_participants: Array.isArray(action.participants) ? action.participants.map(String).slice(0, 20) : [],
          p_event_type: /\blunch\b/i.test(title) ? "lunch" : "event",
          p_source: "emery-shortcut",
        });
        if (created.error) throw created.error;
        const row = rpcRow(created);
        if (!row?.id) throw new Error("Event creation returned no record");
        actionTaken = { type: "create_event", id: row.id, title: row.title ?? title };
        const startText = new Date(row.meeting_at).toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" });
        const endText = new Date(row.end_at).toLocaleTimeString("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" });
        reply = /\blunch\b/i.test(title)
          ? `Added “${row.title ?? title}” to your Calendar for ${startText}–${endText}. I also set the day-before lunch confirmation reminder.`
          : `Added “${row.title ?? title}” to your Calendar for ${startText}–${endText}.`;
        continueConversation = false;
      }
    }

    if (action.type === "reschedule_event") {
      const targetId = typeof action.target_task_id === "string" ? action.target_task_id : "";
      const target = (meetingsR.data ?? []).find((meeting: any) => meeting.id === targetId);
      const dueAt = action.due_at && !Number.isNaN(Date.parse(action.due_at)) ? new Date(action.due_at).toISOString() : null;
      const requestedEndAt = action.end_at && !Number.isNaN(Date.parse(action.end_at)) ? new Date(action.end_at).toISOString() : null;
      if (!target) {
        reply = reply || "Which calendar event do you mean?";
        continueConversation = true;
      } else if (!dueAt) {
        reply = reply || "What new day and time should I use?";
        continueConversation = true;
      } else {
        const updated = await db.rpc("emery_action_reschedule_event", {
          p_user_id: USER_ID,
          p_event_id: target.id,
          p_start_at: dueAt,
          p_end_at: requestedEndAt,
        });
        if (updated.error) throw updated.error;
        const row = rpcRow(updated);
        if (!row?.id) throw new Error("Event reschedule returned no record");
        actionTaken = { type: "reschedule_event", id: row.id, title: row.title ?? "Event" };
        const startText = new Date(row.meeting_at).toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" });
        const endText = new Date(row.end_at).toLocaleTimeString("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" });
        reply = `Moved “${row.title ?? "Event"}” to ${startText}–${endText}.`;
        continueConversation = false;
      }
    }

    if (action.type === "complete_task" || action.type === "schedule_task") {
      const targetId = typeof action.target_task_id === "string" ? action.target_task_id : "";
      const target = tasks.find((task: any) => task.id === targetId);
      if (!target) {
        reply = reply || "Which task do you mean?";
        continueConversation = true;
      } else if (action.type === "complete_task") {
        const updated = await db.rpc("emery_action_complete_task", {
          p_user_id: USER_ID,
          p_task_id: target.id,
        });
        if (updated.error) throw updated.error;
        const row = rpcRow(updated);
        if (!row?.id) throw new Error("Task completion returned no record");
        actionTaken = { type: "complete_task", id: row.id, title: row.title };
        continueConversation = false;
      } else {
        const startAt = action.scheduled_start_at && !Number.isNaN(Date.parse(action.scheduled_start_at))
          ? new Date(action.scheduled_start_at).toISOString()
          : action.due_at && !Number.isNaN(Date.parse(action.due_at))
            ? new Date(action.due_at).toISOString()
            : null;
        const endAt = action.scheduled_end_at && !Number.isNaN(Date.parse(action.scheduled_end_at))
          ? new Date(action.scheduled_end_at).toISOString() : null;
        const reminderAt = action.reminder_at && !Number.isNaN(Date.parse(action.reminder_at))
          ? new Date(action.reminder_at).toISOString() : null;
        if (!startAt) {
          reply = reply || "What day and time should I schedule that task?";
          continueConversation = true;
        } else {
          const updated = await db.rpc("emery_action_schedule_task_v2", {
            p_user_id: USER_ID,
            p_task_id: target.id,
            p_start_at: startAt,
            p_end_at: endAt,
            p_reminder_at: reminderAt,
          });
          if (updated.error) throw updated.error;
          const row = rpcRow(updated);
          if (!row?.id) throw new Error("Task scheduling returned no record");
          actionTaken = { type: "schedule_task", id: row.id, title: row.title };
          const startText = new Date(row.scheduled_start_at).toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" });
          const endText = new Date(row.scheduled_end_at).toLocaleTimeString("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" });
          reply = `Scheduled “${row.title}” for ${startText}–${endText}.${row.reminder_at ? " The reminder is scheduled too." : ""}`;
          continueConversation = false;
        }
      }
    }

    if (action.type === "log_hpo_touch" || action.type === "set_hpo_followup") {
      const targetId = typeof action.target_hpo_account_id === "string" ? action.target_hpo_account_id : "";
      const target = (hpoR.data ?? []).find((account: any) => account.id === targetId);
      if (action.contains_phi === true) {
        reply = "I can save the HPO relationship update, but leave out patient-identifying or medical/case details. What non-PHI account update should I save?";
        continueConversation = true;
      } else if (!target) {
        reply = reply || "Which HPO account do you mean?";
        continueConversation = true;
      } else if (Array.isArray(target.tags) && target.tags.includes("exclude_from_adam_route") && !/\b(despite|even though|ownership|i am handling|i'm handling)\b/i.test(message)) {
        reply = `${target.name} is marked as owned by someone else. Do you want me to update that account anyway?`;
        continueConversation = true;
      } else if (action.type === "log_hpo_touch") {
        const summary = String(action.details ?? "").trim();
        if (!summary) {
          reply = `What relationship update should I log for ${target.name}?`;
          continueConversation = true;
        } else {
          const dueAt = action.due_at && !Number.isNaN(Date.parse(action.due_at)) ? new Date(action.due_at).toISOString() : null;
          const logged = await db.rpc("emery_hpo_log_touch", {
            p_user_id: USER_ID,
            p_account_id: target.id,
            p_interaction_type: String(action.interaction_type || "visit"),
            p_summary: summary,
            p_outcome: String(action.outcome || "").trim() || null,
            p_relationship_signal: String(action.relationship_signal || "").trim() || null,
            p_next_action: String(action.next_action || "").trim() || null,
            p_next_action_due_at: dueAt,
            p_source: "emery-shortcut",
          });
          if (logged.error) throw logged.error;
          const row = rpcRow(logged);
          actionTaken = { type: "log_hpo_touch", id: row?.id, title: target.name };
          reply = action.next_action
            ? `Logged the ${target.name} relationship update. Next: ${String(action.next_action).trim()}.`
            : `Logged the ${target.name} relationship update.`;
          continueConversation = false;
        }
      } else {
        const nextAction = String(action.next_action ?? "").trim();
        if (!nextAction) {
          reply = `What should the next action be for ${target.name}?`;
          continueConversation = true;
        } else {
          const dueAt = action.due_at && !Number.isNaN(Date.parse(action.due_at)) ? new Date(action.due_at).toISOString() : null;
          const updated = await db.rpc("emery_hpo_set_followup", {
            p_user_id: USER_ID,
            p_account_id: target.id,
            p_next_action: nextAction,
            p_due_at: dueAt,
            p_source: "emery-shortcut",
          });
          if (updated.error) throw updated.error;
          const row = rpcRow(updated);
          actionTaken = { type: "set_hpo_followup", id: row?.id ?? target.id, title: target.name };
          reply = `Set the next action for ${target.name}: ${nextAction}.`;
          continueConversation = false;
        }
      }
    }

    if (!reply) reply = actionTaken ? "Done." : "Got it.";

    const assistantInsert = await db.from("conversation_messages").insert({
      user_id: USER_ID,
      conversation_id: conversation.id,
      role: "assistant",
      content: reply,
      source_metadata: {
        entryPoint: "emery",
        replyTo: "shortcut",
        emery_identity: "central-v1",
        action_taken: actionTaken,
        continue_conversation: continueConversation,
      },
    }).select("id, created_at").single();
    if (assistantInsert.error) throw assistantInsert.error;

    await db.from("conversations").update({
      metadata: { ...(conversation.metadata ?? {}), identity: "central-v1", last_entry_point: "shortcut" },
      updated_at: new Date().toISOString(),
    }).eq("id", conversation.id).eq("user_id", USER_ID);

    await db.from("emery_runtime_events").insert({
      user_id: USER_ID,
      channel: "shortcut",
      event_type: "emery_turn",
      action: actionTaken?.type ?? action.type ?? "none",
      status: continueConversation ? "clarification" : "ok",
      duration_ms: Date.now() - startedAt,
      model: MODEL,
      metadata: {
        action_taken: actionTaken,
        rolling_state_used: Boolean(rollingState),
        open_task_count: tasks.length,
        hpo_account_count: (hpoR.data ?? []).length,
        hpo_contact_count: (hpoContactsR.data ?? []).length,
        response_verbosity: configR.data?.response_verbosity ?? "concise",
        memory_max_items: memoryMaxItems,
        memory_max_characters: memoryMaxCharacters,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
        userCorrectionSignal: /\b(actually|correction|no[, ]+i meant|i meant|not that|i said|that's wrong|that is wrong|instead)\b/i.test(message),
        userReversalSignal: /\b(undo|revert|cancel that|move it back|put it back|change it back|never mind|nevermind)\b/i.test(message),
      },
    });

    return json({
      reply,
      continue: continueConversation,
      action_taken: actionTaken,
      conversationId: conversation.id,
      messageId: assistantInsert.data?.id ?? null,
    });
  } catch (error) {
    console.error("Emery shortcut function error", error);
    return json({ error: "Emery shortcut failed" }, 500);
  }
});
