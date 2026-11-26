// Copy catalogue tests (04 section 10, section 12; D0c acceptance): the formatter supports exactly
// the two forms, every template parses, the spec's worked strings come out exactly, and the
// catalogue carries every enum value the other roles define.
import { describe, expect, it } from 'vitest';
import en from './en.json';
import round2 from './round2-spec.json';
import { copy, copyKeys, copyTemplate, formatMessage, isCopyKey, requiredVariables, type CopyKey } from './copy.ts';
import { instrumentName, instrumentShortName } from './instrument-names.ts';

describe('formatMessage', () => {
  it('substitutes {name} placeholders and leaves plain text alone', () => {
    expect(formatMessage('Bar {n} of {total}', { n: 4, total: 10 })).toBe('Bar 4 of 10');
    expect(formatMessage('No placeholders here.')).toBe('No placeholders here.');
  });

  it('chooses the one or other branch of a plural and replaces # with the number', () => {
    const t = '{n, plural, one {# mark changed after the try} other {# marks changed after the try}}';
    expect(formatMessage(t, { n: 1 })).toBe('1 mark changed after the try');
    expect(formatMessage(t, { n: 2 })).toBe('2 marks changed after the try');
    expect(formatMessage(t, { n: 0 })).toBe('0 marks changed after the try');
  });

  it('formats placeholders nested inside a plural branch', () => {
    const t = 'Restarted at bar {bar} ({n, plural, one {# note} other {# notes}} replayed)';
    expect(formatMessage(t, { bar: 4, n: 6 })).toBe('Restarted at bar 4 (6 notes replayed)');
  });

  it('throws when a variable is missing rather than printing undefined', () => {
    expect(() => formatMessage('Bar {n}', {})).toThrow(/missing variable "n"/);
  });

  it('throws on a plural form other than one and other', () => {
    expect(() => formatMessage('{n, plural, zero {none} other {some}}', { n: 0 })).toThrow(/unsupported plural form "zero"/);
  });

  it('throws on a non-plural format and on unbalanced braces', () => {
    expect(() => formatMessage('{n, number}', { n: 1 })).toThrow(/only plural is allowed/);
    expect(() => formatMessage('Bar {n', { n: 1 })).toThrow(/unclosed/);
  });

  it('throws when a plural has no branch for its count', () => {
    expect(() => formatMessage('{n, plural, one {# take}}', { n: 3 })).toThrow(/no plural branch/);
  });
});

describe('copy() and the typed key union', () => {
  it('reproduces the spec strings exactly', () => {
    expect(copy('welcome.headline')).toBe('Read it. Play it. See how it went.');
    expect(copy('scan.ranked.notice', { seconds: 30 })).toBe(
      "You'll have 30 seconds to read, then the count-in starts by itself. Want more time? Switch to Practice.",
    );
    expect(copy('scan.startingIn', { n: 5 })).toBe('Starting in 5');
    expect(copy('play.status.bar', { n: 4, total: 10 })).toBe('Bar 4 of 10');
    expect(copy('results.scoring')).toBe('Scoring…');
    expect(copy('grade.B')).toBe('Solid. A few mistakes.');
    expect(copy('ranked.reason.seen-before')).toBe("You've seen this piece before, so it isn't sight reading any more.");
    expect(copy('results.counts.total', { n: 42 })).toBe('42 notes');
    expect(copy('results.stops', { n: 1, bar: 5, beats: 2 })).toBe('Stops: 1 (bar 5, 2 beats)');
    expect(copy('streak.atRisk', { n: 1, days: 6 })).toBe('1 more ranked try today keeps your 6-day streak.');
    expect(copy('rankup.headline', { rank: 'Section player' })).toBe('New rank: Section player!');
    expect(copy('credit.source', { encoder: 'OpenScore Lieder contributors', corpus: 'OpenScore Lieder' })).toBe(
      'Typeset by OpenScore Lieder contributors · OpenScore Lieder · CC BY 4.0',
    );
    expect(copy('credit.that-was', { credit: 'Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0' })).toBe(
      'That was: Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0',
    );
    expect(copy('credit.line', {
      composer: 'Schubert',
      dates: '1797–1828',
      work: 'Heidenröslein, D 257',
      a: 1,
      b: 8,
      licenceShort: 'CC0',
    })).toBe('Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0');
    expect(copy('onboarding.timing.pass', { ms: 42 })).toBe('Measured: 42 ms. Timing marks will be fair.');
  });

  it('exposes a key union that matches en.json, with the expected count', () => {
    expect(copyKeys.length).toBeGreaterThan(300);
    expect(isCopyKey('grade.S')).toBe(true);
    expect(isCopyKey('no.such.key')).toBe(false);
    // @ts-expect-error an unknown key is a compile-time error
    expect(() => copy('no.such.key')).toThrow();
  });

  it('returns the raw template unformatted', () => {
    expect(copyTemplate('play.status.bar')).toBe('Bar {n} of {total}');
  });
});

