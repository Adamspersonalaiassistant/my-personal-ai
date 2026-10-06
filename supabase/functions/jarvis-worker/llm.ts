// LLM adapter for candidate edits and repairs. Uses Emery's existing OpenAI
// provisioning (baseline infrastructure — not a new paid-credit path).
// Pure: fetch is injected. Output is strict JSON that the engine validates;
// nothing the model returns is executed here.

export type PlannedEdit =
  { path: string; find: string; replace: string } | { path: string; create: true; content: string };

export type EditPlan = { summary: string; edits: PlannedEdit[] };

export interface Planner {
  planEdits(input: {
    objective: string;
    files: Array<{ path: string; content: string }>;
    constraints: string[];
    feedback?: string;
  }): Promise<EditPlan>;
  repair(input: {
    objective: string;
    failures: Array<{ path: string; line: number | null; title: string; message: string }>;
    files: Array<{ path: string; content: string }>;
  }): Promise<EditPlan>;
  research(question: string): Promise<{ answer: string; sources: string[] }>;
}

const SYSTEM = `You are JARVIS Engineer making a minimal, safe code change to the Emery TypeScript/React codebase.
Rules:
- Make the smallest change that satisfies the objective. Match surrounding style.
- Only edit the files provided unless creating a clearly necessary new file.
- Each edit is either {"path","find","replace"} where "find" is an EXACT substring that occurs exactly once in the provided file, or {"path","create":true,"content"} for a new file.
- Never touch .env files, CI workflows, credentials, migrations, auth or RLS.
- Return ONLY a JSON object: {"summary": string, "edits": [...]}. No markdown.`;

function parsePlan(text: string): EditPlan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Planner returned no JSON object.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
  const clean: PlannedEdit[] = [];
  for (const e of edits.slice(0, 12)) {
    if (!e || typeof e.path !== "string") continue;
    if (e.create === true && typeof e.content === "string")
      clean.push({ path: e.path, create: true, content: e.content });
    else if (typeof e.find === "string" && typeof e.replace === "string")
      clean.push({ path: e.path, find: e.find, replace: e.replace });
  }
  if (!clean.length) throw new Error("Planner returned no usable edits.");
  return { summary: String(parsed.summary ?? "").slice(0, 600), edits: clean };
}

export class OpenAiPlanner implements Planner {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, model: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetcher = fetcher;
  }

  private async complete(input: unknown[], tools?: unknown[]) {
    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input,
        ...(tools ? { tools, tool_choice: "required" } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Model call failed (${response.status}).`);
    const payload: any = await response.json();
    let text = typeof payload?.output_text === "string" ? payload.output_text : "";
    const sources: string[] = [];
    for (const item of Array.isArray(payload?.output) ? payload.output : [])
      for (const content of Array.isArray(item?.content) ? item.content : []) {
        if (!text && content?.type === "output_text") text += content.text ?? "";
        for (const a of Array.isArray(content?.annotations) ? content.annotations : []) {
          const url = a?.url ?? a?.url_citation?.url;
          if (typeof url === "string") sources.push(url);
        }
      }
    return { text, sources };
  }

  async planEdits(input: Parameters<Planner["planEdits"]>[0]) {
    const files = input.files
      .map((f) => `=== FILE ${f.path} ===\n${f.content.slice(0, 14000)}`)
      .join("\n\n");
    const { text } = await this.complete([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `OBJECTIVE:\n${input.objective}\n\nCONSTRAINTS:\n- ${input.constraints.join("\n- ")}\n${input.feedback ? `\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${input.feedback}\n` : ""}\nFILES:\n${files}`,
      },
    ]);
    return parsePlan(text);
  }

  async repair(input: Parameters<Planner["repair"]>[0]) {
    const failures = input.failures
      .map((f) => `- ${f.path}${f.line ? `:${f.line}` : ""} ${f.title}: ${f.message}`)
      .join("\n");
    const files = input.files
      .map((f) => `=== FILE ${f.path} ===\n${f.content.slice(0, 14000)}`)
      .join("\n\n");
    const { text } = await this.complete([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `The candidate change for this objective failed the isolated CI checks. Fix ONLY what the failures require.\n\nOBJECTIVE:\n${input.objective}\n\nCI FAILURES:\n${failures}\n\nCURRENT FILES ON THE CANDIDATE BRANCH:\n${files}`,
      },
    ]);
    return parsePlan(text);
  }

  async research(question: string) {
    const { text, sources } = await this.complete(
      [
        {
          role: "system",
          content:
            "Answer one specific engineering question from current primary sources in 3-5 concise bullets, then one line starting 'Recommendation:'.",
        },
        { role: "user", content: question },
      ],
      [{ type: "web_search" }],
    );
    return { answer: text.slice(0, 3000), sources: [...new Set(sources)].slice(0, 6) };
  }
}

export { parsePlan };
