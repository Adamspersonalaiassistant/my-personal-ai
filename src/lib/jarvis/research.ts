/* eslint-disable @typescript-eslint/no-explicit-any */
// Bounded engineering research. One question → one sourced web pass, plus
// public GitHub search and license classification. No open-ended browsing.
//
// Web research uses Emery's already-provisioned OpenAI Responses web_search
// tool (baseline infrastructure, not a new paid-credit path).

import { classifyLicense, type GithubClient } from "./github.ts";
import { redactSecrets } from "./policy.ts";

export async function webResearch(
  apiKey: string,
  model: string,
  question: string,
  fetcher: typeof fetch = fetch,
) {
  const q = String(question ?? "")
    .trim()
    .slice(0, 600);
  if (q.length < 8) throw new Error("Ask one specific engineering question.");
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      input: [
        {
          role: "system",
          content:
            "You are a precise engineering researcher. Answer ONE specific technical question using current official documentation, API references, release notes or reputable GitHub sources. Prefer primary sources. Return: (1) a 3-6 bullet answer, (2) what is uncertain or version-dependent, (3) any license constraints if code reuse is involved. Be concise. Never include credentials.",
        },
        { role: "user", content: q },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Web research failed (${response.status}).`);
  const payload = await response.json();
  const sources = new Map<string, string>();
  let text = typeof payload?.output_text === "string" ? payload.output_text : "";
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (!text && content?.type === "output_text") text += content.text ?? "";
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const url = annotation?.url ?? annotation?.url_citation?.url;
        if (typeof url === "string" && url.startsWith("http"))
          sources.set(url, String(annotation?.title ?? url));
      }
    }
  }
  return {
    question: q,
    answer: redactSecrets(String(text).trim()).slice(0, 4000),
    sources: [...sources.entries()].slice(0, 8).map(([url, title]) => ({ title, url })),
    next_step:
      "Compare against Emery's current implementation, then classify as ignore / watch / test / adopt / engineering_task with research.record_finding.",
  };
}

export async function githubResearch(github: GithubClient, query: string, language?: string) {
  const repos = await github.searchRepositories(query, language);
  return {
    query,
    repositories: repos.map((repo: any) => ({
      ...repo,
      license_verdict: classifyLicense(repo.license).verdict,
    })),
    reuse_rule:
      "Before copying: verify license, record source URL + license, preserve notices, security-review, adapt to Emery architecture, run regressions. Incompatible/unknown license → learn the pattern and implement independently.",
  };
}

export async function licenseCheck(github: GithubClient, repo: string) {
  const license = await github.repositoryLicense(repo);
  return { repo, ...license, ...classifyLicense(license.spdx) };
}