describe('en.json catalogue', () => {
  it('has a template for every key that parses, with the variables it names', () => {
    for (const key of copyKeys) {
      const template = copyTemplate(key);
      expect(template.trim(), key).not.toBe('');
      expect(() => requiredVariables(template), key).not.toThrow();
    }
  });

  it('only uses exclamation marks in the rank-up headline and the clip indicator (04 section 10.1)', () => {
    const withBang = copyKeys.filter((k) => copyTemplate(k).includes('!')).sort();
    expect(withBang).toEqual(['play.meter.clip', 'rankup.headline']);
  });

  it('has a ranked-reason string for every value of the 02 section 5.2 enum, and no others', () => {
    const enumValues = [
      'practice-mode',
      'seen-before',
      'scan-extended',
      'tempo-below-90pct',
      'visual-metronome',
      'calibration',
      'measurement',
      'familiar',
      'skip-limit',
      'listened-first',
      'clockRate',
    ];
    const keys = copyKeys.filter((k) => k.startsWith('ranked.reason.')).map((k) => k.slice('ranked.reason.'.length)).sort();
    expect(keys).toEqual([...enumValues].sort());
  });

  it('has a string for every grade letter in 02 section 4.7', () => {
    for (const g of ['S', 'A', 'B', 'C', 'D', 'F'] as const) expect(isCopyKey(`grade.${g}`)).toBe(true);
  });

  it('has licence, corpus and modification strings for every identifier in 01 section 6.1 and the runtime additions', () => {
    for (const id of ['PD', 'CC0-1.0', 'CC-BY-4.0']) expect(isCopyKey(`licence.${id}`)).toBe(true);
    for (const id of ['openscore-lieder', 'openscore-quartets', 'mutopia']) expect(isCopyKey(`corpus.${id}`)).toBe(true);
    for (const m of [
      'excerpted',
      'grace-removed',
      'ornament-removed',
      'fermata-removed',
      'lyrics-removed',
      'rhythm-augmented-x2',
      'final-bar-completed',
      'transposed',
      'octave-displaced',
    ]) {
      expect(isCopyKey(`mod.${m}`), m).toBe(true);
    }
  });

  it('has a void-card string for each VoidReason the spec gives copy for (9.3)', () => {
    // 'clipping' is a VoidReason in 01 but 04 gives it a results banner, not a void card; see the wave 0 report.
    for (const v of ['interrupted', 'noSignal', 'deviceChange', 'backlog', 'captureGap']) {
      expect(isCopyKey(`void.${v}`), v).toBe(true);
    }
  });

  it('has the verdict strings from 04 section 10.2', () => {
    for (const v of [
      'right',
      'early',
      'late',
      'sharp',
      'flat',
      'wrongNote',
      'wrongOctave',
      'missed',
      'extraNote',
      'replayed',
      'heldTooShort',
    ]) {
      expect(isCopyKey(`verdict.${v}`), v).toBe(true);
    }
  });

  it('has an instrument abbreviation for every launch instrument and every beta instrument in config/instruments.json', () => {
    const ids = [
      'voice-soprano', 'voice-alto', 'voice-tenor', 'voice-bass', 'flute', 'clarinet-bb', 'sax-alto', 'trumpet-bb',
      'violin', 'cello', 'piano-rh', 'sax-tenor', 'sax-bari', 'oboe', 'bassoon', 'horn-f', 'trombone', 'euphonium-bc',
      'euphonium-tc', 'tuba', 'viola', 'double-bass', 'piano-lh', 'guitar',
    ];
    for (const id of ids) expect(isCopyKey(`instrument.abbr.${id}`), id).toBe(true);
  });

  it('keeps 10.2 key names where the spec gives them', () => {
    for (const k of [
      'welcome.headline',
      'welcome.body',
      'scan.cover',
      'scan.ranked.notice',
      'scan.startingIn',
      'play.status.bar',
      'results.scoring',
      'results.rejudged',
      'results.rejudged.why',
      'credit.line',
      'credit.work',
      'credit.workOnly',
      'credit.source',
      'credit.that-was',
      'credit.adapted',
      'rankup.headline',
      'streak.atRisk',
      'results.practice.tooltip',
    ] as const) {
      expect(isCopyKey(k), k).toBe(true);
    }
  });

  it('places the iOS calibration note and no iOS skip string (PLAN ruling 16)', () => {
    expect(copy('onboarding.calibration.iosNote')).toBe('On iPhone and iPad, tries earn XP only after this check.');
    expect(copyKeys.some((k) => k !== 'calibrate.skipHint' && k.includes('skip') && k.toLowerCase().includes('calibrat'))).toBe(false);
  });

  it('keeps the CC BY credit line in the take (PLAN ruling 26)', () => {
    expect(copy('credit.source', { encoder: 'E', corpus: 'C' })).toMatch(/· CC BY 4\.0$/);
  });
});

