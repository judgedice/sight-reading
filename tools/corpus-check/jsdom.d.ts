// jsdom ships no types and @types/jsdom is not a dependency; only the part the checker uses.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: object;
  }
}
