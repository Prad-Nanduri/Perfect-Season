import { describe, expect, it } from 'vitest';
import type { GameResult } from '@perfect-season/sport-engine-core';
import { cfbOpponentLabel, cfbOpponentStrength, labelCfbResult } from './cfb-game-labels';
import type { StoredResult } from './server/draft-store';

const teams = [{ cfbdTeamId: 4, school: 'Champion U', logoUrl: 'https://example.com/u.png' }];

const game = (opponentId: string, facts: GameResult['facts'] = {}): GameResult => ({
  opponentId,
  site: 'neutral',
  pointsFor: 21,
  pointsAgainst: 17,
  outcome: 'win',
  facts,
});

describe('cfbOpponentLabel', () => {
  it('resolves numeric cfbdTeamId opponents to the school name', () => {
    expect(cfbOpponentLabel(game('4'), teams)).toEqual({
      name: 'Champion U',
      logoUrl: 'https://example.com/u.png',
    });
  });

  it('labels synthetic opponents by flavor, never showing the raw id', () => {
    expect(cfbOpponentLabel(game('cfb-synth-rivalry-1', { flavor: 'rivalry' }), teams).name).toBe(
      'Rivalry game',
    );
    expect(
      cfbOpponentLabel(
        game('cfb-synth-nonconference_marquee-2', { flavor: 'nonconference_marquee' }),
        teams,
      ).name,
    ).toBe('Marquee non-conference');
    expect(
      cfbOpponentLabel(game('cfb-synth-conference-5', { flavor: 'conference' }), teams).name,
    ).toBe('Conference opponent');
    expect(
      cfbOpponentLabel(game('cfb-synth-nonconference-3', { flavor: 'nonconference' }), teams).name,
    ).toBe('Non-conference opponent');
  });

  it('falls back for unknown ids and missing flavors', () => {
    expect(cfbOpponentLabel(game('999'), teams).name).toBe('Opponent');
    expect(cfbOpponentLabel(game('cfb-synth-other-1', { flavor: 'mystery' }), teams).name).toBe(
      'Opponent',
    );
    expect(cfbOpponentLabel(game('cfb-synth-other-1'), teams).name).toBe('Opponent');
  });
});

describe('cfbOpponentStrength', () => {
  it('rounds a numeric strengthRating fact and returns null otherwise', () => {
    expect(cfbOpponentStrength(game('1', { strengthRating: 71.6 }))).toBe(72);
    expect(cfbOpponentStrength(game('1'))).toBeNull();
    expect(cfbOpponentStrength(game('1', { strengthRating: 'high' }))).toBeNull();
  });
});

describe('labelCfbResult', () => {
  it('adds opponentName to every staged game without touching other fields', () => {
    const result = {
      season: {
        record: { wins: 1, losses: 0, ties: 0 },
        pointsFor: 21,
        pointsAgainst: 17,
        stages: [
          {
            id: 'regular_season',
            name: 'Regular season',
            record: { wins: 1, losses: 0, ties: 0 },
            outcome: null,
            games: [
              game('4', { flavor: 'rivalry' }),
              game('cfb-synth-conference-1', { flavor: 'conference' }),
            ],
          },
        ],
        facts: {},
        postseasonResult: null,
      },
      trophies: [],
      mvp: {
        slotCode: 'QB1',
        playerId: 'p-qb1',
        fullName: 'Quinn Backer',
        primaryPosition: 'QB',
        headshotUrl: null,
        rating: 90,
        unit: { sportId: 'cfb', programId: '4', season: 2023, conferenceId: 'acc' },
      },
      fullGauntlet: false,
      simulatedAt: '2024-01-01T00:00:00.000Z',
    } as unknown as StoredResult;
    const labeled = labelCfbResult(result, teams);
    const games = labeled.season.stages[0]?.games ?? [];
    expect(games[0]?.opponentName).toBe('Champion U');
    expect(games[0]?.opponentLogoUrl).toBe('https://example.com/u.png');
    expect(games[1]?.opponentName).toBe('Conference opponent');
    expect(labeled.mvp.playerId).toBe('p-qb1');
  });
});
