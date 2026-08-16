"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-media-query";
import { clamp01, onScrollFrame } from "@/lib/scroll";

const POINTS = 20481;
const WIDTH = 1000;
const HEIGHT = 520;
const CLUSTERS = 9;
const LINKS = 220;
const HIT_CLUSTER = 3;
const HITS = 5;

type Cloud = {
  ctx: CanvasRenderingContext2D;
  pts: Float32Array;
  chaos: Float32Array;
  delay: Float32Array;
  links: [number, number][];
  hits: number[];
  buffer: ImageData;
  pixels: Uint32Array;
  projected: Float32Array;
  yaw: number;
  pitch: number;
  vyaw: number;
  t: number;
  startedAt: number;
  running: boolean;
  mx: number;
  my: number;
};

/** Generador determinista: la misma nube en cada carga. */
function buildCloud(ctx: CanvasRenderingContext2D): Cloud {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 1.4;

  const centers: number[][] = [];
  for (let c = 0; c < CLUSTERS; c += 1) {
    const a = rnd() * Math.PI * 2;
    const b = Math.acos(2 * rnd() - 1);
    const r = 0.42 + rnd() * 0.36;
    centers.push([
      r * Math.sin(b) * Math.cos(a),
      r * Math.sin(b) * Math.sin(a) * 0.75,
      r * Math.cos(b),
    ]);
  }

  const pts = new Float32Array(POINTS * 3);
  const chaos = new Float32Array(POINTS * 3);
  const delay = new Float32Array(POINTS);
  const group = new Uint8Array(POINTS);

  for (let i = 0; i < POINTS; i += 1) {
    const g = Math.floor(rnd() * centers.length);
    group[i] = g;
    const c = centers[g];
    const d = 0.17;
    pts[i * 3] = c[0] + gauss() * d;
    pts[i * 3 + 1] = c[1] + gauss() * d * 0.85;
    pts[i * 3 + 2] = c[2] + gauss() * d;

    const a2 = rnd() * Math.PI * 2;
    const b2 = Math.acos(2 * rnd() - 1);
    const r2 = 0.55 + Math.pow(rnd(), 0.5) * 0.75;
    chaos[i * 3] = r2 * Math.sin(b2) * Math.cos(a2) * 1.15;
    chaos[i * 3 + 1] = r2 * Math.sin(b2) * Math.sin(a2) * 0.9;
    chaos[i * 3 + 2] = r2 * Math.cos(b2) * 1.15;
    delay[i] = rnd() * 0.34;
  }

  const hits: number[] = [];
  for (let i = 0; i < POINTS && hits.length < HITS; i += 1) {
    if (group[i] === HIT_CLUSTER && rnd() < 0.02) hits.push(i);
  }
  while (hits.length < HITS) hits.push(Math.floor(rnd() * POINTS));

  const links: [number, number][] = [];
  for (let k = 0; k < LINKS; k += 1) {
    const i = Math.floor(rnd() * POINTS);
    let j = -1;
    let best = 9;
    for (let m = 0; m < 90; m += 1) {
      const candidate = Math.floor(rnd() * POINTS);
      if (group[candidate] !== group[i] || candidate === i) continue;
      const dx = pts[candidate * 3] - pts[i * 3];
      const dy = pts[candidate * 3 + 1] - pts[i * 3 + 1];
      const dz = pts[candidate * 3 + 2] - pts[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        j = candidate;
      }
    }
    if (j >= 0) links.push([i, j]);
  }

  const buffer = ctx.createImageData(WIDTH, HEIGHT);

  return {
    ctx,
    pts,
    chaos,
    delay,
    links,
    hits,
    buffer,
    pixels: new Uint32Array(buffer.data.buffer),
    projected: new Float32Array(POINTS * 2),
    yaw: 0.4,
    pitch: -0.18,
    vyaw: 0.0028,
    t: 0,
    startedAt: 0,
    running: false,
    mx: -1,
    my: -1,
  };
}

