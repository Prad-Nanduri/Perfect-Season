import type {
  CompletedRoster,
  SeasonResult,
  TrophyEvalContext,
} from '@perfect-season/sport-engine-core';
import { describe, expect, it } from 'vitest';
import { CFB_MVP_TROPHY_CODES, evaluateCfbTrophies, getCfbTrophyDefinitions } from './index';

const roster = {
  draftId: 'd1',
  sportId: 'cfb',
  schemeId: '4-3',
  ratingMode: 'career_season',
  picks: [],
} as unknown as CompletedRoster;
const context = (): TrophyEvalContext => ({
  userId: null,
  roster,
  priorResults: [],
  earnedTrophies: [],
  evaluatedAt: '2024-01-15T00:00:00Z',
  facts: {},
});
const result = (overrides: Partial<SeasonResult>): SeasonResult => ({
  draftId: 'd1',
  sportId: 'cfb',
  modeId: 'core',
  seed: 'seed',
  modelVersion: 'test',
  dataVersion: 'test',
  record: { wins: 9, losses: 3, ties: 0 },
  pointsFor: 300,
  pointsAgainst: 200,
  postseasonResult: null,
  stages: [],
  facts: {},
  ...overrides,
});
const codes = (season: SeasonResult, ctx = context()) =>
  evaluateCfbTrophies(season, ctx).map((trophy) => trophy.code);

function regularGames(games: SeasonResult['stages'][number]['games']): SeasonResult['stages'] {
  return [
    {
      id: 'regular_season',
      name: 'Regular Season',
      games,
      record: {
        wins: games.filter((game) => game.outcome === 'win').length,
        losses: games.length - games.filter((game) => game.outcome === 'win').length,
        ties: 0,
      },
      outcome: 'completed',
    },
  ];
}

describe('CFB trophies (spec §2A.5, §2A.7)', () => {
  it('defines the MVP trophies plus the Full Campaign championship trophy', () => {
    expect(getCfbTrophyDefinitions().map((definition) => definition.code)).toEqual([
      'undefeated_untied',
      'the_natty',
      'statement_win',
      'overtime_classic',
      'legacy_era_lineup',
    ]);
    expect(getCfbTrophyDefinitions()).toHaveLength(5);
  });

  it('awards Undefeated & Untied only for 12-0-0', () => {
    expect(codes(result({ record: { wins: 12, losses: 0, ties: 0 } }))).toContain(
      'undefeated_untied',
    );
    expect(codes(result({ record: { wins: 11, losses: 1, ties: 0 } }))).not.toContain(
      'undefeated_untied',
    );
    expect(codes(result({ record: { wins: 12, losses: 0, ties: 1 } }))).not.toContain(
      'undefeated_untied',
    );
  });

  it('exposes The Natty as an earnable non-MVP trophy', () => {
    const definitions = getCfbTrophyDefinitions();
    expect(definitions.some((definition) => definition.code === 'the_natty')).toBe(true);
    expect(CFB_MVP_TROPHY_CODES).not.toContain('the_natty');
  });

  it('awards Statement Win for a sufficiently strong regular-season win', () => {
    const strong = result({
      stages: regularGames([
        {
          opponentId: 'x',
          site: 'home',
          pointsFor: 30,
          pointsAgainst: 20,
          outcome: 'win',
          facts: { strengthRating: 99 },
        },
      ]),
    });
    const weak = result({
      stages: regularGames([
        {
          opponentId: 'x',
          site: 'home',
          pointsFor: 30,
          pointsAgainst: 20,
          outcome: 'win',
          facts: { strengthRating: 60 },
        },
      ]),
    });
    expect(codes(strong)).toContain('statement_win');
    expect(codes(weak)).not.toContain('statement_win');
  });

  it('awards Overtime Classic for two overtime wins', () => {
    const win = (overtimePeriods: number) => ({
      opponentId: 'x',
      site: 'home' as const,
      pointsFor: 30,
      pointsAgainst: 20,
      outcome: 'win' as const,
      facts: { overtimePeriods },
    });
    expect(codes(result({ stages: regularGames([win(1), win(2)]) }))).toContain('overtime_classic');
    expect(codes(result({ stages: regularGames([win(1), win(0)]) }))).not.toContain(
      'overtime_classic',
    );
  });

  it('awards Legacy Era Lineup only when every pick predates 2005', () => {
    const old = {
      ...roster,
      picks: [{ candidate: { poolUnit: { sportId: 'cfb', programId: '1', season: 2004 } } }],
    } as unknown as CompletedRoster;
    const modern = {
      ...roster,
      picks: [{ candidate: { poolUnit: { sportId: 'cfb', programId: '1', season: 2005 } } }],
    } as unknown as CompletedRoster;
    expect(codes(result({}), { ...context(), roster: old })).toContain('legacy_era_lineup');
    expect(codes(result({}), { ...context(), roster: modern })).not.toContain('legacy_era_lineup');
  });
});
