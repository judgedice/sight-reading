/** Shared layout for one settings section: a heading and one or more cards of rows (06 section 6, mockup settings-*). */
import type { ReactNode } from 'react';
import type { SettingsSection } from '../../route-match.ts';

export type SectionKey = SettingsSection | 'profile';

export function Section({ id, title, children }: { id: SectionKey; title: string; children: ReactNode }) {
  const anchor = `settings-${id}`;
  return (
    <section className="set-section" id={anchor} data-section={id} aria-labelledby={`${anchor}-title`}>
      <h2 className="set-section-title" id={`${anchor}-title`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A card of rows separated by hairlines. */
export function Group({ children }: { children: ReactNode }) {
  return <div className="set-card">{children}</div>;
}

/**
 * One labelled row. The control keeps its own accessible name; the label is visible text.
 * `inline` puts the control at the right of the label (switches, buttons); otherwise it sits under it.
 */
export function Row({
  label,
  htmlFor,
  children,
  hint,
  inline = false,
}: {
  label: string;
  htmlFor?: string | undefined;
  children: ReactNode;
  hint?: string | undefined;
  inline?: boolean | undefined;
}) {
  return (
    <div className="set-row" data-inline={inline ? 'true' : undefined}>
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
