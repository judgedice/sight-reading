/** Joins class names, dropping falsy entries. Shared by the D2a form and container components. */
export function cls(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}
