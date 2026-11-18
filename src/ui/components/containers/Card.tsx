import type { ReactNode } from 'react';
import { cls } from '../form/cls.ts';
import './containers.css';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/** A flat surface with a 1 px hairline and radius l. Padding is 16, or 24 from the lg breakpoint (04 section 7.5). */
export function Card({ children, className }: CardProps) {
  return <div className={cls('ui-card', className)}>{children}</div>;
}
