/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ChatAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  attachments: ChatAttachment[];
};

async function getOrCreateMainConversation(supabase: any, userId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("channel", "main")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as { id: string; metadata: unknown };

  const { data: latest, error: latestError } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("channel", "app")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  if (latest) {
    const metadata = {
      ...(latest.metadata && typeof latest.metadata === "object" ? latest.metadata : {}),
      primary: true,
    };
    const { data: promoted, error: promoteError } = await supabase
      .from("conversations")
      .update({ channel: "main", title: "Emery", metadata, updated_at: new Date().toISOString() })
      .eq("id", latest.id)
      .eq("user_id", userId)
      .select("id, metadata")
      .single();
    if (promoteError) throw promoteError;
    return promoted as { id: string; metadata: unknown };
  }

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({ user_id: userId, channel: "main", title: "Emery", metadata: { primary: true } })
    .select("id, metadata")
    .single();
  if (createError || !created) throw createError ?? new Error("Could not create main conversation");
  return created as { id: string; metadata: unknown };
}

async function signAttachmentRows(supabase: any, rows: any[]) {
  const signed = await Promise.all(
    rows.map(async (row) => {
      const { data } = await supabase.storage
        .from("emery-attachments")
        .createSignedUrl(row.storage_path, 600);
      return {
        messageId: row.message_id as string,
        attachment: {
          id: row.id as string,
          fileName: row.file_name as string,
          mimeType: row.mime_type as string,
          sizeBytes: Number(row.size_bytes ?? 0),
          url: data?.signedUrl ?? null,
        } satisfies ChatAttachment,
      };
    }),
  );

  const byMessage = new Map<string, ChatAttachment[]>();
  for (const item of signed) {
    const existing = byMessage.get(item.messageId) ?? [];
    existing.push(item.attachment);
    byMessage.set(item.messageId, existing);
  }
  return byMessage;
}

export const getMainConversationPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { beforeCreatedAt?: string | null; limit?: number }) => ({
    beforeCreatedAt:
      typeof input?.beforeCreatedAt === "string" && !Number.isNaN(Date.parse(input.beforeCreatedAt))
        ? input.beforeCreatedAt
        : null,
    limit: Math.min(100, Math.max(20, Number(input?.limit ?? 80))),
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const conversation = await getOrCreateMainConversation(db, context.userId);

    let query = db
      .from("conversation_messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .eq("conversation_id", conversation.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(data.limit + 1);

    if (data.beforeCreatedAt) query = query.lt("created_at", data.beforeCreatedAt);

    const { data: rawRows, error } = await query;
    if (error) throw error;

    const hasMore = (rawRows ?? []).length > data.limit;
    const pageRows = (rawRows ?? []).slice(0, data.limit).reverse();
    const messageIds = pageRows.map((row: any) => row.id as string);

    const { data: attachmentRows, error: attachmentError } = messageIds.length
      ? await db
          .from("message_attachments")
          .select("id, message_id, storage_path, file_name, mime_type, size_bytes, created_at")
          .eq("user_id", context.userId)
          .eq("conversation_id", conversation.id)
          .in("message_id", messageIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (attachmentError) throw attachmentError;

    const attachmentsByMessage = await signAttachmentRows(db, attachmentRows ?? []);
    const messages: StoredMessage[] = pageRows.map((row: any) => ({
      id: row.id as string,
      role: row.role as "user" | "assistant",
      text: String(row.content ?? ""),
      createdAt: row.created_at as string,
      attachments: attachmentsByMessage.get(row.id) ?? [],
    }));

    return {
      conversationId: conversation.id,
      messages,
      hasMore,
      nextCursor: hasMore && messages.length ? messages[0]?.createdAt ?? null : null,
    };
  });
