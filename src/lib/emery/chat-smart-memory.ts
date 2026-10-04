/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildSmartMemoryPrompt, retrieveSmartMemories, type SmartRecentTurn } from "./smart-memory.ts";

export async function buildChatSmartMemoryContext(input: {
  apiKey?: string | null;
  memories: any[];
  message: string;
  recent: SmartRecentTurn[];
  config?: {
    memory_max_items?: number | null;
    memory_max_characters?: number | null;
  } | null;
  enabled: boolean;
}) {
  const memoryMaxItems = Math.min(
    20,
    Math.max(4, Number(input.config?.memory_max_items ?? 12)),
  );
  const memoryMaxCharacters = Math.min(
    10000,
    Math.max(1600, Number(input.config?.memory_max_characters ?? 5200)),
  );

  const memoryContext = input.enabled
    ? await retrieveSmartMemories({
        apiKey: input.apiKey ?? null,
        memories: input.memories ?? [],
        query: input.message,
        recent: input.recent,
        maxItems: memoryMaxItems,
        maxCharacters: memoryMaxCharacters,
        allowSemantic: true,
      })
    : {
        selected: [],
        digest: null,
        strategy: "none" as const,
        semanticUsed: false,
        candidateCount: 0,
        selectedCharacters: 0,
        semanticConfidence: null,
      };

  return {
    memoryMaxItems,
    memoryMaxCharacters,
    selected: memoryContext.selected,
    memoryContext,
    memoryBlock: input.enabled ? buildSmartMemoryPrompt(memoryContext) : "",
  };
}
