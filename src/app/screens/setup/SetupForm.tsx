import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { KeySig, OutputMode, PracticeSettings } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { RandomChip, SegmentedControl, Select, Stepper, TempoSlider } from '../../../ui/components/form/index.ts';
import type { SelectOption } from '../../../ui/components/form/index.ts';
import { Glyph } from '../../../ui/primitives/Glyph.tsx';
import { FAMILY_ORDER } from './families.ts';
import { concertKey, keyName, keyValue, parseKeyValue } from './key-names.ts';
import {
  allowedKeys,
  beatUnit,
  effectiveLevel,
  lengthChoices,
  levelCounts,
  levelDef,
  listedInstruments,
  meterChoices,
  midTempo,
  moreKeysFromLevel,
  normalize,
  randomBonusPercent,
  stockOf,
  tempoRange,
  type SetupContext,
} from './model.ts';
import './setup.css';

export interface SetupFormProps {
  value: PracticeSettings;
  onChange: (next: PracticeSettings) => void;
  ctx: SetupContext;
}

function Row({ label, children, chip, caption }: { label: string; children: ReactNode; chip?: ReactNode; caption?: ReactNode }) {
  return (
    <fieldset className="setup-row">
      <legend className="setup-label">{label}</legend>
      <div className="setup-control">{children}</div>
      {chip ? <div className="setup-chip">{chip}</div> : null}
      {caption ? <p className="setup-caption">{caption}</p> : null}
    </fieldset>
  );
}

/** Select value of the Random entry of the Key row. */
const RANDOM = 'random';

const OUTPUTS: { value: OutputMode; label: () => string }[] = [
  { value: 'speakers', label: () => copy('output.speakers') },
  { value: 'wired', label: () => copy('output.wiredHeadphones') },
  { value: 'bluetooth', label: () => copy('output.bluetooth') },
];

/**
 * The setup rows of 04 section 5.2. Every change goes through `normalize`, so a new level re-filters key, time and
 * length without dropping a still-valid choice. Numeric values behind a Random chip are remembered while mounted.
 */
