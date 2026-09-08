import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Paperclip, ArrowUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { sendChatMessage } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  component: Chat,
});

type Message = { id: number; role: "user" | "assistant"; text: string };

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askAssistant = useServerFn(sendChatMessage);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", text }]);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const history = messages.map((m) => ({ role: m.role, text: m.text }));
      const result = await askAssistant({ data: { message: text, history } });
      if ("reply" in result && result.reply) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, role: "assistant", text: result.reply },
        ]);
      } else {
        setError(("error" in result && result.error) || "Something went wrong.");
      }
    } catch {
      setError("Couldn't send your message. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell title="Chat" padded={false}>
      <div className="flex min-h-full flex-col">
        <div className="flex-1 space-y-3 px-4 py-5">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-sm py-16 text-center">
              <h2 className="text-base font-semibold">Ask me anything</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your assistant is connected. Messages aren&apos;t saved yet.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <p
                  className={
                    m.role === "user"
                      ? "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                      : "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-secondary-foreground"
                  }
                >
                  {m.text}
                </p>
              </div>
            ))
          )}

          {pending && (
            <div className="flex justify-start">
              <p className="rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
                Thinking…
              </p>
            </div>
          )}

          {error && (
            <p className="px-1 text-center text-sm text-destructive" role="alert">
              {error}
            </p>
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
            disabled={!draft.trim() || pending}
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </AppShell>
  );
}
