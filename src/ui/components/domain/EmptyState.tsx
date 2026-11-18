import './domain.css';
import type { ReactNode } from 'react';
import type { GlyphId } from '../../glyph-ids.ts';
import { Glyph } from '../../primitives/Glyph.tsx';

export interface EmptyStateProps {
  icon: GlyphId;
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="dom-empty">
      <Glyph id={icon} size={32} className="dom-empty-icon" />
      <h3 className="dom-empty-title">{title}</h3>
      <p className="dom-empty-body">{body}</p>
      {action ? <div className="dom-empty-action">{action}</div> : null}
    </div>
  );
}
