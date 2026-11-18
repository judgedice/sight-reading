// `?testClock=1` for #/dev/slice (01 §13.4): in the page's query string or in the hash's query part.
export function testClockRequested(search: string, hash: string): boolean {
  const query = (s: string): string => (s.startsWith('?') ? s : s.includes('?') ? s.slice(s.indexOf('?')) : '');
  return [search, hash].some((s) => new URLSearchParams(query(s)).get('testClock') === '1');
}
