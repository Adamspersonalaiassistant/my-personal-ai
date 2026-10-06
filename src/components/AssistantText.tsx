import { Fragment, useMemo } from "react";
import { parseAssistantText, type Inline } from "@/lib/assistant-format";

// Renders Emery/JARVIS replies as clean structure (section titles, numbered
// sections, bullets, short paragraphs) instead of raw markdown tokens.
// Builds React elements only — model text is never injected as HTML.

function InlineParts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "strong")
          return (
            <strong key={index} className="font-semibold text-foreground">
              {part.text}
            </strong>
          );
        if (part.kind === "code")
          return (
            <code
              key={index}
              className="break-all rounded bg-white/[0.07] px-1 py-px font-mono text-[0.86em]"
            >
              {part.text}
            </code>
          );
        if (part.kind === "link")
          return (
            <a
              key={index}
              href={part.href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            >
              {part.text}
            </a>
          );
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

export function AssistantText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseAssistantText(text), [text]);
  return (
    <div className={`min-w-0 space-y-1.5 break-words ${className}`}>
      {blocks.map((block, index) => {
        const spaced = index > 0 ? "pt-1.5" : "";
        switch (block.type) {
          case "title":
            return (
              <p
                key={index}
                className={`${index > 0 ? "pt-2.5" : ""} font-semibold leading-6 text-foreground`}
              >
                <InlineParts parts={block.inline} />
              </p>
            );
          case "numbered":
            return (
              <div key={index} className={`flex gap-2 ${spaced}`}>
                <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-primary/85">
                  {block.n}.
                </span>
                <div className="min-w-0 flex-1 font-medium text-foreground">
                  <InlineParts parts={block.inline} />
                </div>
              </div>
            );
          case "bullet":
            return (
              <div key={index} className={`flex gap-2 ${block.depth ? "pl-9" : "pl-3"}`}>
                <span
                  aria-hidden
                  className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                />
                <div className="min-w-0 flex-1">
                  <InlineParts parts={block.inline} />
                </div>
              </div>
            );
          case "code":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-lg bg-black/25 px-3 py-2 font-mono text-xs leading-5"
              >
                {block.text}
              </pre>
            );
          default:
            return (
              <p key={index} className={spaced}>
                <InlineParts parts={block.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
