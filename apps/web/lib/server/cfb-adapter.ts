import type {
  CompletedRoster,
  DraftPoolUnit,
  PlayerCandidate,
} from '@perfect-season/sport-engine-core';
import { createRng, createSeed } from '@perfect-season/sport-engine-core/utils';
import type {
  CfbFixtureData,
  CfbPlayer,
  CfbRating,
  CfbSportEngine,
} from '@perfect-season/sport-engine-cfb';
import {
  buildCfbOpponentSlate,
  CFB_RATING_MODEL_VERSION,
  describeConference,
  filterSpinPool,
  toPositionGroup,
} from '@perfect-season/sport-engine-cfb';
import { getCfbData, getCfbEngine } from './sport-engines';
import type { CfbDraftPoolUnit, DraftState } from './draft-store';
import type { SportDraftAdapter } from './sport-adapter';

export const CFB_SIMULATION_MODEL_VERSION = 'cfb-sim-v1';
export const CFB_SIMULATION_DATA_VERSION = '2023-fixtures';

function assertCfbUnit(unit: DraftPoolUnit): CfbDraftPoolUnit {
  if (unit.sportId !== 'cfb') throw new Error('Expected a CFB draft pool unit');
  return unit;
}

// Only CFBD fixture data ships on the box today; these placeholders keep every
// position draftable until the real 2023 ETL data lands. Turn this off once a
// full season dataset exists.
const CFB_PLACEHOLDER_CANDIDATES = true;

const CFB_TEAM_LEVEL_PROXY_POSITIONS: ReadonlySet<string> = new Set(['OT', 'OG', 'C', 'DE', 'DT']);

const CFB_FALLBACK_POSITIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'OT',
  'OG',
  'C',
  'DE',
  'DT',
  'ILB',
  'OLB',
  'CB',
  'S',
  'K',
  'P',
] as const;

interface CfbIndex {
  readonly playersById: Map<string, CfbPlayer>;
  readonly ratingsByUnit: Map<string, CfbRating[]>;
  readonly candidatesByUnit: Map<string, PlayerCandidate[]>;
}

// The fixture holds ~300k players/ratings across 20+ seasons; index once per
// dataset instead of rescanning on every spin, pick, and roster build.
const cfbIndexCache = new WeakMap<CfbFixtureData, CfbIndex>();

function cfbIndex(data: CfbFixtureData): CfbIndex {
  let index = cfbIndexCache.get(data);
  if (index !== undefined) return index;
  const ratingsByUnit = new Map<string, CfbRating[]>();
  for (const rating of data.ratings) {
    const key = `${rating.cfbdTeamId}:${rating.season}`;
    const bucket = ratingsByUnit.get(key);
    if (bucket === undefined) ratingsByUnit.set(key, [rating]);
    else bucket.push(rating);
  }
  index = {
    playersById: new Map(data.players.map((player) => [player.cfbdPlayerId, player])),
    ratingsByUnit,
    candidatesByUnit: new Map(),
  };
  cfbIndexCache.set(data, index);
  return index;
}

function buildCfbCandidates(unit: CfbDraftPoolUnit, data: CfbFixtureData): PlayerCandidate[] {
  const index = cfbIndex(data);
  const unitKey = `${unit.programId}:${unit.season}`;
  const cached = index.candidatesByUnit.get(unitKey);
  if (cached !== undefined) return cached;
  const ratings = index.ratingsByUnit.get(`${Number(unit.programId)}:${unit.season}`) ?? [];
  const players = index.playersById;
  const seen = new Set<string>();
  const candidates = ratings.flatMap((rating) => {
    if (seen.has(rating.cfbdPlayerId)) return [];
    seen.add(rating.cfbdPlayerId);
    const player = players.get(rating.cfbdPlayerId);
    if (player === undefined) return [];
    return [
      {
        playerId: player.cfbdPlayerId,
        fullName: player.fullName,
        primaryPosition: player.primaryPosition,
        poolUnit: unit,
        seasons: [
          {
            poolUnit: unit,
            position: player.primaryPosition,
            confidenceTier: rating.confidenceTier,
            stats: {},
          },
        ],
        traits: {
          isTeamLevelProxy: rating.isTeamLevelProxy,
          badges: rating.badges,
          headshotUrl: null,
        },
      },
    ];
  });
  const school =
    data.teams.find((team) => team.cfbdTeamId === Number(unit.programId))?.school ?? 'Program';
  // Append a proxy only for position groups the program-season has no real
  // candidate for — real data always wins over placeholders.
  const coveredGroups = new Set(
    candidates
      .map((candidate) => toPositionGroup(candidate.primaryPosition))
      .filter((group): group is NonNullable<typeof group> => group !== null),
  );
  const proxies = CFB_FALLBACK_POSITIONS.filter((position) => {
    const group = toPositionGroup(position);
    if (group !== null && coveredGroups.has(group)) return false;
    return CFB_TEAM_LEVEL_PROXY_POSITIONS.has(position) || CFB_PLACEHOLDER_CANDIDATES;
  }).map((position, index) => {
    const teamLevelProxy = CFB_TEAM_LEVEL_PROXY_POSITIONS.has(position);
    return {
      playerId: `cfb-proxy-${unit.programId}-${unit.season}-${position}-${index}`,
      // Placeholder status lives on the badge, not the name (names truncate).
      fullName: `${school} ${position}`,
      primaryPosition: position,
      poolUnit: unit,
      seasons: [{ poolUnit: unit, position, confidenceTier: 'legacy' as const, stats: {} }],
      traits: {
        isTeamLevelProxy: teamLevelProxy,
        synthetic: !teamLevelProxy,
        badges: teamLevelProxy ? ['Team-Level Rating'] : ['Placeholder (no player data)'],
        headshotUrl: null,
      },
    };
  });
  const result = [...candidates, ...proxies];
  index.candidatesByUnit.set(unitKey, result);
  return result;
}

