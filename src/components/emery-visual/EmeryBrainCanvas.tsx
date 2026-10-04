import { useEffect, useRef } from "react";
import type { EmeryVisualState } from "./emery-visual.types";

type Particle = { angle: number; radius: number; speed: number; size: number; phase: number };

const intensity: Record<EmeryVisualState, number> = {
  idle: 0.34,
  listening: 0.78,
  thinking: 0.68,
  remembering: 0.62,
  searching: 0.74,
  planning: 0.7,
  using_tool: 0.82,
  executing: 0.76,
  syncing: 0.58,
  speaking: 0.88,
  waiting: 0.38,
  success: 0.62,
  error: 0.52,
};

export function EmeryBrainCanvas({ state, compact = false }: { state: EmeryVisualState; compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let visible = document.visibilityState === "visible";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const mobile = width < 180 || window.innerWidth < 768;
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.4 : 1.8);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = reducedMotion.matches ? 10 : compact || mobile ? 26 : 52;
      particles = Array.from({ length: count }, (_, index) => ({
        angle: (index / count) * Math.PI * 2 + Math.random() * 0.24,
        radius: Math.min(width, height) * (0.17 + Math.random() * 0.29),
        speed: 0.00008 + Math.random() * 0.00018,
        size: 0.6 + Math.random() * 1.35,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const draw = (time: number) => {
      frame = 0;
      if (!visible || width <= 0 || height <= 0) return;
      context.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const level = intensity[state];
      const motion = reducedMotion.matches ? 0 : 1;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        const angle =
          p.angle +
          time * p.speed * motion * (state === "thinking" || state === "planning" ? 1.55 : 1);
        const pulse = 1 + Math.sin(time * 0.0012 + p.phase) * 0.035 * motion;
        const r = p.radius * pulse;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.77;
        context.beginPath();
        context.fillStyle = `rgba(34, 211, 238, ${0.17 + level * 0.45})`;
        context.arc(x, y, p.size * (0.8 + level * 0.5), 0, Math.PI * 2);
        context.fill();

        if (i > 0 && i % 3 === 0) {
          const previous = particles[i - 1];
          const pa = previous.angle + time * previous.speed * motion;
          const px = cx + Math.cos(pa) * previous.radius;
          const py = cy + Math.sin(pa) * previous.radius * 0.77;
          const distance = Math.hypot(x - px, y - py);
          if (distance < Math.min(width, height) * 0.28) {
            context.beginPath();
            context.strokeStyle = `rgba(59, 130, 246, ${0.025 + level * 0.065})`;
            context.lineWidth = 0.65;
            context.moveTo(x, y);
            context.lineTo(px, py);
            context.stroke();
          }
        }
      }

      if (!reducedMotion.matches) frame = window.requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible && !frame) frame = window.requestAnimationFrame(draw);
      if (!visible && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    draw(performance.now());

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [compact, state]);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}
