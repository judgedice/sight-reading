/** Shared layout for one settings section: a heading and a column of rows (04 section 5.11). */
import type { ReactNode } from 'react';
import type { SettingsSection } from '../../route-match.ts';

export function Section({ id, title, children }: { id: SettingsSection | 'profile'; title: string; children: ReactNode }) {
  const anchor = id === 'profile' ? 'settings-profile' : `settings-${id}`;
  return (
    <section className="set-section" id={anchor} aria-labelledby={`${anchor}-title`}>
      <h2 className="set-section-title" id={`${anchor}-title`}>
        {title}
      </h2>
      <div className="set-rows">{children}</div>
    </section>
  );
}

/** One labelled row. The control keeps its own accessible name; the label is visible text. */
export function Row({ label, htmlFor, children, hint }: { label: string; htmlFor?: string | undefined; children: ReactNode; hint?: string | undefined }) {
  return (
    <div className="set-row">
      <div className="set-row-label">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="set-label">
            {label}
          </label>
        ) : (
          <span className="set-label">{label}</span>
        )}
        {hint ? <span className="set-hint">{hint}</span> : null}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}
