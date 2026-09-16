import type {
  CompletedRoster,
  PlayerCandidate,
  SeasonResult,
} from '@perfect-season/sport-engine-core';
import { describe, expect, it } from 'vitest';
import type { CfbConference, CfbProgramSeason, CfbRating, CfbTeam } from './domain';
import { TEAM_LEVEL_RATING_BADGE } from './domain';
import { CfbSportEngine } from './engine';

const conference: CfbConference = {
  conferenceKey: 'acc',
  name: 'ACC',
  shortName: 'ACC',
  abbreviation: 'ACC',
  isActive: true,
  foundedYear: null,
  dissolvedYear: null,
};
const team: CfbTeam = {
  cfbdTeamId: 1,
  school: 'Champion U',
  currentName: 'Champion U',
  abbreviation: 'CHP',
  mascot: null,
  logoUrl: null,
  color: null,
  alternateColor: null,
  isBlueBlood: false,
};
const programSeason: CfbProgramSeason = {
  cfbdTeamId: 1,
  season: 2023,
  conferenceKey: 'acc',
  membershipStatus: 'fbs',
  wins: 12,
  losses: 1,
  apPreseasonRank: null,
  apFinalRank: 4,
  peakRankThisSeason: 4,
  cfpResult: 'semifinal',
  bowlResult: null,
  recruitingRank: null,
  recruitingPoints: null,
  eraTier: 'full_feature',
};
const poolUnit = {
  sportId: 'cfb' as const,
  programId: '1',
  season: 2023,
  conferenceId: 'acc',
  apFinalRank: 4,
};
const candidate: PlayerCandidate = {
  playerId: 'p',
  fullName: 'Player',
  primaryPosition: 'QB',
  poolUnit,
  seasons: [
    {
      poolUnit,
      position: 'QB',
      confidenceTier: 'full_feature',
      stats: {},
    },
  ],
  traits: {},
};
const baseRating: CfbRating = {
  cfbdPlayerId: 'p',
  cfbdTeamId: 1,
  season: 2023,
  ratingMode: 'career_season',
  overallRating: 94,
  compositeScore: 0.9,
  percentile: 0.94,
  confidenceTier: 'full_feature',
  isTeamLevelProxy: false,
  badges: [],
  modelVersion: 'cfb-v0.1.0',
};
const engine = new CfbSportEngine({
  conferences: [conference],
  teams: [team],
  programSeasons: [programSeason],
  ratings: [baseRating],
});
const simulationRoster: CompletedRoster = {
  draftId: 'cfb-simulation-draft',
  sportId: 'cfb',
  schemeId: '4-3',
  ratingMode: 'career_season',
  picks: Array.from({ length: 24 }, (_, index) => ({
    slot: { code: `slot-${index}`, positionGroup: 'QB', eligiblePositions: ['QB'] },
    candidate,
    rating: {
      positionGroup: 'QB',
      mode: 'career_season',
      overall: 90,
      sourceSeason: 2023,
      confidenceTier: 'full_feature',
      isTeamLevelProxy: false,
      modelVersion: 'cfb-v0.1.0',
    },
    spinSeed: `seed-${index}`,
  })) as unknown as CompletedRoster['picks'],
};

