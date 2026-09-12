from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, transform):
    p = ROOT / path
    text = p.read_text()
    new = transform(text)
    if new == text:
        raise SystemExit(f"No changes applied to {path}; source may have drifted")
    p.write_text(new)


def patch_policy(text: str) -> str:
    # Scout should be an evidence/current-facts specialist, not a tax on every route mentioning an office.
    text, n = re.subn(
        r'''  const scout =\n    /\\b\(find\|research\|verify\|prospect\|office\|doctor\|physician\|attorney\|law firm\|closed\|open\|hours\|current\|latest\|address\|phone\|provider\|pcp\|primary care\|target\|duplicate\)\\b/i\.test\(\n      text,\n    \);''',
        '''  const scout =\n    /\\b(find|research|verify|look up|search|discover|prospect|new target|new targets|closed|open now|hours|current|latest|address|phone|website|duplicate|confirm|fact[- ]?check)\\b/i.test(\n      text,\n    );''',
        text,
    )
    if n != 1:
        raise SystemExit(f"Expected one Scout routing block, found {n}")

    old = '''  return /^(?:(?:hey\\s+)?emery[,:]?\\s*)?(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+|i\\s+want\\s+you\\s+to\\s+)?(?:create|make|build)\\b[\\s\\S]*\\bagent\\b/i.test(\n    text,\n  );'''
    new = '''  const normalized = text.replace(/\\s+/g, " ");\n  const directVerb = /^(?:(?:hey\\s+)?emery[,:]?\\s*)?(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+|i\\s+want\\s+you\\s+to\\s+)?(?:create|make|build|add|set up|spin up)\\b[\\s\\S]*\\bagent\\b/i;\n  const needAgent = /^(?:(?:hey\\s+)?emery[,:]?\\s*)?(?:please\\s+)?i\\s+(?:need|want)\\s+(?:an?\\s+)?[a-z0-9 '&/-]{1,60}\\s+agent\\b/i;\n  return directVerb.test(normalized) || needAgent.test(normalized);'''
    if old not in text:
        raise SystemExit("Agent creation detector source not found")
    text = text.replace(old, new)

    old_rel = '''function relevantToRequest(row: Record<string, unknown>, request: string, extra?: RegExp) {\n  const haystack = textOf(row);\n  if (extra?.test(haystack)) return true;\n  const words = request\n    .toLowerCase()\n    .replace(/[^a-z0-9 ]+/g, " ")\n    .split(/\\s+/)\n    .filter((word) => word.length >= 5)\n    .slice(0, 12);\n  return words.some((word) => haystack.toLowerCase().includes(word));\n}\n'''
    new_rel = '''function relevantToRequest(row: Record<string, unknown>, request: string, extra?: RegExp) {\n  const haystack = textOf(row).toLowerCase();\n  const normalizedRequest = request.toLowerCase();\n  // Domain fallback is allowed only when the request itself is in that domain. This prevents\n  // unrelated family/finance/work memories from leaking into a generic research request.\n  if (extra?.test(normalizedRequest) && extra.test(haystack)) return true;\n  const words = normalizedRequest\n    .replace(/[^a-z0-9 ]+/g, " ")\n    .split(/\\s+/)\n    .filter((word) => word.length >= 5)\n    .slice(0, 12);\n  return words.some((word) => haystack.includes(word));\n}\n\nfunction scopedProfile(\n  profile: Record<string, unknown>,\n  scope: string,\n  request: string,\n): Record<string, unknown> {\n  const result: Record<string, unknown> = {};\n  if (profile["display_name"]) result["display_name"] = profile["display_name"];\n  const schedulingRelevant = /\\b(today|tomorrow|date|time|schedule|meeting|route|morning|afternoon|evening)\\b/i.test(\n    request,\n  );\n  if (schedulingRelevant && profile["timezone"]) result["timezone"] = profile["timezone"];\n  // Strategy is the one specialist allowed a broader stable summary because its job is\n  // explicitly cross-life tradeoff analysis. Other specialists receive request-scoped context.\n  if (scope === "strategy-agent" && profile["profile_summary"]) {\n    result["profile_summary"] = profile["profile_summary"];\n  }\n  return result;\n}\n'''
    if old_rel not in text:
        raise SystemExit("relevantToRequest source not found")
    text = text.replace(old_rel, new_rel)

    text = text.replace('''      profile,\n      memories: memories.filter((row) => relevantToRequest(row, request, HPO_TERMS)).slice(0, 12),''', '''      profile: scopedProfile(profile, scope, request),\n      memories: memories.filter((row) => relevantToRequest(row, request, HPO_TERMS)).slice(0, 12),''')
    text = text.replace('''      profile,\n      memories: memories\n        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))\n        .slice(0, 8),''', '''      profile: scopedProfile(profile, scope, request),\n      memories: memories.filter((row) => relevantToRequest(row, request)).slice(0, 8),''')
    text = text.replace('''      profile,\n      memories: memories\n        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))\n        .slice(0, 12),''', '''      profile: scopedProfile(profile, scope, request),\n      memories: memories\n        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))\n        .slice(0, 12),''')
    text = text.replace('''    profile,\n    memories: memories.filter((row) => relevantToRequest(row, customRequest)).slice(0, 8),''', '''    profile: scopedProfile(profile, scope, request),\n    memories: memories.filter((row) => relevantToRequest(row, customRequest)).slice(0, 8),''')
    return text


