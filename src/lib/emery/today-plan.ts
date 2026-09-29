/* eslint-disable @typescript-eslint/no-explicit-any */
import { getHpoFieldTodayCore } from "@/lib/hpo-field.functions";
import { getActiveFieldSessionCore } from "@/lib/emery-field-session.functions";
import type { FieldSession, TodaysPlan } from "./orchestration.types.ts";

export function localDateKey(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function session(row: any): FieldSession | null {
  if (!row) return null;
  return {
    id: row.id,
    sessionDate: row.session_date,
    status: row.status,
    routeId: row.route_id ?? null,
    currentStopId: row.current_stop_id ?? null,
    expectedNoteStopId: row.expected_note_stop_id ?? null,
    expectedNoteAccountId: row.expected_note_account_id ?? null,
    expectedNoteProspectId: row.expected_note_prospect_id ?? null,
    expectedNoteMeetingId: row.expected_note_meeting_id ?? null,
    optionalProspecting: Boolean(row.optional_prospecting),
  };
}

export async function getTodaysPlanCore(input: {
  db: any;
  userId: string;
  timezone: string;
}): Promise<TodaysPlan> {
  const date = localDateKey(input.timezone);
  const anchor = Date.now();
  const [route, fieldSession, meetingResult] = await Promise.all([
    getHpoFieldTodayCore({ db: input.db, userId: input.userId }),
    getActiveFieldSessionCore({
      db: input.db,
      userId: input.userId,
      sessionDate: date,
    }),
    input.db
      .from("meetings")
      .select("id,title,meeting_at")
      .eq("user_id", input.userId)
      .gte("meeting_at", new Date(anchor - 18 * 60 * 60 * 1000).toISOString())
      .lte("meeting_at", new Date(anchor + 42 * 60 * 60 * 1000).toISOString())
      .order("meeting_at", { ascending: true }),
  ]);
  if (meetingResult.error) throw meetingResult.error;
  const meetings = (meetingResult.data ?? [])
    .filter(
      (row: any) =>
        row.meeting_at && localDateKey(input.timezone, new Date(row.meeting_at)) === date,
    )
    .map((row: any) => ({
      id: row.id,
      title: row.title,
      startsAt: row.meeting_at,
    }));
  return {
    date,
    timezone: input.timezone,
    meetings,
    route: route.route
      ? {
          id: route.route.id,
          completed: Number(route.completed ?? 0),
          remaining: Number(route.remaining ?? 0),
          nextStopId: route.nextStop?.id ?? null,
        }
      : null,
    fieldSession: session(fieldSession),
  };
}
