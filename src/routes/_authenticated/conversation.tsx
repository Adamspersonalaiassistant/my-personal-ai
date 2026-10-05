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
  MapPinned,
  Paperclip,
  Volume2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { OperatingContextCard } from "@/components/OperatingContextCard";
import { EmeryPresence } from "@/components/emery-visual/EmeryPresence";
import type { EmeryVisualState } from "@/components/emery-visual/emery-visual.types";
import { CommandPanel } from "@/components/ui/emery/CommandPanel";
import { Button } from "@/components/ui/button";
import brainImage from "@/assets/neural-brain.png";
import { supabase } from "@/integrations/supabase/client";
import { getMainConversationPage } from "@/lib/chat-history.functions";
import { deviceSourceMetadata } from "@/lib/emery/device-continuity";
import { sendEmeryMessage } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/conversation")({
  head: () => ({
    meta: [
      { title: "Conversation — Emery" },
      { name: "description", content: "Continue your private, persistent typed conversation with Emery." },
      { property: "og:title", content: "Conversation — Emery" },
      { property: "og:description", content: "A private ongoing conversation with Emery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Conversation,
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

type HpoRouteCommandSummary = {
  performed?: boolean;
  routeId?: string | null;
  action?: string | null;
};

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
const PREFILL_KEY = "emery:prefill";

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
    <div className="flex min-w-[150px] max-w-[210px] items-center gap-2 rounded-xl border border-border/60 bg-elevated px-2.5 py-2">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-9 rounded-lg object-cover" decoding="async" />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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

function Conversation() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [chatVisualState, setChatVisualState] = useState<EmeryVisualState>("idle");
  const [voiceVisualState, setVoiceVisualState] = useState<EmeryVisualState>("idle");
  const [voiceStudioState, setVoiceStudioState] = useState<VoiceStudioState | null>(null);
  const [lastHpoRoute, setLastHpoRoute] = useState<{ routeId: string; action: string } | null>(null);
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
  const successTimerRef = useRef<number | null>(null);
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
    return () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const prefill = window.sessionStorage.getItem(PREFILL_KEY)?.trim();
    if (!prefill) return;
    setDraft(prefill);
    window.sessionStorage.removeItem(PREFILL_KEY);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

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
    if (nearBottom) requestAnimationFrame(() => scrollToLatest(pending ? "smooth" : "auto"));
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
        if (scroller) {
          scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
        }
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
    setNearBottom(
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_THRESHOLD,
    );
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

  function showSuccessState() {
    setChatVisualState("success");
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    successTimerRef.current = window.setTimeout(() => {
      setChatVisualState("idle");
      successTimerRef.current = null;
    }, 1200);
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
    setChatVisualState(selectedFiles.length ? "syncing" : "thinking");
    try {
      const uploaded = await uploadFiles();
      setChatVisualState("thinking");
      const result = await askEmery({
        data: {
          message: clean,
          attachments: uploaded,
          source: {
            entryPoint: "chat",
            inputMode: "typed",
            surface: "chat",
            ...deviceSourceMetadata(),
          },
        },
      });
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

      const hpoRouteCommand =
        "hpoRouteCommand" in result
          ? ((result as { hpoRouteCommand?: HpoRouteCommandSummary | null }).hpoRouteCommand ?? null)
          : null;
      if (
        hpoRouteCommand?.performed &&
        hpoRouteCommand?.routeId &&
        ["hpo.route.create", "hpo.route.optimize", "hpo.route.reoptimize"].includes(
          String(hpoRouteCommand.action),
        )
      ) {
        setLastHpoRoute({
          routeId: String(hpoRouteCommand.routeId),
          action: String(hpoRouteCommand.action),
        });
      }

      const serverUser = "userMessage" in result ? result.userMessage : null;
      const serverAssistant = "assistantMessage" in result ? result.assistantMessage : null;
      setMessages((prev) => {
        const withoutTemp = prev.filter((message) => message.id !== tempId);
        const additions: Message[] = [
          serverUser
            ? (serverUser as Message)
            : {
                id: tempId,
                role: "user",
                text: clean,
                createdAt: new Date().toISOString(),
                attachments: optimisticAttachments,
              },
          serverAssistant
            ? (serverAssistant as Message)
            : {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                text: result.reply,
                createdAt: new Date().toISOString(),
                attachments: [],
              },
        ];
        return [...withoutTemp, ...additions];
      });
      setSelectedFiles([]);
      showSuccessState();
    } catch (caught) {
      setChatVisualState("error");
      setError(
        caught instanceof Error ? caught.message : "Couldn't send your message. Please try again.",
      );
      try {
        await refreshLatest();
      } catch {
        // Preserve the current rendered conversation.
      }
    } finally {
      setPending(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    await sendMessage(draft);
  }

  const visualState: EmeryVisualState = error
    ? "error"
    : voiceVisualState !== "idle"
      ? voiceVisualState
      : pending
        ? chatVisualState
        : chatVisualState;

  return (
    <AppShell title="Conversation" padded={false}>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="emery-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8 pt-2 [touch-action:pan-y] [-webkit-overflow-scrolling:touch] sm:px-5 sm:pt-3 md:px-6 lg:px-8"
          aria-label="Emery conversation"
        >
          <div className="-mx-3 -mt-2 mb-3 sm:hidden">
            <EmeryPresence state={visualState} compact />
          </div>
          <div className="mx-auto w-full max-w-[1120px]">
            <EmeryPresence
              state={visualState}
              subtitle="One conversation. One memory. One intelligence across your work and life."
            />

            <div className="mt-3 grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,760px)_300px] 2xl:justify-center">
              <div className="min-w-0">
                 <div className="mb-4 2xl:hidden">
                  <OperatingContextCard />
                </div>

                {!loading && messages.length > 0 && hasMore ? (
                  <div className="mb-5 flex justify-center">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder}
                      className="emery-press min-h-11 gap-2 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
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
                    className="flex min-h-[36vh] flex-col items-center justify-center gap-3"
                    role="status"
                  >
                    <Loader2 className="size-5 animate-spin text-live" />
                    <p className="text-sm text-muted-foreground">Opening your conversation…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex min-h-[32vh] flex-col items-center justify-center py-8 text-center">
                    <h2 className="text-2xl font-semibold tracking-[-0.03em]">Good to see you, Adam.</h2>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-secondary-foreground">
                      What are we working through?
                    </p>
                    <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
                      {quickPrompts.map((prompt) => (
                        <Button
                          variant="outline"
                          key={prompt}
                          type="button"
                          onClick={() => void sendMessage(prompt)}
                          className="emery-press min-h-11 rounded-xl border-border/70 bg-surface px-3 text-sm font-medium text-secondary-foreground hover:border-primary/30 hover:bg-elevated hover:text-foreground"
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 py-3">
                    {messages.map((message) =>
                      message.role === "user" ? (
                        <div key={message.id} className="flex justify-end pl-8 sm:pl-20">
                           <div className="emery-user-message max-w-[92%] rounded-lg border px-4 py-3 text-[15px] leading-6 text-foreground sm:max-w-[82%]">
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
                        <div key={message.id} className="group flex min-w-0 items-start gap-2.5 pr-1 sm:gap-3 sm:pr-10">
                          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-live/20 bg-live/[0.045] sm:size-9 sm:rounded-xl">
                            <img
                              src={brainImage}
                              alt=""
                              className="emery-blue-brain size-8 object-cover"
                            />
                          </div>
                          <div className="emery-assistant-message min-w-0 max-w-[calc(100%-2.625rem)] whitespace-pre-wrap break-words rounded-md border border-live/10 px-3 py-2.5 text-[15px] leading-7 text-foreground/95 sm:max-w-[88%]">
                            {cleanAssistantText(message.text)}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}

                {pending ? (
                  <div className="mt-6 flex items-center gap-3" role="status" aria-live="polite">
                    <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl border border-live/15 bg-live/[0.035]">
                      <img src={brainImage} alt="" className="emery-blue-brain size-8 object-cover" />
                    </div>
                    <div className="flex min-h-9 items-center gap-2 text-sm text-secondary-foreground">
                      <span>{chatVisualState === "syncing" ? "Syncing" : "Thinking"}</span>
                      <span className="flex items-center gap-1" aria-hidden>
                        <span className="emery-dot size-1.5 rounded-full bg-live" />
                        <span className="emery-dot size-1.5 rounded-full bg-live" />
                        <span className="emery-dot size-1.5 rounded-full bg-live" />
                      </span>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <p
                    className="mt-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <div ref={endRef} />
              </div>

              <aside className="hidden min-w-0 2xl:block">
                <div className="sticky top-3 space-y-3">
                  <p className="emery-kicker px-1">Current Context</p>
                  <OperatingContextCard />
                  <CommandPanel className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Continuity
                    </p>
                    <p className="mt-2 text-sm leading-6 text-secondary-foreground">
                      This is the same Emery across Voice, iPhone, computer, Calendar and HPO.
                    </p>
                  </CommandPanel>
                </div>
              </aside>
            </div>
          </div>
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
            className="emery-press absolute bottom-[5.6rem] right-4 z-30 size-11 rounded-full border-border/70 bg-elevated text-live shadow-lg"
          >
            <ArrowDown className="size-4" />
          </Button>
        ) : null}

         <div className="z-20 shrink-0 border-t border-border/55 bg-surface/90 px-3 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:px-5 md:px-7">
          {voiceStudioState ? (
            <CommandPanel variant="elevated" className="mx-auto mb-2 max-w-2xl p-3">
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
                        AI-generated provider preview. Listen before approval.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setVoiceStudioState(null)}
                      className="size-9 rounded-lg text-muted-foreground"
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
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Emery Voice is approved</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                      {voiceStudioState.voiceId} is saved as the base voice.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVoiceStudioState(null)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
                    aria-label="Dismiss voice approval"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
            </CommandPanel>
          ) : null}

          {lastHpoRoute ? (
            <div className="mx-auto mb-2 flex max-w-2xl items-center gap-3 rounded-2xl border border-live/20 bg-live/[0.045] px-3 py-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-live/10 text-live">
                <MapPinned className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">HPO route ready</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Open the numbered optimized route on the HPO map.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  window.location.assign(`/hpo?routeId=${encodeURIComponent(lastHpoRoute.routeId)}`)
                }
                className="min-h-10 shrink-0 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
              >
                View Map
              </button>
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
             className="emery-composer mx-auto flex max-w-2xl items-end gap-1 rounded-lg border border-input/80 p-1.5 focus-within:border-live/45 sm:gap-1.5"
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
              className="emery-press size-11 shrink-0 rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-primary disabled:opacity-40"
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
            <EmeryVoiceControl
              onConversationChanged={() => void refreshLatest()}
              onVisualStateChange={setVoiceVisualState}
            />
            <Button
              type="submit"
              aria-label="Send"
               className="emery-press size-11 shrink-0 rounded-md bg-primary shadow-[0_0_20px_color-mix(in_srgb,var(--primary)_16%,transparent)] disabled:opacity-30"
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
