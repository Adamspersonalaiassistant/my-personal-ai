/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureJarvisAgent,
  ensureJarvisThread,
  handleJarvisTurn,
  jarvisStatusPanel,
  loadJarvisMessages,
} from "@/lib/jarvis/room";

export const getJarvisRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    const thread = await ensureJarvisThread(db, context.userId, agent.id);
    const messages = await loadJarvisMessages(db, context.userId, thread.id);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        mission: agent.mission,
      },
      threadId: thread.id,
      messages,
    };
  });

export const getJarvisStatusPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => jarvisStatusPanel(context.supabase as any, context.userId));

export const sendJarvisMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { message: string }) => {
    const message = String(input?.message ?? "").trim();
    if (!message) throw new Error("Message is required");
    if (message.length > 8000) throw new Error("Message is too long");
    return { message };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    return handleJarvisTurn(db, context.userId, agent, data.message);
  });
