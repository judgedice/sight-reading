/**
 * The Wood gate of 01 section 7.6, decided by CI and not by a person: the synthetic suite in click.test.ts runs
 * the launch timbres with Wood bleed at -20 and -10 dB through template subtraction, and Wood is offered on
 * speakers only if every run keeps onset F1 >= 0.97 with zero click-induced extras. Otherwise the settings offer
 * Wood in headphone modes only (04 section 5.11).
 *
 * Generated: click.test.ts fails when this value disagrees with the measurement. Regenerate with
 * `CLICK_GATE_WRITE=1 pnpm vitest run src/dsp/click.test.ts`.
 */
export const WOOD_ON_SPEAKERS: boolean = true;
