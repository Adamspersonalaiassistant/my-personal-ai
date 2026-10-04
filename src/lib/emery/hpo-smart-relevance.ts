/* eslint-disable @typescript-eslint/no-explicit-any */

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "that",
  "this",
  "what",
  "where",
  "which",
  "with",
  "from",
  "about",
  "office",
  "person",
  "someone",
  "there",
  "they",
  "them",
  "when",
]);

const GROUPS = [
  ["receptionist", "front", "desk", "frontdesk"],
  ["paralegal", "legal", "assistant"],
  ["attorney", "lawyer", "law", "legal"],
  ["doctor", "provider", "physician", "medical"],
  ["lunch", "meeting", "appointment"],
  ["email", "emailed", "contact", "information"],
  ["followup", "follow", "next", "action"],
];

function tokens(value: string) {
  const result = new Set(
    normalize(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP.has(token)),
  );
  for (const group of GROUPS) {
    if (!group.some((token) => result.has(token))) continue;
    for (const token of group) result.add(token);
  }
  return [...result];
}

function textScore(text: string, queryTokens: string[]) {
  const haystack = normalize(text);
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1.6;
  }
  for (let i = 0; i < queryTokens.length - 1; i += 1) {
    if (haystack.includes(`${queryTokens[i]} ${queryTokens[i + 1]}`)) score += 1.2;
  }
  return score;
}

function recency(value: unknown) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 7) return 1.3;
  if (days <= 30) return 0.8;
  if (days <= 120) return 0.3;
  return 0;
}

export type HpoRelationshipRank = {
  accountId: string;
  score: number;
  reasons: string[];
};

export function rankHpoRelationshipAccounts(input: {
  query: string;
  accounts: any[];
  contacts?: any[];
  interactions?: any[];
  currentAccountId?: string | null;
  currentRouteAccountIds?: string[];
  limit?: number;
}): HpoRelationshipRank[] {
  const queryTokens = tokens(input.query);
  const contactsByAccount = new Map<string, any[]>();
  for (const contact of input.contacts ?? []) {
    const id = String(contact.account_id ?? "");
    if (!id) continue;
    contactsByAccount.set(id, [...(contactsByAccount.get(id) ?? []), contact]);
  }
  const interactionsByAccount = new Map<string, any[]>();
  for (const interaction of input.interactions ?? []) {
    const id = String(interaction.account_id ?? "");
    if (!id) continue;
    interactionsByAccount.set(id, [...(interactionsByAccount.get(id) ?? []), interaction]);
  }
  const routeIds = new Set(input.currentRouteAccountIds ?? []);

  return input.accounts
    .map((account) => {
      const id = String(account.id ?? "");
      if (!id) return null;
      const reasons: string[] = [];
      const accountText = [
        account.name,
        account.account_type,
        account.specialty,
        account.territory,
        account.city,
        account.address,
        account.relationship_stage,
        account.relationship_health,
        account.next_action,
        account.opportunity,
        account.blockers,
        account.notes,
        ...(Array.isArray(account.tags) ? account.tags : []),
      ]
        .filter(Boolean)
        .join(" ");
      let score = textScore(accountText, queryTokens);
      if (score > 0) reasons.push("account fields match the request");

      const contacts = contactsByAccount.get(id) ?? [];
      const contactScore = contacts.reduce(
        (best, contact) =>
          Math.max(
            best,
            textScore(
              [contact.name, contact.role_title, contact.relationship_notes].filter(Boolean).join(" "),
              queryTokens,
            ),
          ),
        0,
      );
      if (contactScore > 0) {
        score += contactScore * 1.2;
        reasons.push("contact history matches the request");
      }

      const interactions = interactionsByAccount.get(id) ?? [];
      let interactionScore = 0;
      let interactionRecency = 0;
      for (const interaction of interactions.slice(0, 20)) {
        const candidate = textScore(
          [
            interaction.summary,
            interaction.outcome,
            interaction.relationship_signal,
            interaction.next_action,
          ]
            .filter(Boolean)
            .join(" "),
          queryTokens,
        );
        if (candidate > interactionScore) {
          interactionScore = candidate;
          interactionRecency = recency(interaction.occurred_at);
        }
      }
      if (interactionScore > 0) {
        score += interactionScore * 1.7 + interactionRecency;
        reasons.push("structured interaction history matches the request");
      }

      if (input.currentAccountId && id === input.currentAccountId) {
        score += 8;
        reasons.push("current account context");
      } else if (routeIds.has(id)) {
        score += 3.2;
        reasons.push("active route relationship");
      }

      const priority = Math.max(1, Math.min(5, Number(account.priority ?? 3)));
      score += priority * 0.18;
      const lastTouch = recency(account.last_touch_at);
      score += lastTouch * 0.35;
      return { accountId: id, score, reasons };
    })
    .filter((item): item is HpoRelationshipRank => Boolean(item) && item!.score >= 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(30, Math.max(1, input.limit ?? 24)));
}
