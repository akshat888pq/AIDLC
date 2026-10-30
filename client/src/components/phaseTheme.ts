/**
 * Tailwind classes for each phase colour.
 *
 * Written out in full rather than composed as `bg-${color}-50`: Tailwind scans the
 * source for literal class names, so an interpolated class is simply never
 * generated and the card silently renders unstyled.
 */
export interface PhaseTheme {
  tile: string;
  border: string;
  text: string;
  bar: string;
  chip: string;
  ring: string;
}

const THEMES: Record<string, PhaseTheme> = {
  indigo: {
    tile: 'bg-indigo-50',
    border: 'border-indigo-200',
    text: 'text-indigo-700',
    bar: 'bg-indigo-500',
    chip: 'bg-indigo-100 text-indigo-700',
    ring: 'hover:border-indigo-400 hover:shadow-indigo-100',
  },
  purple: {
    tile: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    bar: 'bg-purple-500',
    chip: 'bg-purple-100 text-purple-700',
    ring: 'hover:border-purple-400 hover:shadow-purple-100',
  },
  sky: {
    tile: 'bg-sky-50',
    border: 'border-sky-200',
    text: 'text-sky-700',
    bar: 'bg-sky-500',
    chip: 'bg-sky-100 text-sky-700',
    ring: 'hover:border-sky-400 hover:shadow-sky-100',
  },
  teal: {
    tile: 'bg-teal-50',
    border: 'border-teal-200',
    text: 'text-teal-700',
    bar: 'bg-teal-500',
    chip: 'bg-teal-100 text-teal-700',
    ring: 'hover:border-teal-400 hover:shadow-teal-100',
  },
  emerald: {
    tile: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700',
    ring: 'hover:border-emerald-400 hover:shadow-emerald-100',
  },
  amber: {
    tile: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    bar: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-700',
    ring: 'hover:border-amber-400 hover:shadow-amber-100',
  },
};

const FALLBACK: PhaseTheme = {
  tile: 'bg-slate-50',
  border: 'border-slate-200',
  text: 'text-slate-700',
  bar: 'bg-slate-400',
  chip: 'bg-slate-100 text-slate-700',
  ring: 'hover:border-slate-400',
};

export function phaseTheme(color: string): PhaseTheme {
  return THEMES[color] ?? FALLBACK;
}

export const STATUS_CHIP: Record<string, string> = {
  'not-started': 'bg-slate-100 text-slate-600',
  'in-progress': 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  locked: 'bg-slate-100 text-slate-400',
};

export const STATUS_LABEL: Record<string, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  completed: 'Completed',
  locked: 'Locked',
};
