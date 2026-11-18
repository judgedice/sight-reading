// The notation font asset (src/notation/font/vexflow-bravura.ts) for type checks under tsconfig.node.json, which does
// not load vite/client. Vite resolves the import to the emitted file's URL; the esbuild harnesses to a data: URL.
declare module '*.woff2' {
  const url: string;
  export default url;
}
