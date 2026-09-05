import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Mic, Paperclip, ArrowUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/chat")({
  component: Chat,
});

type Message = { id: number; role: "user"; text: string };

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", text }]);
    setDraft("");
  }

  return (
    <AppShell title="Chat" padded={false}>
      <div className="flex min-h-full flex-col">
        <div className="flex-1 space-y-3 px-4 py-5">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-sm py-16 text-center">
              <h2 className="text-base font-semibold">Your assistant, offline for now</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                You can type here, but the AI brain isn&apos;t connected yet, and messages
                aren&apos;t saved.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {m.text}
                </p>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={send}
          className="sticky bottom-0 flex items-end gap-2 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur"
        >
          <button
            type="button"
            disabled
            aria-label="Attach a file — uploads coming soon"
            title="Uploads coming soon"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-50"
          >
            <Paperclip className="size-5" />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            className="h-11 min-w-0 flex-1 rounded-full border border-input bg-secondary/50 px-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            disabled
            aria-label="Voice input — coming soon"
            title="Voice coming soon"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-50"
          >
            <Mic className="size-5" />
          </button>
          <button
            type="submit"
            aria-label="Send"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            disabled={!draft.trim()}
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </AppShell>
  );
}
