import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, FileText, Mic, Paperclip, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import brainImage from "@/assets/neural-brain.png";
import { supabase } from "@/integrations/supabase/client";
import { getMainConversation, sendEmeryMessage } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/chat")({ component: Chat });

type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; url: string | null };
type Message = { id: string; role: "user" | "assistant"; text: string; createdAt: string; attachments: Attachment[] };

const quickPrompts = ["What should I focus on?", "What do I have going on?", "Help me think this through"];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COMBINED_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 5;

function cleanAssistantText(text: string) {
  return text.replace(/\*\*/g, "").replace(/__/g, "").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1");
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function sanitizeFileName(name: string) { return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-"); }
function isImage(mimeType: string) { return mimeType.startsWith("image/"); }

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  if (isImage(attachment.mimeType) && attachment.url) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-2xl border border-white/10 bg-black/15">
        <img src={attachment.url} alt={attachment.fileName} className="max-h-64 w-full object-cover transition duration-300 group-hover:scale-[1.01]" />
      </a>
    );
  }
  const content = (
    <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-black/15 px-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10"><FileText className="size-4" /></div>
      <div className="min-w-0"><p className="truncate text-xs font-medium">{attachment.fileName}</p><p className="mt-0.5 text-[10px] opacity-70">{formatBytes(attachment.sizeBytes)}</p></div>
    </div>
  );
  return attachment.url ? <a href={attachment.url} target="_blank" rel="noreferrer" className="block">{content}</a> : content;
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

  async function refreshMain() { const result = await loadMain({}); setMessages((result?.messages ?? []) as Message[]); }
  useEffect(() => { let cancelled = false; (async () => { try { const result = await loadMain({}); if (!cancelled) setMessages((result?.messages ?? []) as Message[]); } catch { if (!cancelled) setError("Couldn't open your Emery conversation."); } finally { if (!cancelled) setLoading(false); } })(); return () => { cancelled = true; }; }, [loadMain]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: pending ? "smooth" : "auto" }); }, [messages, pending]);

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const next = [...selectedFiles, ...Array.from(files)].slice(0, MAX_FILES);
    const tooLarge = next.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) { setError(`${tooLarge.name} is larger than 25 MB.`); return; }
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_COMBINED_BYTES) { setError("Keep attachments under 40 MB total per message."); return; }
    setError(null); setSelectedFiles(next);
  }

  async function uploadFiles() {
    if (!selectedFiles.length) return [];
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Please sign in again before attaching files.");
    const uploaded: Array<{ storagePath: string; fileName: string; mimeType: string; sizeBytes: number }> = [];
    for (const file of selectedFiles) {
      const storagePath = `${user.id}/${crypto.randomUUID()}-${sanitizeFileName(file.name || "attachment")}`;
      const { error: uploadError } = await supabase.storage.from("emery-attachments").upload(storagePath, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (uploadError) throw new Error(`Couldn't upload ${file.name}. ${uploadError.message}`);
      uploaded.push({ storagePath, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size });
    }
    return uploaded;
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if ((!clean && selectedFiles.length === 0) || pending) return;
    const tempId = `temp-${Date.now()}`;
    const optimisticAttachments: Attachment[] = selectedFiles.map((file, index) => ({ id: `${tempId}-${index}`, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, url: isImage(file.type) ? URL.createObjectURL(file) : null }));
    setMessages((prev) => [...prev, { id: tempId, role: "user", text: clean, createdAt: new Date().toISOString(), attachments: optimisticAttachments }]);
    setDraft(""); setError(null); setPending(true);
    try {
      const uploaded = await uploadFiles();
      const result = await askEmery({ data: { message: clean, attachments: uploaded } });
      if (!("reply" in result) || !result.reply) throw new Error(("error" in result && result.error) || "Something went wrong.");
      const serverUser = "userMessage" in result ? result.userMessage : null;
      const serverAssistant = "assistantMessage" in result ? result.assistantMessage : null;
      setMessages((prev) => {
        const withoutTemp = prev.filter((message) => message.id !== tempId);
        const additions: Message[] = [];
        additions.push(serverUser ? (serverUser as Message) : { id: tempId, role: "user", text: clean, createdAt: new Date().toISOString(), attachments: optimisticAttachments });
        additions.push(serverAssistant ? (serverAssistant as Message) : { id: `assistant-${Date.now()}`, role: "assistant", text: result.reply, createdAt: new Date().toISOString(), attachments: [] });
        return [...withoutTemp, ...additions];
      });
      setSelectedFiles([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't send your message. Please try again.");
      try { await refreshMain(); } catch { /* preserve optimistic state */ }
    } finally { setPending(false); }
  }

  async function send(event: React.FormEvent) { event.preventDefault(); await sendMessage(draft); }

  return (
    <AppShell title="Emery" padded={false}>
      <div className="relative flex min-h-[calc(100dvh-132px)] flex-col">
        <div className="flex items-center justify-center border-b border-border/35 bg-background/28 px-4 py-2.5 backdrop-blur-xl">
          <div className="emery-chip"><span className="size-1.5 rounded-full bg-primary shadow-[0_0_9px_oklch(0.805_0.175_155/0.72)]" /> Main conversation · Memory online</div>
        </div>

        <div className="emery-scrollbar flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 sm:pt-6">
          {loading ? (
            <div className="flex min-h-[48vh] flex-col items-center justify-center gap-4">
              <div className="emery-breathe flex size-16 items-center justify-center overflow-hidden rounded-[1.35rem] border border-primary/15 bg-primary/[0.04]"><img src={brainImage} alt="" className="size-14 object-cover opacity-90" /></div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground">Opening your conversation…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="emery-fade-up mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center py-8 text-center">
              <div className="relative">
                <div className="absolute inset-1 rounded-full bg-primary/14 blur-3xl" />
                <div className="emery-breathe emery-glass-strong relative flex size-28 items-center justify-center overflow-hidden rounded-[2rem]"><img src={brainImage} alt="Emery neural brain" className="h-24 w-24 object-cover" /></div>
              </div>
              <div className="mt-6 flex items-center gap-2 text-primary"><Sparkles className="size-4" /><span className="emery-kicker">Emery online</span></div>
              <h2 className="emery-text-gradient mt-3 text-[1.7rem] font-semibold tracking-[-0.035em]">I’m here, Adam.</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Same conversation. Same Emery. Bring me the mess and we’ll turn it into the next move.</p>
              <div className="mt-7 grid w-full gap-2 sm:grid-cols-3">
                {quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => void sendMessage(prompt)} className="emery-press emery-surface min-h-12 rounded-2xl px-3.5 text-xs font-medium text-muted-foreground hover:border-primary/25 hover:bg-primary/[0.05] hover:text-foreground">{prompt}</button>)}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5">
              {messages.map((message) => message.role === "user" ? (
                <div key={message.id} className="emery-fade-up flex justify-end pl-8 sm:pl-16">
                  <div className="max-w-[90%] rounded-[1.45rem] rounded-br-[0.45rem] bg-[linear-gradient(145deg,oklch(0.79_0.17_155),oklch(0.64_0.15_158))] px-4 py-3 text-[15px] leading-6 text-[oklch(0.09_0.02_160)] shadow-[0_12px_34px_oklch(0.3_0.09_158/0.15)]">
                    {message.attachments.length ? <div className={`grid gap-2 ${message.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>{message.attachments.map((attachment) => <AttachmentCard key={attachment.id} attachment={attachment} />)}</div> : null}
                    {message.text ? <p className={message.attachments.length ? "mt-2.5 whitespace-pre-wrap" : "whitespace-pre-wrap"}>{message.text}</p> : null}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="emery-fade-up flex items-start gap-3 pr-2 sm:pr-10">
                  <div className="emery-icon-well mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[0.9rem]"><img src={brainImage} alt="" className="size-8 object-cover" /></div>
                  <div className="emery-glass max-w-[90%] whitespace-pre-wrap rounded-[1.45rem] rounded-tl-[0.45rem] px-4 py-3.5 text-[15px] leading-6.5 text-foreground">{cleanAssistantText(message.text)}</div>
                </div>
              ))}
            </div>
          )}

          {pending ? <div className="mx-auto mt-5 flex max-w-2xl items-center gap-3"><div className="emery-icon-well flex size-9 items-center justify-center overflow-hidden rounded-[0.9rem]"><img src={brainImage} alt="" className="size-8 object-cover" /></div><div className="emery-glass flex min-h-11 items-center gap-2 rounded-2xl px-4 text-xs text-muted-foreground"><span>Thinking with your context</span><span className="flex items-center gap-1"><span className="emery-dot size-1.5 rounded-full bg-primary" /><span className="emery-dot size-1.5 rounded-full bg-primary" /><span className="emery-dot size-1.5 rounded-full bg-primary" /></span></div></div> : null}
          {error ? <p className="mx-auto mt-4 max-w-2xl rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive" role="alert">{error}</p> : null}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 z-20 bg-[linear-gradient(180deg,transparent,oklch(0.095_0.02_160/0.98)_20%)] px-3 pb-3 pt-6 sm:px-5">
          {selectedFiles.length ? <div className="emery-scrollbar mx-auto mb-2.5 flex max-w-2xl gap-2 overflow-x-auto pb-1">{selectedFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="emery-glass flex min-w-[160px] max-w-[220px] items-center gap-2 rounded-2xl px-2.5 py-2">{isImage(file.type) ? <img src={URL.createObjectURL(file)} alt="" className="size-10 rounded-xl object-cover" /> : <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-xl"><FileText className="size-4" /></div>}<div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{file.name}</p><p className="text-[9px] text-muted-foreground">{formatBytes(file.size)}</p></div><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))} className="emery-press flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground"><X className="size-3.5" /></button></div>)}</div> : null}

          <form onSubmit={send} className="emery-glass-strong mx-auto flex max-w-2xl items-end gap-1.5 rounded-[1.7rem] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
            <input ref={fileInputRef} type="file" multiple className="hidden" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,.docx,.xlsx,.xls" onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} />
            <button type="button" aria-label="Attach photos or files" title="Attach photos or files" onClick={() => fileInputRef.current?.click()} disabled={pending} className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-primary/[0.06] hover:text-primary disabled:opacity-40"><Paperclip className="size-[18px]" strokeWidth={1.9} /></button>
            <textarea value={draft} rows={1} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(draft); } }} placeholder="Talk to Emery…" className="max-h-32 min-h-11 min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/65" />
            <button type="button" disabled aria-label="Emery Voice — next feature" title="Emery Voice is next" className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/14 bg-primary/[0.045] text-primary/85"><Mic className="size-[18px]" strokeWidth={1.9} /><span className="absolute -right-1 -top-1 rounded-full border border-background bg-card px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-primary">Next</span></button>
            <button type="submit" aria-label="Send" className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_0_22px_oklch(0.805_0.175_155/0.14)] disabled:opacity-30" disabled={(!draft.trim() && selectedFiles.length === 0) || pending}><ArrowUp className="size-[18px]" strokeWidth={2.2} /></button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