export function SetupForm({ value, onChange, ctx }: SetupFormProps) {
  const { cfg } = ctx;
  const level = effectiveLevel(value, ctx);
  const def = levelDef(cfg, level);
  const inst = cfg.instrumentById[value.instrumentId]!;

  const counts = useMemo(() => levelCounts(ctx, value.instrumentId), [ctx, value.instrumentId]);
  const meters = useMemo(() => meterChoices(ctx, value.instrumentId, level), [ctx, value.instrumentId, level]);
  const keys = useMemo(() => allowedKeys(def), [def]);
  const lengths = lengthChoices(def);
  const range = tempoRange(cfg, def, value.meter);

  const memo = useRef<{ level: number; key: KeySig; meter: string; bpm: number }>({
    level: ctx.playerLevel(value.instrumentId),
    key: keys[0] ?? { fifths: 0, mode: 'major' },
    meter: def.meters[0] ?? '4/4',
    bpm: midTempo(range),
  });
  useEffect(() => {
    if (value.level !== 'random') memo.current.level = value.level;
    if (value.writtenKey !== 'random') memo.current.key = value.writtenKey;
    if (value.meter !== 'random') memo.current.meter = value.meter;
    if (value.bpm !== 'random') memo.current.bpm = value.bpm;
  }, [value.level, value.writtenKey, value.meter, value.bpm]);

  const set = (patch: Partial<PracticeSettings>): void => onChange(normalize({ ...value, ...patch }, ctx));

  const disabledLevels = LEVELS_WITH(counts, 0);
  const stock = stockOf(counts[level] ?? 0);

  const instrumentGroups = FAMILY_ORDER.map(({ family, label }) => ({
    label,
    items: listedInstruments(cfg, ctx.showBeta).filter((i) => i.family === family),
  })).filter((g) => g.items.length > 0);

  const keyOptions: SelectOption[] = keys.map((k) => ({
    value: keyValue(k),
    label:
      inst.writtenMinusSounding.chromatic !== 0
        ? copy('home.keyOption', { written: keyName(k), concert: keyName(concertKey(k, inst)) })
        : copy('home.keyOption.plain', { written: keyName(k) }),
  }));
  const keyMore = moreKeysFromLevel(cfg, level);
  const keyRandom = value.writtenKey === 'random';
  const meterRandom = value.meter === 'random';
  const bonus = value.mode === 'ranked' ? randomBonusPercent(cfg, value) : 0;
  const random = copy('chip.random');

  return (
    <form className="setup" onSubmit={(e) => e.preventDefault()} aria-label={copy('nav.practice')}>
      <Row label={copy('row.instrument')}>
        <span className="ui-select-wrap">
          <select
            className="ui-select"
            aria-label={copy('row.instrument')}
            value={value.instrumentId}
            onChange={(e) => set({ instrumentId: e.target.value })}
          >
            {instrumentGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Glyph id="chevron-down" className="ui-select-chevron" />
        </span>
      </Row>

      <Row
        label={copy('row.level')}
        chip={<RandomChip pressed={value.level === 'random'} onToggle={(on) => set({ level: on ? 'random' : memo.current.level })} />}
        caption={
          <>
            <span className="setup-desc">{def.description}</span>
            {stock !== 'ok' ? (
              <span className="setup-stock" data-stock={stock}>
                {copy(stock === 'none' ? 'home.levelNoMusic' : 'home.levelFewMusic')}
              </span>
            ) : null}
          </>
        }
      >
        <Stepper
          ariaLabel={copy('row.level')}
          value={level}
          min={1}
          max={10}
          disabledValues={disabledLevels}
          formatValue={(n) => (value.level === 'random' ? random : String(n))}
          onChange={(l) => set({ level: l })}
        />
      </Row>

      <Row
        label={copy('row.key')}
        chip={<RandomChip pressed={keyRandom} onToggle={(on) => set({ writtenKey: on ? 'random' : memo.current.key })} />}
        caption={
          keyRandom ? (
            <span className="setup-desc">{copy('home.keyRandom', { max: def.writtenKeys.maxAccidentals })}</span>
          ) : keyMore !== null ? (
            <span className="setup-desc">{copy('home.keyFootnote', { n: keyMore })}</span>
          ) : null
        }
      >
        <Select
          ariaLabel={copy('row.key')}
          options={[{ value: RANDOM, label: random }, ...keyOptions]}
          value={keyRandom ? RANDOM : keyValue(value.writtenKey as KeySig)}
          {...(keyRandom ? { className: 'setup-is-random' } : {})}
          onChange={(v) => {
            if (v === RANDOM) {
              set({ writtenKey: 'random' });
              return;
            }
            const k = parseKeyValue(v);
            if (k) set({ writtenKey: k });
          }}
        />
      </Row>

      <Row
        label={copy('row.time')}
        chip={<RandomChip pressed={meterRandom} onToggle={(on) => set({ meter: on ? 'random' : memo.current.meter })} />}
      >
        <div className={meterRandom ? 'setup-is-random' : undefined}>
          <SegmentedControl
            ariaLabel={copy('row.time')}
            value={meterRandom ? '' : value.meter}
            options={meters.map((m) => ({
              value: m.meter,
              label: m.meter,
              disabled: m.disabled,
              ...(m.disabled ? { tooltip: copy('home.meterTooltip', { meter: m.meter }) } : {}),
            }))}
            onChange={(m) => set({ meter: m })}
          />
        </div>
      </Row>

      <Row
        label={copy('row.tempo')}
        chip={<RandomChip pressed={value.bpm === 'random'} onToggle={(on) => set({ bpm: on ? 'random' : memo.current.bpm })} />}
      >
        <TempoSlider
          ariaLabel={copy('row.tempo')}
          min={range.min}
          max={range.max}
          beatUnit={beatUnit(value.meter)}
          value={value.bpm === 'random' ? Math.min(range.max, Math.max(range.min, memo.current.bpm)) : value.bpm}
          onChange={(bpm) => set({ bpm })}
        />
      </Row>

      <Row label={copy('row.length')}>
        <SegmentedControl
          ariaLabel={copy('row.length')}
          value={value.bars === 'random' ? 'random' : String(value.bars)}
          options={[
            { value: 'random', label: random },
            ...lengths.map((n) => ({ value: String(n), label: String(n) })),
          ]}
          onChange={(v) => set({ bars: v === 'random' ? 'random' : (Number(v) as 8 | 10 | 12) })}
        />
      </Row>

      <Row label={copy('row.output')}>
        <Select
          ariaLabel={copy('row.output')}
          value={value.outputMode}
          options={OUTPUTS.map((o) => ({ value: o.value, label: o.label() }))}
          onChange={(v) => set({ outputMode: v as OutputMode })}
        />
      </Row>

      <Row label={copy('row.mode')}>
        <SegmentedControl
          ariaLabel={copy('row.mode')}
          value={value.mode}
          options={[
            { value: 'ranked', label: copy('mode.ranked') },
            { value: 'practice', label: copy('mode.practice') },
          ]}
          onChange={(m) => set({ mode: m })}
        />
      </Row>

      {bonus > 0 ? (
        <p className="setup-xp-hint" data-testid="xp-hint">
          {copy('xp.randomHint', { percent: bonus })}
        </p>
      ) : null}
    </form>
  );
}

function LEVELS_WITH(counts: Record<number, number>, n: number): number[] {
  return Object.entries(counts)
    .filter(([, c]) => c === n)
    .map(([l]) => Number(l));
}
