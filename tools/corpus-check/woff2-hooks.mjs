// Node module hooks: a .woff2 import (a Vite asset URL in the app) resolves to an empty string under tsx.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.woff2')) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
}