function paint(cloud: Cloud, p: number, tooltip: HTMLDivElement | null, canvas: HTMLCanvasElement) {
  const { ctx, pts, chaos, delay, projected, pixels, hits } = cloud;
  const cy = Math.cos(cloud.yaw);
  const sy = Math.sin(cloud.yaw);
  const cp = Math.cos(cloud.pitch);
  const sp = Math.sin(cloud.pitch);
  const f = 2.6;
  const scale = Math.min(WIDTH, HEIGHT * 1.9) * 0.42;
  const ox = WIDTH / 2;
  const oy = HEIGHT / 2;
  const t = cloud.t;

  pixels.fill(0);

  const order = Math.min(1, t / 0.5);
  const baseAlpha = 0.13 + 0.19 * order - 0.1 * order * p;

  let nearest = -1;
  let nearestDistance = 1e9;
  let nearestX = 0;
  let nearestY = 0;

  for (let i = 0; i < POINTS; i += 1) {
    const lifetime = clamp01((t - delay[i]) / 0.5);
    const e = 1 - Math.pow(1 - lifetime, 3);
    const x0 = chaos[i * 3] + (pts[i * 3] - chaos[i * 3]) * e;
    const y0 = chaos[i * 3 + 1] + (pts[i * 3 + 1] - chaos[i * 3 + 1]) * e;
    const z0 = chaos[i * 3 + 2] + (pts[i * 3 + 2] - chaos[i * 3 + 2]) * e;

    const x1 = x0 * cy - z0 * sy;
    const z1 = x0 * sy + z0 * cy;
    const y1 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;

    const k = f / (f + z2);
    const X = ox + x1 * scale * k;
    const Y = oy + y1 * scale * k;
    projected[i * 2] = X;
    projected[i * 2 + 1] = Y;

    const xi = X | 0;
    const yi = Y | 0;
    if (xi < 0 || yi < 0 || xi >= WIDTH - 1 || yi >= HEIGHT - 1) continue;

    const alpha = (baseAlpha * (0.45 + 0.85 * k) * 255) | 0;
    // ABGR little-endian → #b8c2ba
    const color = (alpha << 24) | (186 << 16) | (194 << 8) | 184;
    const offset = yi * WIDTH + xi;
    pixels[offset] = color;
    pixels[offset + 1] = color;
    pixels[offset + WIDTH] = color;
    pixels[offset + WIDTH + 1] = color;
  }

  ctx.putImageData(cloud.buffer, 0, 0);

  const linkAlpha = clamp01((t - 0.45) / 0.25);
  if (linkAlpha > 0) {
    ctx.strokeStyle = `rgba(184,194,186,${(0.13 * linkAlpha).toFixed(3)})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const [a, b] of cloud.links) {
      ctx.moveTo(projected[a * 2], projected[a * 2 + 1]);
      ctx.lineTo(projected[b * 2], projected[b * 2 + 1]);
    }
    ctx.stroke();
  }

  const queryAlpha = clamp01((t - 0.6) / 0.2);
  if (queryAlpha > 0) {
    ctx.strokeStyle = `rgba(231,236,231,${(0.5 * queryAlpha).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(ox, oy, 7 * queryAlpha, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(231,236,231,${(0.75 * queryAlpha).toFixed(3)})`;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText("consulta", ox + 13, oy + 4);
  }

  const hitAlpha = clamp01((t - 0.68) / 0.16);
  const lineAlpha = clamp01((t - 0.76) / 0.24);

  hits.forEach((index, idx) => {
    if (hitAlpha <= 0) return;
    const X = projected[index * 2];
    const Y = projected[index * 2 + 1];

    if (lineAlpha > 0) {
      ctx.strokeStyle = `rgba(26,158,92,${(0.55 * lineAlpha).toFixed(3)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + (X - ox) * lineAlpha, oy + (Y - oy) * lineAlpha);
      ctx.stroke();
    }

    const distance = cloud.mx > 0 ? Math.hypot(cloud.mx - X, cloud.my - Y) : Infinity;
    const near = distance < 34;
    if (near && distance < nearestDistance) {
      nearestDistance = distance;
      nearest = idx;
      nearestX = X;
      nearestY = Y;
    }

    const on = hitAlpha * (0.35 + 0.65 * p);
    ctx.fillStyle = `rgba(26,158,92,${(0.3 + 0.7 * on).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(X, Y, ((near ? 6 : 4) + 2 * p) * hitAlpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(26,158,92,${(0.35 * on).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(X, Y, 10 + 12 * p, 0, Math.PI * 2);
    ctx.stroke();

    if (p > 0.35 && idx > 0) {
      const prev = hits[idx - 1];
      ctx.strokeStyle = `rgba(26,158,92,${(0.16 * p).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(projected[prev * 2], projected[prev * 2 + 1]);
      ctx.lineTo(X, Y);
      ctx.stroke();
    }
  });

  if (tooltip) {
    if (nearest >= 0) {
      const rect = canvas.getBoundingClientRect();
      tooltip.style.display = "block";
      tooltip.style.left = `${(nearestX / WIDTH) * rect.width}px`;
      tooltip.style.top = `${(nearestY / HEIGHT) * rect.height}px`;
      tooltip.textContent = `pasaje recuperado ${nearest + 1} de 5 · entra al documento`;
    } else {
      tooltip.style.display = "none";
    }
  }
}

const PHASES = ["indexando…", "agrupando por cercanía semántica", "5 recuperados para el caso"];

export function PointCloud() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const cloudRef = useRef<Cloud | null>(null);
  const [phase, setPhase] = useState(PHASES[0]);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useReducedMotion();

  const replay = useCallback(() => {
    const cloud = cloudRef.current;
    if (!cloud) return;
    cloud.t = 0;
    cloud.startedAt = performance.now();
    cloud.running = true;

    phaseTimers.current.forEach(clearTimeout);
    setPhase(PHASES[0]);
    phaseTimers.current = [
      setTimeout(() => setPhase(PHASES[1]), 1700),
      setTimeout(() => setPhase(PHASES[2]), 2900),
    ];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cloud = buildCloud(ctx);
    cloudRef.current = cloud;

    let visible = false;
    let started = false;
    let progress = 0;
    let budget = 33;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = onScrollFrame(() => {
      const rect = canvas.getBoundingClientRect();
      const vh = window.innerHeight;
      visible = rect.bottom > 0 && rect.top < vh;
      progress = clamp01((vh * 0.85 - rect.top) / (vh * 0.6));
      if (visible && !started && rect.top < vh * 0.75) {
        started = true;
        replay();
      }
    });

    const loop = () => {
      if (visible) {
        const begin = performance.now();
        if (reduced) {
          cloud.t = 1;
        } else {
          cloud.vyaw += (0.0028 - cloud.vyaw) * 0.05;
          cloud.yaw += cloud.vyaw;
          if (cloud.running) {
            cloud.t = Math.min(1, (performance.now() - cloud.startedAt) / 3400);
            if (cloud.t >= 1) cloud.running = false;
          }
        }
        paint(cloud, progress, tooltipRef.current, canvas);
        const cost = performance.now() - begin;
        budget = cost > 12 ? 66 : budget === 66 ? 50 : 33;
      }
      timer = setTimeout(loop, visible && !reduced ? budget : 220);
    };
    loop();

    // Arrastrar para girar, pasar el cursor para inspeccionar los recuperados.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      cloud.mx = ((event.clientX - rect.left) / rect.width) * WIDTH;
      cloud.my = ((event.clientY - rect.top) / rect.height) * HEIGHT;
      if (!dragging) return;
      cloud.yaw += (event.clientX - lastX) * 0.006;
      cloud.pitch = Math.max(
        -1.1,
        Math.min(1.1, cloud.pitch + (event.clientY - lastY) * 0.005),
      );
      cloud.vyaw = (event.clientX - lastX) * 0.0006;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const release = () => {
      dragging = false;
      canvas.style.cursor = "grab";
    };

    const onPointerLeave = () => {
      release();
      cloud.mx = -1;
      cloud.my = -1;
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", onPointerLeave);

    return () => {
      unsubscribe();
      clearTimeout(timer);
      phaseTimers.current.forEach(clearTimeout);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointercancel", release);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      cloudRef.current = null;
    };
  }, [reduced, replay]);

  return (
    <div className="relative mt-7">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Nube de 20.481 pasajes indexados del corpus de la Corte Constitucional"
        // touch-pan-y: girar con el dedo en horizontal sin secuestrar el scroll vertical.
        className="block h-[340px] w-full cursor-grab touch-pan-y border border-white/10 bg-white/[0.03]"
      />

      <div
        ref={tooltipRef}
        className="pointer-events-none absolute left-0 top-0 hidden -translate-x-1/2 -translate-y-[140%] whitespace-nowrap border border-brand-bright/55 bg-[#0b120e] px-[9px] py-1.5 font-mono text-[10.5px] text-night-text"
      />

      <div className="absolute bottom-3 left-3.5 flex gap-4 font-mono text-[10px] text-night-faint">
        <span>20.481 pasajes indexados</span>
        <span className="text-brand-bright">{phase}</span>
      </div>

      <div className="absolute bottom-3 right-3.5 flex items-center gap-3">
        <span className="hidden font-mono text-[10px] text-night-faint sm:inline">
          arrastra para girar
        </span>
        <button
          type="button"
          onClick={replay}
          className="cursor-pointer rounded-[3px] border border-white/20 bg-white/[0.04] px-[11px] py-[5px] font-mono text-[10px] text-night-muted transition-colors duration-150 hover:border-brand-bright hover:text-brand-bright"
        >
          repetir
        </button>
      </div>
    </div>
  );
}