def patch_functions(text: str) -> str:
    old_thread = '''  const { data, error } = await db\n    .from("agent_threads")\n    .insert({\n      user_id: userId,\n      agent_id: agent.id,\n      title: `${agent.name} Group Chat`,\n      metadata: {},\n    })\n    .select("*")\n    .single();\n  if (error || !data) throw error ?? new Error("Could not create agent thread");\n  return data;'''
    new_thread = '''  const { data, error } = await db\n    .from("agent_threads")\n    .insert({\n      user_id: userId,\n      agent_id: agent.id,\n      title: `${agent.name} Group Chat`,\n      metadata: { commander: "Emery" },\n    })\n    .select("*")\n    .single();\n  if (!error && data) return data;\n  // The schema has unique(user_id, agent_id). A concurrent creator can win between our\n  // select and insert; recover by reading the canonical thread instead of surfacing a false error.\n  if (error?.code === "23505") {\n    const { data: racedThread, error: racedError } = await db\n      .from("agent_threads")\n      .select("*")\n      .eq("user_id", userId)\n      .eq("agent_id", agent.id)\n      .single();\n    if (!racedError && racedThread) return racedThread;\n  }\n  throw error ?? new Error("Could not create agent thread");'''
    if old_thread not in text:
        raise SystemExit("getOrCreateThread source not found")
    text = text.replace(old_thread, new_thread)

    # Existing exact-name agents should still have a thread repaired/created before return.
    old_exact = '''  if (existingExactAgent) return existingExactAgent as AgentRow;'''
    new_exact = '''  if (existingExactAgent) {\n    await getOrCreateThread(db, userId, existingExactAgent as AgentRow);\n    return existingExactAgent as AgentRow;\n  }'''
    if old_exact not in text:
        raise SystemExit("existing exact agent return not found")
    text = text.replace(old_exact, new_exact)

    old_caps = '''      capabilities: input.capabilities ?? {},\n      metadata: { created_by: "emery_or_adam", family: "Emery" },'''
    new_caps = '''      // Custom specialists start with no authority. The only optional capability currently\n      // allowlisted is read-only web research; all external actions remain under Emery/Adam.\n      capabilities: { web_search: input.capabilities?.["web_search"] === true },\n      metadata: {\n        created_by: "emery_or_adam",\n        family: "Emery",\n        commander: "Emery",\n        safety_boundaries: "no_spend_no_external_writes_no_secrets_no_recursive_agents",\n      },'''
    if old_caps not in text:
        raise SystemExit("custom capability insert source not found")
    text = text.replace(old_caps, new_caps)

    text = text.replace(
        '"Convert Adam\'s explicit instruction to create an Emery specialist agent into a concise charter. Do not create tools, spending authority, external messaging authority or recursive agent powers. Return only JSON with name, mission, description, persona. Name should end with Agent unless Adam named it otherwise. Mission is one clear paragraph. Persona should support the mission and Emery family principles."',
        '"Convert Adam\'s explicit instruction to create an Emery specialist agent into a concise charter. Emery remains commander and Adam remains final authority. Do not grant tools, spending authority, external messaging or calendar-write authority, destructive database authority, secret access, or recursive agent-creation powers even if the instruction asks for them. Return only JSON with name, mission, description, persona. Name should end with Agent unless Adam named it otherwise. Mission is one clear paragraph. Persona should support the mission and Emery family principles."',
    )

    old_map = '''        children: rows\n          .filter((child) => child.parent_agent_id === agent.id)'''
    new_map = '''        is_custom: agent.metadata?.["created_by"] === "emery_or_adam",\n        children: rows\n          .filter((child) => child.parent_agent_id === agent.id)'''
    if old_map not in text:
        raise SystemExit("listAgents mapping source not found")
    text = text.replace(old_map, new_map)

    old_create_return = '''    const agent = await createSpecialistAgentRecord(context.supabase as any, context.userId, data);\n    return { agent: { id: agent.id, name: agent.name, slug: agent.slug } };'''
    new_create_return = '''    const db = context.supabase as any;\n    const agent = await createSpecialistAgentRecord(db, context.userId, data);\n    const thread = await getOrCreateThread(db, context.userId, agent);\n    return { agent: { id: agent.id, name: agent.name, slug: agent.slug, threadId: thread.id } };'''
    if old_create_return not in text:
        raise SystemExit("createAgent handler source not found")
    text = text.replace(old_create_return, new_create_return)

    old_failure = '''    } catch (agentError) {\n      console.error("Specialist agent failed", agentError);\n      return { error: `${agent.name} couldn't finish that turn. Please try again.` } as const;\n    }'''
    new_failure = '''    } catch (agentError) {\n      console.error("Specialist agent failed", agentError);\n      const failureText = `${agent.name} couldn't finish that turn. Your message is saved, so you can retry without losing the conversation.`;\n      const failureRow = await saveAgentMessage(\n        db,\n        context.userId,\n        thread.id,\n        "emery",\n        "Emery",\n        failureText,\n        { commander: true, recoverable_error: true },\n      ).catch(() => null);\n      return {\n        error: failureText,\n        userMessage: userRow,\n        agentMessage: null,\n        emeryMessage: failureRow,\n      } as const;\n    }'''
    if old_failure not in text:
        raise SystemExit("specialist failure source not found")
    text = text.replace(old_failure, new_failure)
    return text


