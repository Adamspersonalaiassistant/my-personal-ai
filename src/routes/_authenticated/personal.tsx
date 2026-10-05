import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckSquare, FolderKanban, Heart, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getOperatingSystemSnapshot } from "@/lib/os.functions";

export const Route = createFileRoute("/_authenticated/personal")({ component: Personal });

function domainOf(item: any) {
  return item?.metadata && typeof item.metadata === "object" ? item.metadata.domain : null;
}

function Personal() {
  const load = useServerFn(getOperatingSystemSnapshot);
  const [data, setData] = useState<any>(null);
  useEffect(() => { void load({}).then(setData).catch(console.error); }, [load]);
  const personalTasks = useMemo(() => (data?.tasks ?? []).filter((x: any) => domainOf(x) === "personal" || domainOf(x) === "mixed"), [data]);
  const personalMeetings = useMemo(() => (data?.meetings ?? []).filter((x: any) => domainOf(x) === "personal" || domainOf(x) === "mixed"), [data]);

  return <AppShell title="Personal" askEmery="I’m looking at Personal. Help me with the highest-value non-HPO thing that matters right now.">
    <div className="space-y-4">
      <section className="emery-glass-strong rounded-[1.6rem] p-5">
        <div className="flex items-center gap-2 text-primary"><Heart className="size-4"/><p className="emery-kicker">Personal workspace</p></div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Life outside HPO, with the same Emery.</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Family, plans, personal projects, routines, goals and appointments live here. You never need to choose this tab before talking; Emery routes natural conversation behind the scenes.</p>
        <Link to="/conversation" className="emery-press mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><MessageCircle className="size-4"/>Talk to Emery</Link>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <Card icon={CheckSquare} label="Personal tasks" value={personalTasks.length} to="/tasks" />
        <Card icon={CalendarDays} label="Personal events" value={personalMeetings.length} to="/meetings" />
        <Card icon={FolderKanban} label="Projects" value={(data?.projects ?? []).length} to="/projects" />
      </section>
      <section className="emery-glass rounded-[1.5rem] p-4"><p className="text-sm font-semibold">What belongs here</p><p className="mt-1.5 text-sm leading-6 text-muted-foreground">Personal tasks and plans, family/life context, routines, ideas, appointments, goals and non-HPO projects. General conversation stays conversational unless it becomes durable or actionable.</p></section>
    </div>
  </AppShell>;
}

function Card({icon: Icon,label,value,to}:{icon:typeof Heart;label:string;value:number;to:"/tasks"|"/meetings"|"/projects"}) {
  return <Link to={to} className="emery-press emery-glass rounded-[1.35rem] p-4"><Icon className="size-4 text-primary"/><p className="mt-3 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></Link>;
}
