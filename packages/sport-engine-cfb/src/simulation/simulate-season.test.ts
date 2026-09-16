import type {
  CompletedRoster,
  OpponentContext,
  SimulationMode,
} from '@perfect-season/sport-engine-core';
import { createRng } from '@perfect-season/sport-engine-core/utils';
import type { SimulatedGame } from '@perfect-season/simulation';
import { describe, expect, it } from 'vitest';
import { simulateCfbSeason } from './simulate-season';
import { CFB_REGULAR_SEASON_GAMES } from './config';

const roster = {
  draftId: 'cfb-draft',
  sportId: 'cfb',
  schemeId: '4-3',
  ratingMode: 'career_season',
  picks: Array.from({ length: 24 }, (_, index) => ({
    slot: { code: `slot-${index}`, positionGroup: 'QB', eligiblePositions: ['QB'] },
    candidate: {
      playerId: `p${index}`,
      fullName: `Player ${index}`,
      primaryPosition: 'QB',
      poolUnit: { sportId: 'cfb', programId: '1', season: 2023, conferenceId: 'acc' },
      seasons: [],
      traits: {},
    },
    rating: {
      positionGroup: 'QB',
      mode: 'career_season',
      overall: 90,
      sourceSeason: 2023,
      confidenceTier: 'full_feature',
      isTeamLevelProxy: false,
      modelVersion: 'test',
    },
    spinSeed: `seed-${index}`,
  })),
} as unknown as CompletedRoster;

const quickSeason: SimulationMode = {
  modeId: 'core',
  difficulty: 'normal',
  seed: 'cfb-season-test',
  options: {},
};
const fullCampaign: SimulationMode = { ...quickSeason, options: { fullCampaign: true } };

const context: OpponentContext = {
  season: 2023,
  modelVersion: 'test-model',
  dataVersion: 'test-data',
  opponents: [{ id: 'opp-1', name: 'Opponent', rating: 1500, site: 'neutral', facts: {} }],
  facts: {},
};

function game(won: boolean, opponentId: string): SimulatedGame {
  return {
    opponentId,
    site: 'neutral',
    won,
    tied: false,
    pointsFor: won ? 31 : 10,
    pointsAgainst: won ? 10 : 31,
    overtimePeriods: 0,
    winProbability: won ? 0.8 : 0.2,
    effectiveRosterRating: 90,
    drives: { for: [], against: [] },
    facts: {},
  };
}

describe('simulateCfbSeason (spec §2A.4, §2A.5)', () => {
  it('quick season is 12 regular-season games with no postseason', () => {
    const result = simulateCfbSeason(roster, quickSeason, context, {
      seed: 'quick',
      rng: createRng('quick'),
      simulateGame: (_r, opponent) => game(true, opponent.id),
    });
    expect(result.record).toEqual({ wins: 12, losses: 0, ties: 0 });
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]?.games).toHaveLength(CFB_REGULAR_SEASON_GAMES);
    expect(result.postseasonResult).toBeNull();
    expect(result.facts.fullCampaign).toBe(false);
  });

  it('is deterministic for the same seed', () => {
    const first = simulateCfbSeason(roster, quickSeason, context, { seed: 'det' });
    const second = simulateCfbSeason(roster, quickSeason, context, { seed: 'det' });
    expect(first).toEqual(second);
  });

  it('runs Full Campaign when the mode requests it', () => {
    const result = simulateCfbSeason(roster, fullCampaign, context, {
      seed: 'gated',
      rng: createRng('gated'),
      simulateGame: (_r, opponent) => game(true, opponent.id),
    });
    expect(result.record).toEqual({ wins: 12, losses: 0, ties: 0 });
    expect(result.stages).toHaveLength(3);
    expect(result.postseasonResult).toBe('national_champion');
    expect(result.facts.fullCampaign).toBe(true);
  });

  it('keeps Quick Season when the mode does not request Full Campaign', () => {
    const result = simulateCfbSeason(roster, quickSeason, context, {
      seed: 'quick',
      rng: createRng('quick'),
      simulateGame: (_r, opponent) => game(true, opponent.id),
    });
    expect(result.stages).toHaveLength(1);
    expect(result.postseasonResult).toBeNull();
    expect(result.facts.fullCampaign).toBe(false);
  });

  it('12-0 full campaign wins the conference title and a 3-game CFP to the championship', () => {
    const result = simulateCfbSeason(roster, fullCampaign, context, {
      seed: 'all-wins',
      rng: createRng('all-wins'),
      enableFullCampaign: true,
      simulateGame: (_r, opponent) => game(true, opponent.id),
    });
    expect(result.record).toEqual({ wins: 12, losses: 0, ties: 0 });
    expect(result.facts.conferenceChampion).toBe(true);
    expect(result.facts.cfpSeed).toBe(1);
    const cfpStage = result.stages.find((stage) => stage.id === 'cfp');
    // Seed 1 earns a bye: quarterfinal, semifinal, championship = 3 games.
    expect(cfpStage?.games).toHaveLength(3);
    expect(result.postseasonResult).toBe('national_champion');
  });

  it('0-12 full campaign goes to a bowl and loses it', () => {
    const result = simulateCfbSeason(roster, fullCampaign, context, {
      seed: 'all-losses',
      rng: createRng('all-losses'),
      enableFullCampaign: true,
      simulateGame: (_r, opponent) => game(false, opponent.id),
    });
    expect(result.record).toEqual({ wins: 0, losses: 12, ties: 0 });
    expect(result.stages.map((stage) => stage.id)).toEqual(['regular_season', 'bowl']);
    expect(result.postseasonResult).toBe('bowl_lost');
    expect(result.facts.cfpSeed).toBeNull();
  });

  it('records cfp_runner_up when the title game is lost', () => {
    let games = 0;
    const result = simulateCfbSeason(roster, fullCampaign, context, {
      seed: 'runner-up',
      rng: createRng('runner-up'),
      enableFullCampaign: true,
      simulateGame: (_r, opponent) => {
        games += 1;
        // 12 regular wins + title win + QF + SF = 15 wins; game 16 is the final.
        return game(games < 16, opponent.id);
      },
    });
    expect(result.record.wins).toBe(12);
    expect(result.facts.conferenceChampion).toBe(true);
    expect(result.postseasonResult).toBe('cfp_runner_up');
    expect(result.stages.find((stage) => stage.id === 'cfp')?.games).toHaveLength(3);
  });

  it('never produces a tie (CFB overtime has no cap)', () => {
    const result = simulateCfbSeason(roster, quickSeason, context, {
      seed: 'no-ties',
      rng: createRng('no-ties'),
    });
    expect(result.record.ties).toBe(0);
    expect(result.stages[0]?.games.every((g) => g.outcome !== 'tie')).toBe(true);
  });
});