describe('CfbSportEngine (spec §0.1, §2A)', () => {
  it('implements identity, schemes, spin, eligibility, modes, and rating lookup', async () => {
    expect(engine.sportId).toBe('cfb');
    expect(engine.displayName).toBe('College Football (FBS)');
    expect(engine.rosterSlotCount).toBe(24);
    expect(engine.getSchemePresets()).toHaveLength(3);
    const unit = await engine.resolveSpinUnit('seed', { modeId: 'core', criteria: {} });
    expect(unit.sportId).toBe('cfb');
    if (unit.sportId === 'cfb') expect(unit.programId).toBe('1');
    const firstSlot = engine.getSchemePresets()[0]?.slots[0];
    if (firstSlot === undefined) throw new Error('expected a scheme slot');
    expect(engine.validateSlotEligibility(candidate, firstSlot)).toEqual({
      eligible: true,
      warnings: [],
    });
    expect(engine.computeRating(candidate, 'career_season').overall).toBe(94);
    expect(engine.getAvailableModes().map((mode) => mode.id)).toContain('blue_blood_bracket');
  });

  it('describes a spin unit with conference and season (§2A.2)', () => {
    expect(engine.describeSpinUnit(poolUnit)).toEqual({
      title: 'Champion U (ACC · 2023)',
      footnote: null,
    });
  });

  it('uses prime ratings across candidate history and a 40 fallback', () => {
    const primeCandidate: PlayerCandidate = {
      ...candidate,
      seasons: [
        ...candidate.seasons,
        {
          poolUnit: { ...poolUnit, season: 2022 },
          position: 'QB',
          confidenceTier: 'full_feature',
          stats: {},
        },
      ],
    };
    const primeEngine = new CfbSportEngine({
      conferences: [conference],
      teams: [team],
      programSeasons: [],
      ratings: [
        baseRating,
        {
          ...baseRating,
          season: 2022,
          overallRating: 97,
          isTeamLevelProxy: true,
          badges: [TEAM_LEVEL_RATING_BADGE],
        },
      ],
    });
    expect(primeEngine.computeRating(primeCandidate, 'prime')).toMatchObject({
      overall: 97,
      sourceSeason: 2022,
      isTeamLevelProxy: true,
    });
    expect(primeEngine.getRatingBadges(primeCandidate, 'prime')).toEqual([TEAM_LEVEL_RATING_BADGE]);
    const fallback = primeEngine.computeRating(
      { ...candidate, playerId: 'missing' },
      'career_season',
    );
    expect(fallback).toMatchObject({ overall: 40, sourceSeason: 2023, positionGroup: 'QB' });
  });

  it('marks unrated OL/DL fallbacks as team-level proxies with the badge', () => {
    const olCandidate: PlayerCandidate = {
      ...candidate,
      playerId: 'ol-missing',
      primaryPosition: 'OT',
    };
    const rating = engine.computeRating(olCandidate, 'career_season');
    expect(rating.isTeamLevelProxy).toBe(true);
    expect(rating.overall).toBe(40);
    expect(engine.getRatingBadges(olCandidate, 'career_season')).toEqual([TEAM_LEVEL_RATING_BADGE]);
    expect(engine.getRatingBadges(candidate, 'career_season')).toEqual([]);
  });

  it('rejects an NFL pool unit', () => {
    expect(() =>
      engine.computeRating(
        {
          ...candidate,
          poolUnit: { sportId: 'nfl', franchiseId: 'KC', season: 2023 },
        },
        'career_season',
      ),
    ).toThrow('CFB candidates must use a CFB pool unit');
  });

  it('simulates a 12-game quick season', async () => {
    const result = await engine.simulateSeason(
      simulationRoster,
      { modeId: 'core', difficulty: 'normal', seed: 'engine-test', options: {} },
      {
        season: 2023,
        modelVersion: 'test',
        dataVersion: 'test',
        opponents: [{ id: 'opponent', name: 'Opponent', rating: 1500, site: 'neutral', facts: {} }],
        facts: {},
      },
    );
    expect(result.record.wins + result.record.losses + result.record.ties).toBe(12);
    expect(result.stages[0]?.games).toHaveLength(12);
    expect(result.postseasonResult).toBeNull();
  });

  it('builds a flavored 12-game slate when no opponents are supplied', async () => {
    const slatePrograms: CfbProgramSeason[] = [
      programSeason,
      ...Array.from({ length: 13 }, (_, i) => ({
        ...programSeason,
        cfbdTeamId: i + 2,
        wins: i % 13,
        losses: 12 - (i % 13),
        apFinalRank: null,
      })),
      ...Array.from({ length: 16 }, (_, i) => ({
        ...programSeason,
        cfbdTeamId: i + 20,
        conferenceKey: i % 2 === 0 ? 'sec' : 'big-ten',
        wins: i % 13,
        losses: 12 - (i % 13),
        apFinalRank: null,
      })),
    ];
    const slateEngine = new CfbSportEngine({
      conferences: [conference],
      teams: slatePrograms.map((row) => ({ ...team, cfbdTeamId: row.cfbdTeamId })),
      programSeasons: slatePrograms,
      ratings: [],
    });
    const result = await slateEngine.simulateSeason(
      simulationRoster,
      { modeId: 'core', difficulty: 'normal', seed: 'slate-test', options: {} },
      { season: 2023, modelVersion: 'test', dataVersion: 'test', opponents: [], facts: {} },
    );
    const games = result.stages[0]?.games ?? [];
    expect(games).toHaveLength(12);
    expect(result.record.wins + result.record.losses).toBe(12);
    expect(result.record.ties).toBe(0);
    const counts = new Map<string, number>();
    for (const game of games) {
      const flavor = String(game.facts.flavor);
      counts.set(flavor, (counts.get(flavor) ?? 0) + 1);
    }
    expect(counts.get('conference')).toBe(8);
    expect(counts.get('rivalry')).toBe(2);
    expect(counts.get('nonconference_marquee')).toBe(1);
    expect(counts.get('nonconference')).toBe(1);
    expect(result.facts.strengthDistributionSource).toBe('historical');
    expect(result.facts.strengthDistribution).toHaveLength(3);
  });

  it('exposes CFB trophy definitions and evaluates Undefeated & Untied', () => {
    expect(engine.getTrophyDefinitions().map((definition) => definition.code)).toEqual([
      'undefeated_untied',
      'the_natty',
      'statement_win',
      'overtime_classic',
      'legacy_era_lineup',
    ]);
    const result: SeasonResult = {
      draftId: 'trophy-draft',
      sportId: 'cfb',
      modeId: 'core',
      seed: 'seed',
      modelVersion: 'test',
      dataVersion: 'test',
      record: { wins: 12, losses: 0, ties: 0 },
      pointsFor: 500,
      pointsAgainst: 100,
      postseasonResult: 'national_champion',
      stages: [],
      facts: { conferenceChampion: true, fullCampaign: true, cfpSeed: 1 },
    };
    const earned = engine.evaluateTrophies(result, {
      userId: null,
      roster: simulationRoster,
      priorResults: [],
      earnedTrophies: [],
      evaluatedAt: '2024-01-01T00:00:00Z',
      facts: {},
    });
    expect(earned.map((trophy) => trophy.code)).toContain('undefeated_untied');
  });
});
