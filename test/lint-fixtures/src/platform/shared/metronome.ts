// expect: no-restricted-syntax
export function click(ctx: { createOscillator(): unknown }) {
  return ctx.createOscillator();
}