function completedRoster(
  state: DraftState,
  engine: CfbSportEngine,
  data: CfbFixtureData,
): CompletedRoster {
  const scheme = engine.getSchemePresets().find((item) => item.id === state.schemeId);
  if (scheme === undefined) throw new Error(`Unknown CFB scheme: ${state.schemeId}`);
  const picks = scheme.slots.map((slot) => {
    const stored = state.picks[slot.code];
    if (stored === undefined) throw new Error(`Missing completed pick for ${slot.code}`);
    const candidates = buildCfbCandidates(assertCfbUnit(stored.unit), data);
    const candidate = candidates.find((item) => item.playerId === stored.playerId);
    if (candidate === undefined) throw new Error(`Missing candidate for ${stored.playerId}`);
    return { slot, candidate, rating: stored.rating, spinSeed: stored.spinSeed };
  });
  return {
    draftId: state.id,
    sportId: 'cfb',
    schemeId: state.schemeId,
    ratingMode: state.ratingMode,
    picks: picks as unknown as CompletedRoster['picks'],
  };
}

export function createCfbAdapter(): SportDraftAdapter {
  return {
    sportId: 'cfb',
    engine: () => getCfbEngine(),
    buildCandidates: (unit) => buildCfbCandidates(assertCfbUnit(unit), getCfbData()),
    availableSeasons: () => {
      const seasons = getCfbData()
        .programSeasons.map((row) => row.season)
        .sort((a, b) => a - b);
      return { from: seasons[0] ?? 2005, through: seasons.at(-1) ?? 2023 };
    },
    resolveSpinUnit: (spinSeed, usedUnits) => {
      const data = getCfbData();
      const poolSize = new Set(
        filterSpinPool(data.programSeasons).map((row) => `${row.cfbdTeamId}:${row.season}`),
      ).size;
      // Fixture/demo datasets can hold fewer than 24 program-seasons; once the
      // spin pool is exhausted, re-spin without exclusions instead of failing.
      const excludedUnits = usedUnits.length >= poolSize ? [] : usedUnits;
      const seasons = data.programSeasons.map((row) => row.season).sort((a, b) => a - b);
      return getCfbEngine().resolveSpinUnit(spinSeed, {
        modeId: 'core',
        seasonRange: { from: seasons[0] ?? 2005, through: seasons.at(-1) ?? 2023 },
        excludedUnits,
        criteria: {},
      });
    },
    spinUnitView: async (unit) => {
      const cfb = assertCfbUnit(unit);
      const data = getCfbData();
      const team = data.teams.find((item) => item.cfbdTeamId === Number(cfb.programId));
      if (team === undefined) throw new Error('Program not found');
      const season = data.programSeasons.find(
        (item) => item.cfbdTeamId === Number(cfb.programId) && item.season === cfb.season,
      );
      const current = data.programSeasons.find(
        (item) => item.cfbdTeamId === Number(cfb.programId) && item.membershipStatus === 'fbs',
      );
      const conference = describeConference(
        cfb.conferenceId,
        current?.conferenceKey ?? null,
        data.conferences,
      );
      return {
        key: String(team.cfbdTeamId),
        name: team.school,
        abbreviation: team.abbreviation,
        conference: conference.label,
        logoUrl: team.logoUrl,
        record:
          season?.wins === null || season?.wins === undefined
            ? null
            : { wins: season.wins, losses: season.losses ?? 0, ties: 0 },
        eraTier: season?.eraTier ?? 'legacy',
        color: team.color,
        alternateColor: team.alternateColor,
      };
    },
    opponentContext: (unit) => {
      const data = getCfbData();
      const opponents =
        unit?.sportId === 'cfb'
          ? buildCfbOpponentSlate({
              unit,
              programSeasons: data.programSeasons,
              teams: data.teams,
              rng: createRng(`cfb-slate:${unit.programId}:${unit.season}`),
            })
          : [];
      return {
        season: unit?.sportId === 'cfb' ? unit.season : 2023,
        modelVersion: CFB_SIMULATION_MODEL_VERSION,
        dataVersion: CFB_SIMULATION_DATA_VERSION,
        opponents,
        facts: {},
      };
    },
    simSeed: (draftId) => createSeed('cfb-sim', draftId),
    simulationOptions: (input) => ({ fullCampaign: input.fullCampaign === true }),
    buildCompletedRoster: (state) => completedRoster(state, getCfbEngine(), getCfbData()),
    toClientPick: (pick, ratingHidden) => ({ ...pick, rating: ratingHidden ? null : pick.rating }),
    pickMvp: (state, scheme) => {
      const picks = scheme.slots
        .map((slot) => state.picks[slot.code])
        .filter((pick): pick is NonNullable<typeof pick> => pick !== undefined);
      const mvp = picks.reduce(
        (best, pick) => (best === null || pick.rating.overall > best.rating.overall ? pick : best),
        null as (typeof picks)[number] | null,
      );
      if (mvp === null) throw new Error('Cannot choose an MVP without completed picks');
      return {
        slotCode: mvp.slotCode,
        playerId: mvp.playerId,
        fullName: mvp.fullName,
        primaryPosition: mvp.primaryPosition,
        headshotUrl: mvp.headshotUrl,
        rating: mvp.rating.overall,
        unit: mvp.unit,
      };
    },
  };
}

void CFB_RATING_MODEL_VERSION;
