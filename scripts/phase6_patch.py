from pathlib import Path


def replace(path: str, old: str, new: str, required: bool = True) -> None:
    p = Path(path)
    text = p.read_text()
    if old in text:
        p.write_text(text.replace(old, new))
        return
    if required and new not in text:
        raise SystemExit(f"Missing patch marker in {path}: {old[:120]!r}")


# Chat: bounded live context in the main Emery surface.
replace(
    "src/routes/_authenticated/chat.tsx",
    'import { AppShell } from "@/components/AppShell";\n',
    'import { AppShell } from "@/components/AppShell";\nimport { OperatingContextCard } from "@/components/OperatingContextCard";\n',
)
replace(
    "src/routes/_authenticated/chat.tsx",
    '        <div className="emery-scrollbar flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 sm:pt-6">\n',
    '        <div className="emery-scrollbar flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 sm:pt-6">\n          <div className="mx-auto mb-4 max-w-2xl">\n            <OperatingContextCard />\n          </div>\n',
)

# Settings: recent attachments become visible system context.
replace(
    "src/routes/_authenticated/settings.tsx",
    'import { AppShell } from "@/components/AppShell";\n',
    'import { AppShell } from "@/components/AppShell";\nimport { RecentFilesCard } from "@/components/RecentFilesCard";\n',
)
replace(
    "src/routes/_authenticated/settings.tsx",
    '        <section className="emery-glass overflow-hidden rounded-[1.7rem]">\n',
    '        <RecentFilesCard />\n\n        <section className="emery-glass overflow-hidden rounded-[1.7rem]">\n',
)

# Projects: connected execution overview.
replace(
    "src/routes/_authenticated/projects.tsx",
    'import { AppShell } from "@/components/AppShell";\n',
    'import { AppShell } from "@/components/AppShell";\nimport { ProjectExecutionOverview } from "@/components/ProjectExecutionOverview";\n',
)
replace(
    "src/routes/_authenticated/projects.tsx",
    '        {error ? (\n',
    '        <ProjectExecutionOverview />\n\n        {error ? (\n',
)

# Tasks: linked projects and unified reads.
replace(
    "src/routes/_authenticated/tasks.tsx",
    'import { createTask, listTasks, setTaskCompleted } from "@/lib/emery.functions";\n',
    'import { setTaskCompleted } from "@/lib/emery.functions";\nimport { createLinkedTask, listProjectOptions, listUnifiedTasks } from "@/lib/os.functions";\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '  project_id: string | null;\n  metadata: unknown;\n',
    '  project_id: string | null;\n  project_name: string | null;\n  metadata: unknown;\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    'function Tasks() {\n  const loadTasks = useServerFn(listTasks);\n  const addTask = useServerFn(createTask);\n',
    'type ProjectOption = { id: string; name: string; priority: number; status: string };\n\nfunction Tasks() {\n  const loadTasks = useServerFn(listUnifiedTasks);\n  const loadProjects = useServerFn(listProjectOptions);\n  const addTask = useServerFn(createLinkedTask);\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '  const [priority, setPriority] = useState(3);\n',
    '  const [priority, setPriority] = useState(3);\n  const [projectId, setProjectId] = useState("");\n  const [projects, setProjects] = useState<ProjectOption[]>([]);\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '        const result = await loadTasks({});\n        if (!cancelled) setTasks((result?.tasks ?? []) as Task[]);\n',
    '        const [result, projectResult] = await Promise.all([loadTasks({}), loadProjects({})]);\n        if (!cancelled) {\n          setTasks((result?.tasks ?? []) as Task[]);\n          setProjects((projectResult?.projects ?? []) as ProjectOption[]);\n        }\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '  }, [loadTasks]);\n',
    '  }, [loadProjects, loadTasks]);\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '        data: { title, details, dueAt: due ? new Date(due).toISOString() : null, priority },\n',
    '        data: { title, details, dueAt: due ? new Date(due).toISOString() : null, priority, projectId: projectId || null },\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '      setPriority(3);\n      setShowAdd(false);\n',
    '      setPriority(3);\n      setProjectId("");\n      setShowAdd(false);\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '              <label className="block text-xs font-medium text-muted-foreground">Priority</label>\n',
    '              <label className="block text-xs font-medium text-muted-foreground">Project (optional)</label>\n              <select\n                value={projectId}\n                onChange={(event) => setProjectId(event.target.value)}\n                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none"\n              >\n                <option value="">No project</option>\n                {projects.map((project) => (\n                  <option key={project.id} value={project.id}>{project.name}</option>\n                ))}\n              </select>\n              <label className="block text-xs font-medium text-muted-foreground">Priority</label>\n',
)
replace(
    "src/routes/_authenticated/tasks.tsx",
    '                    <span className="emery-chip text-muted-foreground">\n                      Priority {task.priority}\n                    </span>\n',
    '                    <span className="emery-chip text-muted-foreground">\n                      Priority {task.priority}\n                    </span>\n                    {task.project_name ? <span className="emery-chip">{task.project_name}</span> : null}\n',
)

