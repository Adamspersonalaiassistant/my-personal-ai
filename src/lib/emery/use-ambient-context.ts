import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendAmbientSnippet,
  buildAmbientResponseInstructions,
  deleteRealtimeAmbientItems,
  isAmbientAddressedTurn,
  pruneAmbientSnippets,
  requestRealtimeAmbientResponse,
  setRealtimeAmbientMode,
  type AmbientSnippet,
} from "./ambient-context.ts";

type ChannelLike = {
  readyState: string;
  send(data: string): void;
};

export type AmbientTranscriptResult = {
  handled: boolean;
  addressed: boolean;
  persistTranscript: boolean;
  responseRequested: boolean;
};

export function useAmbientContext(getChannel: () => ChannelLike | null) {
  const [enabled, setEnabledState] = useState(false);
  const [snippetCount, setSnippetCount] = useState(0);
  const enabledRef = useRef(false);
  const snippetsRef = useRef<AmbientSnippet[]>([]);

  const replaceSnippets = useCallback((snippets: AmbientSnippet[]) => {
    snippetsRef.current = snippets;
    setSnippetCount(snippets.length);
  }, []);

  const pruneNow = useCallback(() => {
    const pruned = pruneAmbientSnippets(snippetsRef.current);
    replaceSnippets(pruned.active);
    if (pruned.expiredItemIds.length) {
      deleteRealtimeAmbientItems(getChannel(), pruned.expiredItemIds);
    }
    return pruned.active;
  }, [getChannel, replaceSnippets]);

  const clear = useCallback(() => {
    const ids = snippetsRef.current.map((snippet) => snippet.itemId);
    if (ids.length) deleteRealtimeAmbientItems(getChannel(), ids);
    replaceSnippets([]);
  }, [getChannel, replaceSnippets]);

  const setEnabled = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabledState(next);
      if (!next) clear();
      setRealtimeAmbientMode(getChannel(), next);
    },
    [clear, getChannel],
  );

  const toggle = useCallback(() => setEnabled(!enabledRef.current), [setEnabled]);

  const applyMode = useCallback(() => {
    setRealtimeAmbientMode(getChannel(), enabledRef.current);
  }, [getChannel]);

  const reset = useCallback(() => {
    enabledRef.current = false;
    setEnabledState(false);
    replaceSnippets([]);
  }, [replaceSnippets]);

  const handleTranscript = useCallback(
    (input: { itemId: string; transcript: string }): AmbientTranscriptResult => {
      if (!enabledRef.current) {
        return {
          handled: false,
          addressed: false,
          persistTranscript: true,
          responseRequested: false,
        };
      }

      const transcript = input.transcript.trim();
      if (!transcript || !input.itemId) {
        return {
          handled: true,
          addressed: false,
          persistTranscript: false,
          responseRequested: false,
        };
      }

      const active = pruneNow();
      if (isAmbientAddressedTurn(transcript)) {
        const instructions = buildAmbientResponseInstructions({
          snippets: active,
          currentTurn: transcript,
        });
        return {
          handled: true,
          addressed: true,
          persistTranscript: true,
          responseRequested: requestRealtimeAmbientResponse(getChannel(), instructions),
        };
      }

      const appended = appendAmbientSnippet(active, {
        itemId: input.itemId,
        text: transcript,
        heardAt: Date.now(),
      });
      replaceSnippets(appended.active);
      if (appended.expiredItemIds.length) {
        deleteRealtimeAmbientItems(getChannel(), appended.expiredItemIds);
      }
      return {
        handled: true,
        addressed: false,
        persistTranscript: false,
        responseRequested: false,
      };
    },
    [getChannel, pruneNow, replaceSnippets],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(pruneNow, 10_000);
    return () => window.clearInterval(timer);
  }, [enabled, pruneNow]);

  useEffect(
    () => () => {
      snippetsRef.current = [];
    },
    [],
  );

  return {
    enabled,
    snippetCount,
    setEnabled,
    toggle,
    applyMode,
    reset,
    handleTranscript,
  };
}
