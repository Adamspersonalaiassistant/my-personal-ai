import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import brainImage from "@/assets/neural-brain.png";

export const Route = createFileRoute("/")({
  ssr: false,
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/chat", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate({ to: "/chat", replace: true });
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-5 py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="emery-grid absolute inset-0 opacity-95" />
        <div className="absolute left-1/2 top-[-12%] h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/[0.12] blur-[115px]" />
        <div className="absolute -bottom-40 -right-32 size-96 rounded-full bg-[oklch(0.55_0.16_225/0.12)] blur-[100px]" />
        <div className="absolute left-[-12rem] top-1/2 size-80 rounded-full bg-[oklch(0.46_0.13_265/0.08)] blur-[100px]" />
      </div>

      <div className="relative mx-auto w-full max-w-sm">
        <div className="emery-glass rounded-2xl p-6 sm:p-7">
          <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.06] emery-glow">
            <img src={brainImage} alt="Emery neural core" className="h-24 w-24 object-cover emery-breathe" />
          </div>

          <div className="mt-5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">Personal intelligence system</p>
            <h1 className="emery-text-gradient mt-2 text-4xl font-semibold tracking-tight">Emery</h1>
            <p className="mx-auto mt-3 max-w-[18rem] text-sm leading-6 text-muted-foreground">
              Your private intelligence, ready when you are.
            </p>
          </div>

          {!isSupabaseConfigured ? (
            <div className="mt-6 rounded-xl border border-primary/20 bg-primary/[0.06] p-4 text-sm text-muted-foreground">
              Your database connection needs attention before Emery can sign you in.
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-7 space-y-3.5">
            <label className="relative block">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 w-full rounded-xl border border-input bg-card/70 pl-12 pr-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground/75 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              />
            </label>

            <label className="relative block">
              <Lock className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 w-full rounded-xl border border-input bg-card/70 pl-12 pr-12 text-base text-foreground outline-none transition placeholder:text-muted-foreground/75 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
              </button>
            </label>

            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                  className="size-4 accent-[#34a4ff]"
                />
                Keep me signed in
              </label>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" /> Private
              </span>
            </div>

            {error ? (
              <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={loading || !isSupabaseConfigured}
              className="mt-1 h-14 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-[0_0_30px_oklch(0.72_0.17_244/0.24)] hover:brightness-110"
            >
              {loading ? <Loader2 className="mr-2 size-5 animate-spin" /> : null}
              Enter Emery
              {!loading ? <ArrowRight className="ml-2 size-5" /> : null}
            </Button>
          </form>

          <p className="mt-6 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground/75">
            Adam’s private personal AI
          </p>
        </div>
      </div>
    </div>
  );
}
