export type EmeryCanonicalEvalCase = {
  id: string;
  prompt: string;
  channel: "chat" | "voice";
  surface?: string | null;
  expected: {
    domain?: "general" | "personal" | "hpo" | "mixed";
    capability?: string;
    needsCurrentContext?: boolean;
    needsPersonalMemory?: boolean;
    needsCalendar?: boolean;
    needsLocation?: boolean;
    voiceDisposition?: "normal" | "correction" | "short_follow_up" | "stop_speaking" | "end_session" | "likely_echo";
    ambientAddressed?: boolean;
    durableMemoryQuery?: boolean;
    writeIntent?: boolean;
  };
};

export const EMERY_CANONICAL_EVAL_CORPUS: EmeryCanonicalEvalCase[] = [
  {
    id: "hpo-next-stop",
    prompt: "Who’s next?",
    channel: "chat",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.route.get_next_stop",
      needsCurrentContext: true,
      needsPersonalMemory: false,
      needsCalendar: false,
      writeIntent: false,
    },
  },
  {
    id: "hpo-arrival",
    prompt: "I’m here.",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.route_stop.arrive",
      needsCurrentContext: true,
      needsPersonalMemory: false,
      needsCalendar: false,
      writeIntent: true,
    },
  },
  {
    id: "hpo-last-visit",
    prompt: "What happened here last time?",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.account.get_context",
      needsCurrentContext: true,
      needsPersonalMemory: false,
      writeIntent: false,
    },
  },
  {
    id: "hpo-current-account",
    prompt: "What account am I at?",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.account.get_current",
      needsCurrentContext: true,
      needsPersonalMemory: false,
      writeIntent: false,
    },
  },
  {
    id: "hpo-contact-pronoun",
    prompt: "What did she say?",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.account.get_context",
      needsCurrentContext: true,
      needsPersonalMemory: false,
      voiceDisposition: "short_follow_up",
      writeIntent: false,
    },
  },
  {
    id: "hpo-take-me-there",
    prompt: "Take me there.",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      needsCurrentContext: true,
      needsLocation: true,
      voiceDisposition: "short_follow_up",
      writeIntent: false,
    },
  },
  {
    id: "hpo-visit-capture",
    prompt: "Just left. Great visit with Sarah.",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.route_stop.log_visit",
      needsCurrentContext: true,
      writeIntent: true,
    },
  },
  {
    id: "hpo-follow-up",
    prompt: "Great meeting with Sarah. Follow up Thursday.",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      domain: "hpo",
      capability: "hpo.follow_up.create",
      needsCurrentContext: true,
      needsCalendar: true,
      writeIntent: true,
    },
  },
  {
    id: "voice-correction",
    prompt: "Actually Friday.",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      voiceDisposition: "correction",
      needsCurrentContext: true,
      writeIntent: true,
    },
  },
  {
    id: "execution-undo",
    prompt: "Undo that.",
    channel: "voice",
    surface: "hpo_planner",
    expected: {
      capability: "execution.undo",
      needsCurrentContext: true,
      writeIntent: true,
    },
  },
  {
    id: "personal-family-memory",
    prompt: "What did I tell you about my wife?",
    channel: "chat",
    expected: {
      needsPersonalMemory: true,
      durableMemoryQuery: true,
      writeIntent: false,
    },
  },
  {
    id: "hpo-relationship-memory",
    prompt: "What was that attorney where the receptionist gave me the paralegal information?",
    channel: "chat",
    surface: "hpo_accounts",
    expected: {
      domain: "hpo",
      needsCurrentContext: true,
      needsPersonalMemory: false,
      writeIntent: false,
    },
  },
  {
    id: "ambient-opinion",
    prompt: "Emery, what do you think?",
    channel: "voice",
    expected: {
      ambientAddressed: true,
      writeIntent: false,
    },
  },
  {
    id: "voice-stop",
    prompt: "Stop.",
    channel: "voice",
    expected: {
      voiceDisposition: "stop_speaking",
      writeIntent: false,
    },
  },
  {
    id: "voice-end",
    prompt: "Stop listening.",
    channel: "voice",
    expected: {
      voiceDisposition: "end_session",
      writeIntent: false,
    },
  },
];