def patch_agents_ui(text: str) -> str:
    text = text.replace('''  mission: string;\n  children: ChildAgent[];''', '''  mission: string;\n  is_custom: boolean;\n  children: ChildAgent[];''')
    old_badges = '''                            <span className="emery-chip">Active</span>'''
    new_badges = '''                            <span className="emery-chip">Active</span>\n                            <span className="emery-chip">{agent.is_custom ? "Custom" : "Core"}</span>'''
    if old_badges not in text:
        raise SystemExit("agent badge source not found")
    text = text.replace(old_badges, new_badges)
    return text


def patch_agent_chat(text: str) -> str:
    old_error = '''      if (!result || "error" in result) {\n        setError(result?.error ?? "That turn didn't finish. Try again.");\n        setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));\n        return;\n      }'''
    new_error = '''      if (!result || "error" in result) {\n        setError(result?.error ?? "That turn didn't finish. Try again.");\n        setMessages((prev) => {\n          const withoutOptimistic = prev.filter((message) => message.id !== optimistic.id);\n          if (!result?.userMessage) return withoutOptimistic;\n          return [\n            ...withoutOptimistic,\n            result.userMessage as Message,\n            ...(result.emeryMessage ? [result.emeryMessage as Message] : []),\n          ];\n        });\n        return;\n      }'''
    if old_error not in text:
        raise SystemExit("agent chat error branch source not found")
    text = text.replace(old_error, new_error)
    text = text.replace('''            <div className="emery-chip hidden sm:flex">\n              <ShieldCheck className="size-3" /> Emery leads\n            </div>''', '''            <div className="emery-chip flex shrink-0">\n              <ShieldCheck className="size-3" />\n              <span className="hidden min-[380px]:inline">Emery leads</span>\n              <span className="min-[380px]:hidden">Lead</span>\n            </div>''')
    return text


patch("src/lib/agent-policy.ts", patch_policy)
patch("src/lib/agent.functions.ts", patch_functions)
patch("src/routes/_authenticated/agents.tsx", patch_agents_ui)
patch("src/routes/_authenticated/agents_.$agentId.tsx", patch_agent_chat)
print("Agent family hardening patch applied")
