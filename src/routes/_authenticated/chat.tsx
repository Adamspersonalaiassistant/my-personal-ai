import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, FileText, Mic, Paperclip, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import brainImage from "@/assets/neural-brain.png";
import { supabase } from "@/integrations/supabase/client";
import { getMainConversation, sendEmeryMessage } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  component: Chat,
});

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  attachments: Attachment[];
};

const quickPrompts = [
  "What should I focus on?",
  "What do I have going on?",
  "Help me think this through",
];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COMBINED_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 5;

function cleanAssistantText(text: string) {
  return text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function isImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  if (isImage(attachment.mimeType) && attachment.url) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-2xl border border-white/10 bg-black/15"
      >
        <img
          src={attachment.url}
          alt={attachment.fileName}
          className="max-h-56 w-full object-cover"
        />
      </a>
    );
  }

  const content = (
    <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-black/15 px-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
        <FileText className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{attachment.fileName}</p>
        <p className="mt-0.5 text-[10px] opacity-70">{formatBytes(attachment.sizeBytes)}</p>
      </div>
    </div>
  );

  return attachment.url ? (
    <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
      {content}
    </a>
  ) : (
    content
  );
}

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const askEmery = useServerFn(sendEmeryMessage);
  const loadMain = useServerFn(getMainConversation);

  async function refreshMain() {
    const result = await loadMain({});
    setMessages((result?.messages ?? []) as Message[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadMain({});
        if (!cancelled) setMessages((result?.messages ?? []) as Message[]);
      } catch {
        if (!cancelled) setError("Couldn't open your Emery conversation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMain]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: pending ? "smooth" : "auto" });
  }, [messages, pending]);

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const next = [...selectedFiles, ...incoming].slice(0, MAX_FILES);
    const tooLarge = next.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setError(`${tooLarge.name} is larger than 25 MB.`);
      return;
    }
    const combined = next.reduce((sum, file) => sum + file.size, 0);
    if (combined > MAX_COMBINED_BYTES) {
      setError("Keep attachments under 40 MB total per message.");
      return;
    }
    setError(null);
    setSelectedFiles(next);
  }

  async function uploadFiles() {
    if (!selectedFiles.length) return [];
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Please sign in again before attaching files.");

    const uploaded: Array<{
      storagePath: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }> = [];

    for (const file of selectedFiles) {
      const safeName = sanitizeFileName(file.name || "attachment");
      const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("emery-attachments")
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });
      if (uploadError) throw new Error(`Couldn't upload ${file.name}. ${uploadError.message}`);
      uploaded.push({
        storagePath,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
    }
    return uploaded;
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if ((!clean && selectedFiles.length === 0) || pending) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticAttachments: Attachment[] = selectedFiles.map((file, index) => ({
      id: `${tempId}-${index}`,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      url: isImage(file.type) ? URL.createObjectURL(file) : null,
    }));

    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        text: clean,
        createdAt: new Date().toISOString(),
        attachments: optimisticAttachments,
      },
    ]);
    setDraft("");
    setError(null);
    setPending(true);

    try {
      const uploaded = await uploadFiles();
      const result = await askEmery({ data: { message: clean, attachments: uploaded } });
      if (!("reply" in result) || !result.reply) {
        throw new Error(("error" in result && result.error) || "Something went wrong.");
      }

      const serverUser = "userMessage" in result ? result.userMessage : null;
      const serverAssistant = "assistantMessage" in result ? result.assistantMessage : null;
      setMessages((prev) => {
        const withoutTemp = prev.filter((message) => message.id !== tempId);
        const additions: Message[] = [];
        if (serverUser) additions.push(serverUser as Message);
        else {
          additions.push({
            id: tempId,
            role: "user",
            text: clean,
            createdAt: new Date().toISOString(),
            attachments: optimisticAttachments,
          });
        }
        if (serverAssistant) additions.push(serverAssistant as Message);
        else {
          additions.push({
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: result.reply,
            createdAt: new Date().toISOString(),
            attachments: [],
          });
        }
        return [...withoutTemp, ...additions];
      });
      setSelectedFiles([]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn't send your message. Please try again.",
      );
      try {
        await refreshMain();
      } catch {
        // Keep the optimistic message if refreshing also fails.
      }
    } finally {
      setPending(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    await sendMessage(draft);
  }

  return (
    <AppShell title="Emery" padded={false}>
      <div className="relative flex min-h-[calc(100dvh-132px)] flex-col">
        <div className="flex items-center justify-center border-b border-border/40 bg-background/40 px-4 py-2.5 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-center">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_12px_oklch(0.78_0.19_154/0.8)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Main conversation • Memory online
            </span>
          </div>
        </div>

        <div className="emery-scrollbar flex-1 overflow-y-auto px-4 pb-5 pt-5 sm:px-6">
          {loading ? (
            <div className="flex min-h-[48vh] items-center justify-center">
              <p className="text-sm text-muted-foreground">Opening Emery…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex min-h-[54vh] max-w-md flex-col items-center justify-center py-8 text-center">
              <div className="relative">
                <div className="absolute inset-3 rounded-full bg-primary/20 blur-3xl" />
                <div className="emery-breathe relative flex size-28 items-center justify-center overflow-hidden rounded-[2rem] border border-primary/20 bg-primary/[0.05]">
                  <img
                    src={brainImage}
                    alt="Emery neural brain"
                    className="h-24 w-24 object-cover"
                  />
                </div>
              </div>
              <div className="mt-6 flex items-center gap-2 text-primary">
                <Sparkles className="size-4" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                  Emery online
                </span>
              </div>
              <h2 className="emery-text-gradient mt-3 text-2xl font-semibold tracking-tight">
                I’m here, Adam.
              </h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                Same conversation. Same Emery. What are we working through?
              </p>
              <div className="mt-7 flex w-full flex-wrap justify-center gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    className="min-h-11 rounded-2xl border border-border/60 bg-card/60 px-3.5 text-xs font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-primary/[0.07] hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end pl-8">
                    <div className="max-w-[88%] rounded-[1.35rem] rounded-br-md bg-[linear-gradient(145deg,oklch(0.72_0.18_154),oklch(0.56_0.15_157))] px-3.5 py-3 text-[15px] leading-6 text-[oklch(0.11_0.025_158)] shadow-[0_10px_30px_oklch(0.3_0.1_158/0.18)]">
                      {message.attachments.length ? (
                        <div
                          className={`grid gap-2 ${message.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
                        >
                          {message.attachments.map((attachment) => (
                            <AttachmentCard key={attachment.id} attachment={attachment} />
                          ))}
                        </div>
                      ) : null}
                      {message.text ? (
                        <p
                          className={
                            message.attachments.length
                              ? "mt-2.5 whitespace-pre-wrap"
                              : "whitespace-pre-wrap"
                          }
                        >
                          {message.text}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="flex items-start gap-2.5 pr-4">
                    <div className="mt-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.05]">
                      <img src={brainImage} alt="" className="size-7 object-cover" />
                    </div>
                    <div className="emery-glass max-w-[88%] whitespace-pre-wrap rounded-[1.35rem] rounded-tl-md px-4 py-3 text-[15px] leading-6 text-foreground">
                      {cleanAssistantText(message.text)}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {pending ? (
            <div className="mt-5 flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.05]">
                <img src={brainImage} alt="" className="size-7 object-cover" />
              </div>
              <div className="emery-glass flex min-h-11 items-center gap-2 rounded-2xl px-4 text-xs text-muted-foreground">
                <span>Emery is thinking</span>
                <span className="flex items-center gap-1">
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="mt-4 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 z-20 bg-[linear-gradient(180deg,transparent,oklch(0.11_0.022_158/0.98)_18%)] px-3 pb-3 pt-5 sm:px-4">
          {selectedFiles.length ? (
            <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto pb-1">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${file.lastModified}-${index}`}
                  className="emery-glass flex min-w-[150px] max-w-[220px] items-center gap-2 rounded-2xl px-2.5 py-2"
                >
                  {isImage(file.type) ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="size-9 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FileText className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">{file.name}</p>
                    <p className="text-[9px] text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                    }
                    className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <form
            onSubmit={send}
            className="emery-glass mx-auto flex max-w-3xl items-end gap-1.5 rounded-[1.6rem] p-2"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,.docx,.xlsx,.xls"
              onChange={(event) => {
                chooseFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach photos or files"
              title="Attach photos or files"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition hover:bg-primary/[0.07] hover:text-primary disabled:opacity-40"
            >
              <Paperclip className="size-[19px]" />
            </button>
            <textarea
              value={draft}
              rows={1}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(draft);
                }
              }}
              placeholder="Talk to Emery…"
              className="max-h-32 min-h-11 min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/75"
            />
            <button
              type="button"
              disabled
              aria-label="Emery Voice — next feature"
              title="Emery Voice is next"
              className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.06] text-primary opacity-80"
            >
              <Mic className="size-[19px]" />
              <span className="absolute -right-1 -top-1 rounded-full border border-background bg-card px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-primary">
                Next
              </span>
            </button>
            <button
              type="submit"
              aria-label="Send"
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_0_18px_oklch(0.78_0.19_154/0.18)] transition disabled:opacity-30"
              disabled={(!draft.trim() && selectedFiles.length === 0) || pending}
            >
              <ArrowUp className="size-[19px]" />
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
