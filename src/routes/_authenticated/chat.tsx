import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  ChevronUp,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Volume2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { OperatingContextCard } from "@/components/OperatingContextCard";
import { Button } from "@/components/ui/button";
import brainImage from "@/assets/neural-brain.png";
import { supabase } from "@/integrations/supabase/client";
import { getMainConversationPage } from "@/lib/chat-history.functions";
import { sendEmeryMessage } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Conversation — Emery" },
      { name: "description", content: "Continue your private, ongoing conversation with Emery." },
      { property: "og:title", content: "Conversation — Emery" },
      { property: "og:description", content: "A private ongoing conversation with Emery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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

type VoiceStudioState =
  | { stage: "previewed"; voiceId: string; audioDataUri: string }
  | { stage: "approved"; voiceId: string };

const quickPrompts = [
  "What should I focus on?",
  "What do I have going on?",
  "Help me think this through",
];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COMBINED_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 5;
const CHAT_PAGE_SIZE = 80;
const BOTTOM_THRESHOLD = 140;

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
        className="group block overflow-hidden rounded-xl border border-white/10 bg-black/15"
      >
        <img
          src={attachment.url}
          alt={attachment.fileName}
          loading="lazy"
          decoding="async"
          className="max-h-64 w-full object-cover transition duration-200 group-hover:scale-[1.01]"
        />
      </a>
    );
  }

  const content = (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-black/15 px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
        <FileText className="size-3.5" />
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

function SelectedFileCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage(file.type)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex min-w-[150px] max-w-[210px] items-center gap-2 rounded-xl border border-border/45 bg-card/72 px-2.5 py-2">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-9 rounded-lg object-cover" decoding="async" />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/[0.055] text-primary">
          <FileText className="size-3.5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium">{file.name}</p>
        <p className="text-[9px] text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
      <Button
        variant="ghost"
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="emery-press size-11 shrink-0 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [voiceStudioState, setVoiceStudioState] = useState<VoiceStudioState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const askEmery = useServerFn(sendEmeryMessage);
  const loadPage = useServerFn(getMainConversationPage);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    endRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const refreshLatest = useCallback(async () => {
    const result = await loadPage({ data: { limit: CHAT_PAGE_SIZE, beforeCreatedAt: null } });
    setMessages((result?.messages ?? []) as Message[]);
    setHasMore(Boolean(result?.hasMore));
    setHistoryCursor(result?.nextCursor ?? null);
  }, [loadPage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadPage({ data: { limit: CHAT_PAGE_SIZE, beforeCreatedAt: null } });
        if (cancelled) return;
        setMessages((result?.messages ?? []) as Message[]);
        setHasMore(Boolean(result?.hasMore));
        setHistoryCursor(result?.nextCursor ?? null);
        requestAnimationFrame(() => scrollToLatest("auto"));
      } catch {
        if (!cancelled) setError("Couldn't open your Emery conversation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage, scrollToLatest]);

  useEffect(() => {
    if (!nearBottom) return;
    requestAnimationFrame(() => scrollToLatest(pending ? "smooth" : "auto"));
  }, [messages, pending, nearBottom, scrollToLatest]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [draft]);

  async function loadOlder() {
    if (!hasMore || !historyCursor || loadingOlder) return;
    const scroller = scrollRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await loadPage({
        data: { limit: CHAT_PAGE_SIZE, beforeCreatedAt: historyCursor },
      });
      const older = (result?.messages ?? []) as Message[];
      setMessages((current) => {
        const ids = new Set(current.map((message) => message.id));
        return [...older.filter((message) => !ids.has(message.id)), ...current];
      });
      setHasMore(Boolean(result?.hasMore));
      setHistoryCursor(result?.nextCursor ?? null);
      requestAnimationFrame(() => {
        if (!scroller) return;
        scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
      });
    } catch {
      setError("Couldn't load earlier messages. Your current chat is still here.");
    } finally {
      setLoadingOlder(false);
    }
  }

  function handleScroll() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setNearBottom(distanceFromBottom < BOTTOM_THRESHOLD);
  }

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const next = [...selectedFiles, ...Array.from(files)].slice(0, MAX_FILES);
    const tooLarge = next.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setError(`${tooLarge.name} is larger than 25 MB.`);
      return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_COMBINED_BYTES) {
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
      const storagePath = `${user.id}/${crypto.randomUUID()}-${sanitizeFileName(file.name || "attachment")}`;
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
      url: null,
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
    setNearBottom(true);

    try {
      const uploaded = await uploadFiles();
      const result = await askEmery({ data: { message: clean, attachments: uploaded } });
      if (!("reply" in result) || !result.reply) {
        throw new Error(("error" in result && result.error) || "Something went wrong.");
      }

      const studio = "voiceStudio" in result ? result.voiceStudio : null;
      if (
        studio &&
        studio.stage === "previewed" &&
        studio.operationSucceeded &&
        studio.voiceId &&
        studio.previewAudioDataUri
      ) {
        setVoiceStudioState({
          stage: "previewed",
          voiceId: studio.voiceId,
          audioDataUri: studio.previewAudioDataUri,
        });
      } else if (
        studio &&
        studio.stage === "approved" &&
        studio.operationSucceeded &&
        studio.voiceId
      ) {
        setVoiceStudioState({ stage: "approved", voiceId: studio.voiceId });
      } else if (
        studio &&
        [
          "designing",
          "candidate_blocked",
          "candidate_selected",
          "design_refined_needs_preview",
          "preview_failed",
        ].includes(String(studio.stage))
      ) {
        setVoiceStudioState(null);
      }

      const voiceStudio = "voiceStudio" in result ? result.voiceStudio : null;
      if (
        voiceStudio &&
        typeof voiceStudio === "object" &&
        "micUnlocked" in voiceStudio &&
        voiceStudio.micUnlocked === true
      ) {
        window.dispatchEvent(new Event("emery-voice-profile-updated"));
      }

      const serverUser = "userMessage" in result ? result.userMessage : null;
      const serverAssistant = "assistantMessage" in result ? result.assistantMessage : null;
      setMessages((prev) => {
        const withoutTemp = prev.filter((message) => message.id !== tempId);
        const additions: Message[] = [];
        additions.push(
          serverUser
            ? (serverUser as Message)
            : {
                id: tempId,
                role: "user",
                text: clean,
                createdAt: new Date().toISOString(),
                attachments: optimisticAttachments,
              },
        );
        additions.push(
          serverAssistant
            ? (serverAssistant as Message)
            : {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                text: result.reply,
                createdAt: new Date().toISOString(),
                attachments: [],
              },
        );
        return [...withoutTemp, ...additions];
      });
      setSelectedFiles([]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn't send your message. Please try again.",
      );
      try {
        await refreshLatest();
      } catch {
        // Preserve the already-rendered conversation if recovery also fails.
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
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="emery-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 [touch-action:pan-y] [-webkit-overflow-scrolling:touch] sm:px-6 sm:pt-5 md:px-7"
          aria-label="Emery conversation"
        >
          <div className="mx-auto mb-3 max-w-2xl">
            <OperatingContextCard />
          </div>

          {!loading && messages.length > 0 && hasMore ? (
            <div className="mx-auto mb-5 flex max-w-2xl justify-center">
              <Button
                variant="ghost"
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="emery-press min-h-11 gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
              >
                {loadingOlder ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ChevronUp className="size-3.5" />
                )}
                {loadingOlder ? "Loading earlier…" : "Earlier messages"}
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div
              className="flex min-h-[48vh] flex-col items-center justify-center gap-3"
              role="status"
            >
              <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-primary/[0.04]">
                <img
                  src={brainImage}
                  alt=""
                  className="emery-blue-brain size-11 object-cover opacity-90"
                />
              </div>
              <p className="text-sm text-muted-foreground">Opening your conversation…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex min-h-[54vh] max-w-md flex-col items-center justify-center py-8 text-center">
              <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl bg-primary/[0.04]">
                <img
                  src={brainImage}
                  alt="Emery neural brain"
                  className="emery-blue-brain size-16 object-cover"
                />
              </div>
              <h2 className="mt-5 text-2xl font-semibold">I’m here, Adam.</h2>
              <p className="mt-1.5 max-w-xs text-sm leading-6 text-muted-foreground">
                What are we working through?
              </p>
              <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
                {quickPrompts.map((prompt) => (
                  <Button
                    variant="outline"
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    className="emery-press min-h-11 rounded-lg border border-border/50 bg-card/40 px-3 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end pl-8 sm:pl-20">
                    <div className="max-w-[92%] rounded-lg bg-primary px-3.5 py-2.5 text-[15px] leading-6 text-primary-foreground sm:max-w-[84%]">
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
                  <div key={message.id} className="flex items-start gap-2.5 pr-1 sm:gap-3 sm:pr-12">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/[0.045]">
                      <img
                        src={brainImage}
                        alt=""
                        className="emery-blue-brain size-7 object-cover"
                      />
                    </div>
                    <div className="max-w-[calc(100%-2.6rem)] whitespace-pre-wrap pt-0.5 text-[15px] leading-7 text-foreground/96 sm:max-w-[88%]">
                      {cleanAssistantText(message.text)}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {pending ? (
            <div
              className="mx-auto mt-6 flex max-w-2xl items-center gap-2.5"
              role="status"
              aria-live="polite"
            >
              <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-primary/[0.045]">
                <img src={brainImage} alt="" className="emery-blue-brain size-7 object-cover" />
              </div>
              <div className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
                <span>Thinking</span>
                <span className="flex items-center gap-1" aria-hidden>
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="mx-auto mt-4 max-w-2xl rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>

        {!nearBottom && !loading ? (
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              setNearBottom(true);
              scrollToLatest("smooth");
            }}
            aria-label="Jump to latest message"
            className="emery-press absolute bottom-[5.4rem] right-4 z-30 size-11 rounded-full border-border/60 bg-card text-primary shadow-sm"
          >
            <ArrowDown className="size-4" />
          </Button>
        ) : null}

        <div className="z-20 shrink-0 border-t border-border/40 bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-lg sm:px-5 sm:pb-4 md:px-7">
          {voiceStudioState ? (
            <div className="mx-auto mb-2 max-w-2xl rounded-2xl border border-primary/18 bg-primary/[0.045] p-3 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
              {voiceStudioState.stage === "previewed" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Volume2 className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold capitalize">
                        {voiceStudioState.voiceId} preview
                      </p>
                      <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                        AI-generated provider preview. Listen before approval; this is not Emery’s
                        approved voice yet.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setVoiceStudioState(null)}
                      className="emery-press flex size-9 items-center justify-center rounded-lg text-muted-foreground"
                      aria-label="Close voice preview"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <audio
                    data-emery-voice-preview="true"
                    controls
                    playsInline
                    src={voiceStudioState.audioDataUri}
                    className="h-10 w-full"
                    aria-label={`Preview ${voiceStudioState.voiceId} voice`}
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void sendMessage(
                        `I explicitly approve ${voiceStudioState.voiceId} as Emery's base voice.`,
                      )
                    }
                    className="emery-press min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Approve as Emery
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Emery Voice is approved</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                      {voiceStudioState.voiceId} is saved as the base voice. The microphone is
                      unlocked for the first live conversation.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVoiceStudioState(null)}
                    className="emery-press flex size-9 items-center justify-center rounded-lg text-muted-foreground"
                    aria-label="Dismiss voice approval"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {selectedFiles.length ? (
            <div className="emery-scrollbar mx-auto mb-2 flex max-w-2xl gap-2 overflow-x-auto pb-1">
              {selectedFiles.map((file, index) => (
                <SelectedFileCard
                  key={`${file.name}-${file.lastModified}-${file.size}`}
                  file={file}
                  onRemove={() =>
                    setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                  }
                />
              ))}
            </div>
          ) : null}

          <form
            onSubmit={send}
            className="mx-auto flex max-w-2xl items-end gap-1 rounded-lg border border-input bg-card p-1.5 shadow-sm focus-within:border-ring/60 sm:gap-1.5"
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
            <Button
              variant="ghost"
              type="button"
              aria-label="Attach photos or files"
              title="Attach photos or files"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
              className="emery-press size-11 shrink-0 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-primary disabled:opacity-40"
            >
              <Paperclip className="size-[18px]" strokeWidth={1.9} />
            </Button>
            <textarea
              ref={textareaRef}
              value={draft}
              rows={1}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  const finePointer =
                    typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
                  if (finePointer) {
                    event.preventDefault();
                    void sendMessage(draft);
                  }
                }
              }}
              enterKeyHint="enter"
              placeholder="Message Emery"
              className="max-h-32 min-h-11 min-w-0 flex-1 overflow-y-auto bg-transparent px-1.5 py-2 text-[16px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 sm:px-2 sm:text-[15px]"
            />
            <EmeryVoiceControl onConversationChanged={() => void refreshLatest()} />
            <Button
              type="submit"
              aria-label="Send"
              className="emery-press size-11 shrink-0 rounded-lg shadow-none disabled:opacity-30"
              disabled={(!draft.trim() && selectedFiles.length === 0) || pending}
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.2} />
            </Button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