# Meetings: project links stored safely in existing metadata.
replace(
    "src/routes/_authenticated/meetings.tsx",
    'import { createMeeting, listMeetings } from "@/lib/emery.functions";\n',
    'import { createLinkedMeeting, listProjectOptions, listUnifiedMeetings } from "@/lib/os.functions";\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '  summary: string | null;\n  created_at: string;\n};\n',
    '  summary: string | null;\n  project_id: string | null;\n  project_name: string | null;\n  created_at: string;\n};\n\ntype ProjectOption = { id: string; name: string; priority: number; status: string };\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '  const loadMeetings = useServerFn(listMeetings);\n  const addMeeting = useServerFn(createMeeting);\n',
    '  const loadMeetings = useServerFn(listUnifiedMeetings);\n  const loadProjects = useServerFn(listProjectOptions);\n  const addMeeting = useServerFn(createLinkedMeeting);\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '  const [showAdd, setShowAdd] = useState(false);\n',
    '  const [showAdd, setShowAdd] = useState(false);\n  const [projects, setProjects] = useState<ProjectOption[]>([]);\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '        const result = await loadMeetings({});\n        if (!cancelled) setMeetings((result?.meetings ?? []) as Meeting[]);\n',
    '        const [result, projectResult] = await Promise.all([loadMeetings({}), loadProjects({})]);\n        if (!cancelled) {\n          setMeetings((result?.meetings ?? []) as Meeting[]);\n          setProjects((projectResult?.projects ?? []) as ProjectOption[]);\n        }\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '  }, [loadMeetings]);\n',
    '  }, [loadMeetings, loadProjects]);\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '        <MeetingEditor\n          onClose={() => setShowAdd(false)}\n',
    '        <MeetingEditor\n          projects={projects}\n          onClose={() => setShowAdd(false)}\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '                      {!past ? <span className="emery-chip">Upcoming</span> : null}\n',
    '                      {!past ? <span className="emery-chip">Upcoming</span> : null}\n                      {meeting.project_name ? <span className="emery-chip">{meeting.project_name}</span> : null}\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    'function MeetingEditor({\n  onClose,\n  onSave,\n}: {\n  onClose: () => void;\n  onSave: (values: { title: string; meetingAt: string; participants?: string[] }) => Promise<void>;\n}) {\n',
    'function MeetingEditor({\n  projects,\n  onClose,\n  onSave,\n}: {\n  projects: ProjectOption[];\n  onClose: () => void;\n  onSave: (values: { title: string; meetingAt: string; participants?: string[]; projectId?: string | null }) => Promise<void>;\n}) {\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '  const [participants, setParticipants] = useState("");\n',
    '  const [participants, setParticipants] = useState("");\n  const [projectId, setProjectId] = useState("");\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '        participants: participants\n          .split(",")\n          .map((item) => item.trim())\n          .filter(Boolean),\n',
    '        participants: participants\n          .split(",")\n          .map((item) => item.trim())\n          .filter(Boolean),\n        projectId: projectId || null,\n',
)
replace(
    "src/routes/_authenticated/meetings.tsx",
    '          <input\n            value={participants}\n            onChange={(event) => setParticipants(event.target.value)}\n            placeholder="Participants, separated by commas (optional)"\n',
    '          <label className="block text-xs font-medium text-muted-foreground">Project (optional)</label>\n          <select\n            value={projectId}\n            onChange={(event) => setProjectId(event.target.value)}\n            className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none"\n          >\n            <option value="">No project</option>\n            {projects.map((project) => (\n              <option key={project.id} value={project.id}>{project.name}</option>\n            ))}\n          </select>\n          <input\n            value={participants}\n            onChange={(event) => setParticipants(event.target.value)}\n            placeholder="Participants, separated by commas (optional)"\n',
)

# Prompt/action context: translate relationships into human-readable project names.
replace(
    "src/lib/emery.functions.ts",
    '    participants: unknown;\n  }>;\n};\n',
    '    participants: unknown;\n    metadata: unknown;\n  }>;\n};\n',
)
replace(
    "src/lib/emery.functions.ts",
    '.select("id, title, meeting_at, participants")\n',
    '.select("id, title, meeting_at, participants, metadata")\n',
)
replace(
    "src/lib/emery.functions.ts",
    'function buildActionContextBlock(context: ActionContext) {\n  const maxCharacters = 7000;\n  const lines: string[] = ["OPEN TASKS:"];',
    'function buildActionContextBlock(context: ActionContext) {\n  const maxCharacters = 7000;\n  const projectNames = new Map(context.projects.map((project) => [project.id, project.name]));\n  const lines: string[] = ["OPEN TASKS:"];',
)
replace(
    "src/lib/emery.functions.ts",
    '`- TASK ${task.id}: ${task.title} | priority ${task.priority} | due ${task.due_at ?? "none"} | project ${task.project_id ?? "none"} | status ${task.status}${task.details ? ` | details ${task.details.slice(0, 240)}` : ""}`,\n',
    '`- TASK ${task.id}: ${task.title} | priority ${task.priority} | due ${task.due_at ?? "none"} | project ${task.project_id ? `${projectNames.get(task.project_id) ?? "unknown"} (${task.project_id})` : "none"} | status ${task.status}${task.details ? ` | details ${task.details.slice(0, 240)}` : ""}`,\n',
)
replace(
    "src/lib/emery.functions.ts",
    '`- MEETING ${meeting.id}: ${meeting.title ?? "Untitled"} | at ${meeting.meeting_at ?? "unknown"} | participants ${JSON.stringify(meeting.participants ?? [])}`,\n',
    '`- MEETING ${meeting.id}: ${meeting.title ?? "Untitled"} | at ${meeting.meeting_at ?? "unknown"} | project ${typeof safeObject(meeting.metadata)["project_id"] === "string" ? `${projectNames.get(String(safeObject(meeting.metadata)["project_id"])) ?? "unknown"} (${String(safeObject(meeting.metadata)["project_id"])})` : "none"} | participants ${JSON.stringify(meeting.participants ?? [])}`,\n',
)
