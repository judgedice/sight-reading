/** The small picture of a metronome sound on its card: four pulses, drawn for each sound (mockup settings-*). Decorative. */
import type { MetronomeSound } from '../../../core/types.ts';

const PULSES = [8, 38, 68, 98] as const;

/** Classic: a sharp needle, then smaller. Woodblock: a rounded bloom. Beep: a flat block. */
function pulse(sound: MetronomeSound, x: number, first: boolean): string {
  const k = first ? 1 : 0.62;
  if (sound === 'classic') {
    const top = 18 - 16 * k;
    const bot = 18 + 16 * k;
    return `M${x} 18 L${x + 0.8} ${top} C${x + 2} ${18 - 5.6 * k} ${x + 4} ${18 - 1.9 * k} ${x + 9} 18 C${x + 4} ${18 + 1.9 * k} ${x + 2} ${18 + 5.6 * k} ${x + 0.8} ${bot} Z`;
  }
  if (sound === 'woodblock') {
    const h = first ? 14.4 : 8.9;
    const m = first ? 6.4 : 3.5;
    return `M${x} 18 C${x + 1} ${18 - h} ${x + 4} ${18 - m * 1.1} ${x + 7} ${18 - m} C${x + 10} ${18 - m * 0.4} ${x + 12} 18 ${x + 14} 18 C${x + 12} 18 ${x + 10} ${18 + m * 0.4} ${x + 7} ${18 + m} C${x + 4} ${18 + m * 1.1} ${x + 1} ${18 + h} ${x} 18 Z`;
  }
  const half = first ? 11.2 : 6.944;
  return `M${x} ${18 - half} h9 v${half * 2} h-9 z`;
}

export function SoundWave({ sound }: { sound: MetronomeSound }) {
  const d = PULSES.map((x, i) => pulse(sound, x, i === 0)).join(' ');
  return (
    <span className="set-wave" aria-hidden="true">
      <svg width="120" height="36" viewBox="0 0 120 36">
        <path d="M2 18 H118" stroke="var(--border)" strokeWidth="1" fill="none" />
        <path d={d} fill="currentColor" fillOpacity="0.85" stroke="currentColor" strokeWidth="0.75" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}