describe('round 2 vocabulary and new copy (01-ux.md 2 to 16, 04-design.md 10, 02-sounds.md)', () => {
  const blank = (t: string): string => t.replace(/\{\s*[A-Za-z_]+/g, '{');
  /** Keys where "take" is the ordinary verb ("a sound takes time", "Take a moment"), not the noun for a try. */
  const TAKE_VERB = ['scan.cover', 'calStatus.none.detail', 'calStatus.ok.detail'];

  it('has no value that says take(s) for a try, excerpt(s), slip(s), scan or "a stretch"', () => {
    const hits = (re: RegExp, skip: readonly string[] = []): string[] =>
      copyKeys.filter((k) => !skip.includes(k) && re.test(blank(en[k])));
    expect(hits(/\btakes?\b/i, TAKE_VERB)).toEqual([]);
    expect(hits(/\bexcerpts?\b/i)).toEqual([]);
    expect(hits(/\bslips?\b/i)).toEqual([]);
    expect(hits(/\bscan\b/i)).toEqual([]);
    expect(hits(/\ba stretch\b/i)).toEqual([]);
    expect(hits(/\bre-?judged\b/i)).toEqual([]);
    expect(hits(/\brecalibrate\b/i)).toEqual([]);
  });

  it('names the time signature, not the time', () => {
    expect(copy('row.time')).toBe('Time signature');
    expect(copy('setup.time.anyChip')).toBe('Any');
  });

  it('has every key the round 2 documents name, with its text', () => {
    const added = Object.entries(round2.added);
    expect(added.length).toBeGreaterThan(150);
    for (const [key, text] of [...added, ...Object.entries(round2.changed)]) {
      expect(isCopyKey(key), `missing key ${key}`).toBe(true);
      expect(copyTemplate(key as CopyKey), key).toBe(text);
    }
    // One key from every family the task names, so a deleted family cannot hide behind the count.
    for (const family of [
      'match.', 'calStatus.', 'countIn.', 'look.', 'sure.', 'diagnostics.', 'heard.', 'error.audioStart.',
      'error.micStart.', 'settings.display.ghostsLive', 'settings.display.showHeard', 'settings.practice.autoReference',
      'settings.data.exportDiagnostics', 'credits.sounds.',
    ]) {
      expect(Object.keys(round2.added).some((k) => k.startsWith(family)), family).toBe(true);
    }
  });

  it('credits every sound source of 02-sounds.md', () => {
    const credit = ['credits.sounds.winds', 'credits.sounds.strings', 'credits.sounds.piano', 'credits.sounds.voices'].map((k) =>
      copyTemplate(k as CopyKey),
    ).join(' ');
    for (const name of ['Versilian Studios', 'tiny-orchestra', 'Frank Wen', 'Benjamin Gleitzman', 'Alexander Holm', 'Jan Forst', 'CC BY 3.0', 'CC0 1.0']) {
      expect(credit, name).toContain(name);
    }
    expect(copy('credits.sounds.licenceFiles')).toContain('LICENSES/CC-BY-3.0.txt');
  });

  it('keeps the old keys the code still uses, with the variables the code passes', () => {
    expect(copyTemplate('a11y.countIn.announce')).toBe('Count-in, then play. Press Escape to stop.');
    for (const k of ['error.clockRate']) {
      expect(isCopyKey(k), k).toBe(true);
    }
    // Decision 11: the keys wave 3 stopped using are gone.
    for (const k of ['banner.calibrateNeeded', 'scan.coach', 'scan.practice.timeUp', 'home.keyFootnote', 'stars.optional', 'stars.title']) {
      expect(isCopyKey(k), k).toBe(false);
    }
  });
});

const SPEC: Readonly<Record<string, string>> = {
  // Generated from 05 section 13.1, 13.2 and the designer's copy notes. The exact text of every redesign key.
  "action.startScan": "Show the music",
  "action.hearReference": "Hear starting pitch",
  "action.tuningNote": "Check my tuning",
  "action.stayAt": "Stay at difficulty {level}",
  "action.goToLevel": "Go to difficulty {level}",
  "onboarding.instrument.body": "We pick music in your range. Choose the card that fits you best.",
  "scan.summary": "Difficulty {level} · {key} · {meter} · {tempo} · {bars} bars",
  "scan.peek": "Look before you play",
  "grade.D": "Rough one. Stay at this difficulty for now.",
  "grade.F": "This one was hard. Try an easier difficulty?",
  "ranked.reason.practice-mode": "You chose Practice.",
  "ranked.reason.scan-extended": "The reading time ran past this difficulty's limit.",
  "ranked.reason.tempo-below-90pct": "The tempo was below this difficulty's range.",
  "badge.timingOffset": "Not calibrated: timing marks may be a little off",
  "results.personalBest": "New best at difficulty {level}",
  "results.drift.behind": "You slowed down slightly by the end",
  "results.drift.ahead": "You sped up slightly by the end",
  "component.focus": "{component} is the one to work on.",
  "xp.factor.levelBase": "Difficulty {level} base {value}",
  "xp.factor.randomKey": "Any key ×{value}",
  "xp.factor.randomMeter": "Any time signature ×{value}",
  "xp.factor.randomTempo": "Any tempo ×{value}",
  "xp.factor.belowLevel": "Below your difficulty ×{value}",
  "xp.practice": "+{xp} XP (practice earns {percent}% of the XP)",
  "results.xp.factor.random": "Any settings ×{value}",
  "rank.bar": "{rank} · Rank {n} of {total} · {xp} of {next} XP to {nextRank}",
  "rank.bar.needsLevel": "Reach difficulty {level} on any instrument to unlock",
  "rankup.next": "Next: {rank}, at {xp} XP and difficulty {level} on any instrument.",
  "level.offer": "You're reading difficulty {level} well. Move up to difficulty {next}?",
  "level.autoUp": "Moved up to difficulty {level}: {n} tries in a row at {score} or more.",
  "level.down": "Difficulty {level} has been hard lately. A few tries at difficulty {lower} can build the reading back up.",
  "home.levelNoMusic": "No music yet for {instrument} at difficulty {levels}.",
  "home.levelFewMusic": "Few pieces here: some may repeat.",
  "home.selector.noUnseen": "Difficulty {level} has no unseen music in {meter} for {instrument} yet.",
  "home.selector.setTimeRandom": "Set time to Any",
  "row.level": "Difficulty",
  "progress.instrumentLevel": "Difficulty {level}",
  "progress.ladder.future": "{xp} XP, difficulty {level}",
  "progress.best": "Best at difficulty {level}: {score}",
  "progress.window.label": "Recent ranked tries at this difficulty",
  "empty.progress.body": "Play a piece and your score, difficulty and rank show up here.",
  "settings.placement.hint": "Plays three short pieces to find your difficulty again.",
  "settings.section.audio": "Sound",
  "settings.audio.clickSound": "Metronome sound",
  "settings.audio.metronomeVolume": "Click volume",
  "settings.audio.metronome": "Click during the try",
  "settings.audio.metronome.audible": "On",
  "settings.audio.metronome.countInOnly": "Count-in only",
  "settings.audio.a4": "Tuning pitch",
  "settings.practice.stars": "Show \"Look before you play\"",
  "settings.practice.tips": "Show a tip after each try",
  "settings.practice.beta": "Show more instruments (less tested)",
  "tips.showBetween": "Show a tip after each try",
  "badge.beta": "less tested",
  "calibrate.audibility.hint": "Try the Woodblock or Beep sound, or wired headphones.",
  "calibrate.audibility.link": "Open metronome sound settings",
  "error.clockRate": "Your device's audio clock is running at the wrong speed, so timing can't be measured. Close other apps that play sound, then try again.",
  "shortcuts.space": "Show the music, then Start playing",
  "shortcuts.n": "Next piece",
  "instrument.name.voice-soprano": "Soprano voice",
  "instrument.name.voice-mezzo": "Mezzo-soprano voice",
  "instrument.name.voice-alto": "Alto voice",
  "instrument.name.voice-tenor": "Tenor voice",
  "instrument.name.voice-baritone": "Baritone voice",
  "instrument.name.voice-bass": "Bass voice",
  "instrument.short.voice-soprano": "Soprano",
  "instrument.short.voice-mezzo": "Mezzo",
  "instrument.short.voice-alto": "Alto",
  "instrument.short.voice-tenor": "Tenor",
  "instrument.short.voice-baritone": "Baritone",
  "instrument.short.voice-bass": "Bass",
  "instrument.abbr.voice-mezzo": "Mz",
  "instrument.abbr.voice-baritone": "Bar",
  "range.full": "Full range: {low} to {high}",
  "range.atDifficulty": "At difficulty {level}: {low} to {high}",
  "range.cardText": "{low} to {high}",
  "range.sounds": "Sounds a {interval} lower: concert {low} to {high}",
  "range.soundsOctave": "Sounds an octave lower: {low} to {high}",
  "range.soundsCompound": "Sounds an octave and a {interval} lower: concert {low} to {high}",
  "range.voiceNote": "Sing in any octave that suits you. Pitch is marked relative to your starting note.",
  "range.a11y": "{instrument} range: {low} to {high}. At difficulty {level}: {servedLow} to {servedHigh}.",
  "range.hearNote": "Hear {note}",
  "instrument.card.a11y": "{instrument}, range {low} to {high}",
  "setup.changeInstrument": "Change instrument",
  "setup.done": "Done",
  "setup.chip.a11y": "{row}: {value}. Change",
  "setup.difficulty.value": "{level} of {max}",
  "setup.difficulty.chip": "Difficulty {level}",
  "setup.key.any": "Any key",
  "setup.key.major": "Major",
  "setup.key.minor": "Minor",
  "setup.key.concert": "concert {key}",
  "setup.key.a11y": "{key}, {accidentals}",
  "setup.key.a11yConcert": "{key}, {accidentals}, sounds {concert}",
  "accidentals.none": "no sharps or flats",
  "setup.time.any": "Any",
  "setup.time.anyChip": "Any",
  "setup.time.a11y": "{beats} {unit} time",
  "setup.tempo.any": "Any tempo in range",
  "setup.tempo.anyChip": "Any tempo",
  "setup.tempo.anyValue": "Any tempo from {min} to {max}",
  "setup.length.any": "Any",
  "setup.length.only": "{bars} bars (the only length at difficulty {level})",
  "setup.length.chip": "{bars} bars",
  "setup.xpTag": "+{percent}% XP",
  "setup.fallback.key": "Key set to Any: {key} isn't used at difficulty {level}.",
  "setup.fallback.time": "Time signature set to Any: {meter} isn't available at difficulty {level}.",
  "setup.fallback.length": "Length set to Any: {bars} bars isn't used at difficulty {level}.",
  "setup.fallback.difficulty": "Difficulty set to {level}: no music yet for {instrument} at difficulty {from}.",
  "setup.mode.ranked.hint": "At your difficulty, with timed reading and fresh music. Full XP, and good tries move you up.",
  "setup.mode.practice.hint": "Any difficulty, no time limit, listen first if you like. A quarter of the XP, and your difficulty stays the same.",
  "setup.mode.blocked.mic": "Ranked needs the microphone.",
  "action.calibrateNow": "Calibrate now",
  "action.turnOnMic": "Turn on microphone",
  "home.loadingMusic": "Loading music…",
  "home.rankLine": "{rank} · {percent}% to {nextRank}",
  "onboarding.mic.notNowHint": "Not now? You can still read and sing along, but tries won't be graded. You can turn the microphone on later from Home.",
  "onboarding.mic.continueWithout": "Continue without the microphone",
  "calibrate.skipHint": "Skipped, your tries are practice until you run it. You can run it later from Home or Settings.",
  "action.hearClick": "Hear the click",
  "scan.cover.loading": "Getting the music…",
  "scan.skipFreeHint": "Skip is free before you see the music.",
  "scan.timeLeft": "{time} left",
  "stars.heading": "Look before you play",
  "scan.sounds.whatAreThese": "What do these do?",
  "scan.sounds.title": "Sounds",
  "action.hearTempo.short": "Tempo",
  "action.hearReference.short": "Starting pitch",
  "action.hearKey": "Hear the key",
  "action.hearKey.short": "Key",
  "hearTempo.caption": "One bar of clicks at {tempo}.",
  "reference.caption.voice": "Plays the key chord, then your first note.",
  "reference.caption.instrument": "Plays the key chord, so you hear the key.",
  "reference.info.voice": "This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there. We mark your pitch relative to this start, in any octave that suits your voice. It also plays just before the count-in; you can turn that off in Settings.",
  "reference.info.instrument": "The key chord is the home chord of this piece, at concert pitch. It gives away no notes, so you can use it in ranked tries too.",
  "reference.info.button": "About {control}",
  "reference.playing.chord": "Key chord: {key}",
  "reference.playing.first": "First note: {note}",
  "tuning.caption": "Hold any note for {seconds} seconds. We'll allow for your tuning.",
  "tuning.listening": "Listening… hold your note.",
  "tuning.fail": "We couldn't hear a steady note. Hold one note and try again.",
  "sound.failed": "That sound didn't play. Check your volume and try again.",
  "sound.playing.tempo": "Tempo: {tempo}",
  "action.listen": "Listen",
  "action.listenFirst": "Listen first",
  "listen.rankedLine": "Makes this practice",
  "listen.practiceCaption": "Hear how it goes before you play.",
  "listen.slower": "Slower",
  "listen.clickAlong": "Click along",
  "listen.playing": "Playing bar {n} of {total}",
  "listen.stopped": "Stopped",
  "listen.confirm.title": "Listen first?",
  "listen.confirm.body": "Hearing the music before you play makes this a practice try. It earns less XP and doesn't count toward your rank.",
  "listen.confirm.yes": "Listen, make it practice",
  "listen.confirm.no": "Keep it ranked",
  "ranked.reason.listened-first": "You listened first, so this one is practice.",
  "action.hearBar": "Hear bar {bar}",
  "shortcuts.l": "Listen or stop",
  "countIn.reference": "Your starting pitch",
  "results.tip.title": "One thing to try",
  "results.tip.more": "Show {n, plural, one {# more tip} other {# more tips}}",
  "results.badge.notGraded": "Not graded",
  "results.drift.ms": "({ms} ms)",
  "results.saveFailed": "This try couldn't be saved on this device.",
  "action.changeSetup": "Change setup",
  "action.previousSlip": "Previous mistake",
  "action.nextSlip": "Next mistake",
  "settings.audio.click.classic": "Classic",
  "settings.audio.click.classic.hint": "A mechanical metronome: a firm, woody click.",
  "settings.audio.click.woodblock": "Woodblock",
  "settings.audio.click.woodblock.hint": "Rounder and softer.",
  "settings.audio.click.beep": "Beep",
  "settings.audio.click.beep.hint": "A short electronic beep. Cuts through in a loud room.",
  "settings.audio.click.play": "Play a bar of {sound}",
  "settings.audio.accent": "Accent the first beat",
  "settings.audio.a4.hint": "The A above middle C. Most groups tune to 440 Hz.",
  "settings.about.technical": "Technical details",
  "action.backToPractice": "Back to Practice",
  "reference.info.title.voice": "What is the reference?",
  "reference.info.title.instrument": "What is the key chord?",
  "picker.axis": "Bars show the sounding range on one scale, C1 to C8. The tall tick is middle C (C4). The bold part is what you get at your difficulty.",
  "range.writtenOctave": "Written an octave higher",
  "range.barsSounding": "bars show sounding pitch",
  "results.tip.less": "Hide {n, plural, one {tip} other {tips}}",
  "action.hearBars": "Hear bars {from} to {to}",
  "listen.fromBar": "From bar {n}",
  "results.void.cleanScore": "Clean score. Nothing is marked when a try is not graded.",
  "tips.offToast": "Tips turned off. Turn them on in Settings > Practice.",
  "calibrate.devicesLocked": "Device choice is locked while we listen.",
  "settings.audio.click.keepsCalibration": "Changing the sound keeps your calibration.",
  "settings.audio.click.playing": "Playing: {sound}",
  "settings.audio.metronomeVolume.hint": "Plays one click when you let go.",
  "scan.practice.readHint": "Read it through. Start when you are ready.",
  "setup.empty.title": "No piece fits these settings",
  "scan.sounds.listenRanked": "In a ranked try, this makes it practice. We ask first.",
};

/** Strings allowed to contain the word "level" (a sound level, say). Expected to stay empty. */
const LEVEL_ALLOW: readonly string[] = [];

describe('redesign copy (05 sections 13.1, 13.2, designer notes)', () => {
  it('has every spec key with its exact text', () => {
    for (const [key, text] of Object.entries(SPEC)) {
      expect(isCopyKey(key), `missing key ${key}`).toBe(true);
      expect(copyTemplate(key as CopyKey), key).toBe(text);
    }
  });

  it('says "difficulty", never "level", in any player-facing string', () => {
    // Placeholder names such as {level} are code identifiers, not player-facing words, so they are blanked first.
    const spoken = (k: CopyKey): string => en[k].replace(/\{\s*[A-Za-z_]+/g, '{');
    const hits = copyKeys.filter((k) => /\blevel\b/i.test(spoken(k)) && !LEVEL_ALLOW.includes(k));
    expect(hits).toEqual([]);
    expect(LEVEL_ALLOW).toEqual([]);
  });

  it('names the six voices and the two new abbreviations', () => {
    expect(instrumentName('voice-mezzo')).toBe('Mezzo-soprano voice');
    expect(instrumentShortName('voice-baritone')).toBe('Baritone');
    expect(copyTemplate('instrument.abbr.voice-mezzo')).toBe('Mz');
    expect(copyTemplate('instrument.abbr.voice-baritone')).toBe('Bar');
  });

  it('falls back to the config label for instruments without a catalogue name', () => {
    expect(instrumentName({ id: 'clarinet-bb', label: 'Clarinet in B♭' })).toBe('Clarinet in B♭');
    expect(instrumentShortName('flute', 'Flute')).toBe('Flute');
    expect(instrumentName({ id: 'voice-tenor', label: 'ignored' })).toBe('Tenor voice');
  });
});
