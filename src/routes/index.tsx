import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    <div className="relative flex min-h-[100dvh] flex-col justify-center overflow-hidden bg-[oklch(0.16_0.035_160)] px-5 py-10">
      {/* ambient glow + curved light waves */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-1/3 top-[-20%] h-[70vh] w-[120vw] rotate-[-18deg] rounded-[100%] bg-[radial-gradient(ellipse_at_center,oklch(0.72_0.19_155/0.30),transparent_65%)] blur-3xl" />
        <div className="absolute -right-1/3 bottom-[-25%] h-[70vh] w-[120vw] rotate-[12deg] rounded-[100%] bg-[radial-gradient(ellipse_at_center,oklch(0.68_0.18_158/0.26),transparent_65%)] blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[60vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,oklch(0.75_0.2_155/0.16),transparent_70%)] blur-2xl" />
        <svg
          className="absolute inset-0 h-full w-full opacity-60"
          viewBox="0 0 800 800"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="wave" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="oklch(0.85 0.2 155)" stopOpacity="0" />
              <stop offset="50%" stopColor="oklch(0.85 0.2 155)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="oklch(0.85 0.2 155)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g fill="none" stroke="url(#wave)" strokeWidth="1.5">
            <path d="M-100 260 C 180 60, 420 40, 900 200" />
            <path d="M-100 360 C 200 140, 460 120, 900 300" />
            <path d="M-100 620 C 220 520, 560 700, 900 540" />
          </g>
        </svg>
      </div>

      <div className="relative mx-auto w-full max-w-sm">
        <div className="relative rounded-[2rem] border border-[oklch(0.8_0.18_155/0.35)] bg-[oklch(0.22_0.05_160/0.45)] px-6 py-9 shadow-[0_0_60px_-10px_oklch(0.75_0.2_155/0.45),inset_0_1px_0_oklch(0.9_0.15_155/0.25)] backdrop-blur-xl">
          <div className="absolute -top-px left-1/4 right-1/4 h-px bg-[linear-gradient(90deg,transparent,oklch(0.9_0.2_155),transparent)]" />
          <div className="absolute -bottom-px left-1/4 right-1/4 h-px bg-[linear-gradient(90deg,transparent,oklch(0.9_0.2_155),transparent)]" />

          <img
            src={brainImage}
            alt="Glowing neural network brain"
            width={1024}
            height={768}
            className="mx-auto -mt-2 w-56 drop-shadow-[0_0_35px_oklch(0.75_0.2_155/0.55)]"
          />

          <h1 className="mt-2 text-center text-3xl font-semibold tracking-tight text-white">
            Welcome Back
          </h1>
          <p className="mx-auto mt-3 max-w-[19rem] text-center text-sm leading-relaxed text-[oklch(0.88_0.05_155)]">
            Sign in to your personal AI assistant and pick up where you left off.
          </p>

          {!isSupabaseConfigured && (
            <div className="mt-6 rounded-xl border border-[oklch(0.8_0.18_155/0.3)] bg-[oklch(0.25_0.06_160/0.5)] p-4 text-sm text-[oklch(0.85_0.05_155)]">
              Your database isn&apos;t linked yet. Open Project Settings → Connectors →
              Supabase and connect your existing project, then sign in here.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[oklch(0.85_0.05_155)]" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 w-full rounded-2xl border border-[oklch(0.75_0.16_155/0.3)] bg-[oklch(0.2_0.05_160/0.6)] pl-12 pr-4 text-base text-white placeholder:text-[oklch(0.8_0.04_155/0.75)] outline-none transition focus:border-[oklch(0.85_0.2_155/0.7)] focus:ring-2 focus:ring-[oklch(0.85_0.2_155/0.25)]"
              />
            </div>

            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[oklch(0.85_0.05_155)]" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 w-full rounded-2xl border border-[oklch(0.75_0.16_155/0.3)] bg-[oklch(0.2_0.05_160/0.6)] pl-12 pr-12 text-base text-white placeholder:text-[oklch(0.8_0.04_155/0.75)] outline-none transition focus:border-[oklch(0.85_0.2_155/0.7)] focus:ring-2 focus:ring-[oklch(0.85_0.2_155/0.25)]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[oklch(0.85_0.05_155)] transition hover:text-white"
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[oklch(0.88_0.05_155)]">
                <Checkbox
                  checked={keepSignedIn}
                  onCheckedChange={(v) => setKeepSignedIn(v === true)}
                  className="size-5 rounded-md border-[oklch(0.8_0.18_155/0.6)] data-[state=checked]:border-[oklch(0.85_0.2_155)] data-[state=checked]:bg-[oklch(0.82_0.2_155)] data-[state=checked]:text-[oklch(0.18_0.04_160)]"
                />
                Keep me signed in
              </label>
              <a
                href="#"
                className="text-sm font-medium text-[oklch(0.85_0.2_155)] transition hover:text-white"
              >
                Forgot password?
              </a>
            </div>

            {error && (
              <p className="text-sm text-[oklch(0.72_0.19_25)]" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !isSupabaseConfigured}
              className="mt-2 h-14 w-full rounded-full border-0 bg-[linear-gradient(180deg,oklch(0.86_0.2_155),oklch(0.7_0.2_157))] text-base font-semibold text-white shadow-[0_0_35px_-4px_oklch(0.8_0.2_155/0.8)] transition hover:opacity-95"
            >
              {loading ? (
                <Loader2 className="mr-2 size-5 animate-spin" />
              ) : null}
              Sign in
              {!loading && <ArrowRight className="ml-2 size-5" />}
            </Button>
          </form>

          <p className="mt-7 text-center text-xs uppercase tracking-[0.2em] text-[oklch(0.8_0.05_155/0.8)]">
            Private Personal AI Assistant
          </p>
        </div>
      </div>
    </div>
  );
}
