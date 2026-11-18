import './domain.css';

export interface StarRowProps {
  stars: 0 | 1 | 2 | 3;
  /** S grade: a ring around the three stars. */
  shine?: boolean;
  size?: 'list' | 'results';
  /** Accessible name; hidden from assistive tech when omitted (the grade already announces the stars). */
  label?: string;
}

const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z';

/** Three stars, filled up to `stars` (04 7.5). Empty stars are outlined, so the count reads without colour. */
export function StarRow({ stars, shine = false, size = 'list', label }: StarRowProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <span className="dom-stars" data-size={size} data-shine={shine && stars === 3 ? 'true' : undefined} data-stars={stars} {...a11y}>
      {[1, 2, 3].map((n) => (
        <svg key={n} className="dom-star" data-filled={n <= stars ? 'true' : 'false'} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}
