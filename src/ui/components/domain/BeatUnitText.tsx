import type { ReactNode } from "react";

/** Beat unit characters that copy templates and models produce: dotted quarter, quarter, eighth, half. */
const UNIT = /(♩\.|♩|♪|\u{1D15E})/u;

/**
 * One beat-unit note drawn as inline SVG in the ink colour. The characters U+2669, U+266A and U+1D15E have no glyph in
 * the UI text fonts, so the browser falls back to a system font that draws them small with uneven spacing; drawing the
 * note keeps the tempo marking the same on every platform. The drawing is decorative; the character stays in the DOM, visually hidden, so
 * copied text, text search and screen readers still get the unit.
 */
function BeatUnitIcon({ unit }: { unit: string }) {
  const dotted = unit === "♩.";
  const half = unit === "\u{1D15E}";
  const eighth = unit === "♪";
  return (
    <>
      <svg
        className="ui-beat-unit"
        viewBox={dotted ? "0 0 16 24" : "0 0 12 24"}
        aria-hidden="true"
        focusable="false"
      >
        <ellipse
          cx="5"
          cy="19"
          rx="4"
          ry="3"
          transform="rotate(-20 5 19)"
          fill={half ? "none" : "currentColor"}
          stroke="currentColor"
          strokeWidth={half ? 1.4 : 0}
        />
        <path
          d="M8.6 18.2V3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="butt"
        />
        {eighth ? (
          <path
            d="M8.6 3c0.4 4 5 5 3 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ) : null}
        {dotted ? <circle cx="13" cy="19" r="1.3" fill="currentColor" /> : null}
      </svg>
      <span className="ui-visually-hidden">{unit}</span>
    </>
  );
}

/** Text with each beat-unit character replaced by a drawn note; other text passes through unchanged. */
export function BeatUnitText({ text }: { text: string }) {
  const parts = text.split(UNIT);
  if (parts.length === 1) return <>{text}</>;
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (i % 2 === 1) out.push(<BeatUnitIcon key={i} unit={p} />);
    else if (p) out.push(p);
  });
  return <>{out}</>;
}
