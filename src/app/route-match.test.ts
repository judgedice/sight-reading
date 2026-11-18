import { describe, expect, it } from 'vitest';
import { buildPath, hashFromPath, matchRoute, pathFromHash } from './route-match.ts';
import { createRouteTable, routeTable } from './routes.tsx';

describe('pathFromHash', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/progress', '/progress'],
    ['#/progress/', '/progress'],
    ['#progress', '/progress'],
    ['#/history/a1?x=2', '/history/a1'],
  ])('%s -> %s', (hash, path) => expect(pathFromHash(hash)).toBe(path));

  it('round-trips through hashFromPath', () => {
    expect(hashFromPath('/settings/audio')).toBe('#/settings/audio');
  });
});

describe('route table (04 section 3.1)', () => {
  const ids = (path: string, dev = true): string | undefined => matchRoute(routeTable, path, dev)?.def.id;

  it('matches every documented route', () => {
    expect(ids('/welcome')).toBe('welcome');
    expect(ids('/')).toBe('home');
    expect(ids('/practice/scan')).toBe('practice.scan');
    expect(ids('/practice/play')).toBe('practice.play');
    expect(ids('/practice/results')).toBe('practice.results');
    expect(ids('/practice/tips')).toBe('practice.tips');
    expect(ids('/progress')).toBe('progress');
    expect(ids('/history')).toBe('history');
    expect(ids('/history/att_1')).toBe('history.attempt');
    expect(ids('/settings')).toBe('settings');
    expect(ids('/calibrate')).toBe('calibrate');
    expect(ids('/credits')).toBe('credits');
    expect(ids('/dev/components')).toBe('dev.components');
    expect(ids('/dev/replay')).toBe('dev.replay');
  });

  it('captures the attempt id, decoded', () => {
    expect(matchRoute(routeTable, '/history/a%20b', false)?.params).toEqual({ attemptId: 'a b' });
  });

  it('accepts the six settings anchors and nothing else', () => {
    for (const s of ['audio', 'display', 'practice', 'accessibility', 'data', 'about']) {
      expect(ids(`/settings/${s}`)).toBe('settings');
    }
    expect(ids('/settings/bogus')).toBeUndefined();
  });

  it('hides dev routes in production', () => {
    expect(ids('/dev/components', false)).toBeUndefined();
    expect(ids('/dev/replay', false)).toBeUndefined();
  });

  it('rejects unknown paths, extra segments and bad escapes', () => {
    expect(ids('/nope')).toBeUndefined();
    expect(ids('/progress/extra')).toBeUndefined();
    expect(ids('/history/%E0%A4%A')).toBeUndefined();
  });

  it('only the take hides the app bar', () => {
    const none = routeTable.filter((r) => r.chrome === 'none').map((r) => r.id);
    expect(none).toEqual(['practice.play']);
  });

  it('puts every route under a tab only where the spec does', () => {
    const tab = (id: string) => routeTable.find((r) => r.id === id)?.tab;
    expect(tab('home')).toBe('practice');
    expect(tab('practice.results')).toBe('practice');
    expect(tab('progress')).toBe('progress');
    expect(tab('history.attempt')).toBe('history');
    expect(tab('settings')).toBeNull();
  });

  it('lets later packages swap a screen without touching the table', () => {
    const Replacement = () => null;
    const table = createRouteTable({ progress: Replacement });
    expect(table.find((r) => r.id === 'progress')?.Screen).toBe(Replacement);
    expect(table.find((r) => r.id === 'history')?.Screen).not.toBe(Replacement);
  });
});

describe('buildPath', () => {
  it('fills and encodes params', () => {
    expect(buildPath('/history/:attemptId', { attemptId: 'a b' })).toBe('/history/a%20b');
    expect(buildPath('/progress')).toBe('/progress');
  });
  it('throws on a missing param', () => {
    expect(() => buildPath('/history/:attemptId')).toThrow();
  });
});
