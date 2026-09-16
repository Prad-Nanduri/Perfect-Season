import type {
  DraftPoolUnit,
  PlayerCandidate,
  PlayerSeason,
} from '@perfect-season/sport-engine-core';
import type { NflFixtureData } from '@perfect-season/sport-engine-nfl';
import { getNflData } from './nfl-engine';

type NflUnit = Extract<DraftPoolUnit, { sportId: 'nfl' }>;

interface NflIndex {
  readonly playersById: Map<string, NflFixtureData['players'][number]>;
  readonly statsByUnit: Map<string, NflFixtureData['playerSeasonStats'][number][]>;
  readonly candidatesByUnit: Map<string, PlayerCandidate[]>;
  readonly seasons: readonly number[];
}

// Index once per dataset instead of rebuilding the players map and rescanning
// every playerSeasonStats row on each uncached unit (spin/pick/roster build).
const nflIndexCache = new WeakMap<NflFixtureData, NflIndex>();

function nflIndex(data: NflFixtureData): NflIndex {
  let index = nflIndexCache.get(data);
  if (index !== undefined) return index;
  const statsByUnit = new Map<string, NflFixtureData['playerSeasonStats'][number][]>();
  for (const row of data.playerSeasonStats) {
    const key = `${row.franchiseKey}:${row.season}`;
    const bucket = statsByUnit.get(key);
    if (bucket === undefined) statsByUnit.set(key, [row]);
    else bucket.push(row);
  }
  index = {
    playersById: new Map(data.players.map((player) => [player.gsisId, player])),
    statsByUnit,
    candidatesByUnit: new Map(),
    seasons: [...new Set(data.playerSeasonStats.map((row) => row.season))].sort(
      (left, right) => left - right,
    ),
  };
  nflIndexCache.set(data, index);
  return index;
}

export function buildCandidates(unit: NflUnit, data = getNflData()): PlayerCandidate[] {
  const key = `${unit.franchiseId}:${unit.season}`;
  const index = nflIndex(data);
  const cached = index.candidatesByUnit.get(key);
  if (cached !== undefined) return cached;

  const players = index.playersById;
  const candidates = (index.statsByUnit.get(key) ?? []).flatMap((row) => {
    const player = players.get(row.gsisId);
    if (player === undefined) return [];
    const season: PlayerSeason = {
      poolUnit: unit,
      position: row.position,
      confidenceTier: row.eraTier,
      stats: row.stats,
    };
    return [
      {
        playerId: player.gsisId,
        fullName: player.fullName,
        primaryPosition: player.primaryPosition,
        poolUnit: unit,
        seasons: [season],
        traits: {
          versatile: player.versatile,
          ngsPosition: player.ngsPosition,
          depthChartPosition: player.depthChartPosition,
          headshotUrl: player.headshotUrl,
        },
      },
    ];
  });
  index.candidatesByUnit.set(key, candidates);
  return candidates;
}

export function availableSeasons(data = getNflData()): {
  from: number;
  through: number;
} {
  const seasons = nflIndex(data).seasons;
  const from = seasons[0];
  const through = seasons[seasons.length - 1];
  if (from === undefined || through === undefined) {
    throw new Error('No NFL player seasons are available');
  }
  return { from, through };
}
