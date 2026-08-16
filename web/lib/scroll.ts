type Listener = () => void;

const listeners = new Set<Listener>();
let frame = 0;
let attached = false;

function flush() {
  frame = 0;
  for (const listener of listeners) listener();
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(flush);
}

/**
 * Un único listener de scroll/resize para toda la página, agrupado por frame.
 * Devuelve la función de baja.
 */
export function onScrollFrame(listener: Listener) {
  listeners.add(listener);
  if (!attached) {
    attached = true;
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
  }
  schedule();
  return () => {
    listeners.delete(listener);
  };
}

export function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Progreso de una sección entre 0 y 1.
 *
 * Con pinning (>= 1000px) la sección mide varias pantallas y el progreso es el
 * recorrido del sticky. Sin pinning la sección tiene altura natural y el
 * progreso se mide por su paso frente al viewport.
 */
export function sectionProgress(el: HTMLElement, pinned: boolean) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (!pinned) {
    return clamp01((vh * 0.9 - rect.top) / Math.max(1, rect.height * 0.75));
  }
  return clamp01(-rect.top / Math.max(1, el.offsetHeight - vh));
}
