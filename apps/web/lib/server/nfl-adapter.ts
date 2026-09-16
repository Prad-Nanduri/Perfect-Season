import type { CompletedRoster, DraftPoolUnit, Opponent } from '@perfect-season/sport-engine-core';
import { ratingToElo } from '@perfect-season/simulation';
import {
  NFL_SIMULATION_CONFIG,
  type NflFixtureData,
  type NflSportEngine,
} from '@perfect-season/sport-engine-nfl';
import { buildCandidates, availableSeasons } from './candidates';
import { getNflData, getNflEngine } from './nfl-engine';
import type { DraftState, NflDraftPoolUnit } from './draft-store';
import type { SportDraftAdapter } from './sport-adapter';

export const NFL_SIMULATION_MODEL_VERSION = 'nfl-sim-v1';
export const NFL_SIMULATION_DATA_VERSION = '2023-fixtures';

function assertNflUnit(unit: DraftPoolUnit): NflDraftPoolUnit {
  if (unit.sportId !== 'nfl') throw new Error('Expected an NFL draft pool unit');
  return unit;
}

function completedRoster(
  state: DraftState,
  engine: NflSportEngine,
  data: NflFixtureData,
): CompletedRoster {
  const scheme = engine.getSchemePresets().find((item) => item.id === state.schemeId);
  if (scheme === undefined) throw new Error(`Unknown NFL scheme: ${state.schemeId}`);
  const picks = scheme.slots.map((slot) => {
    const stored = state.picks[slot.code];
    if (stored === undefined) throw new Error(`Missing completed pick for ${slot.code}`);
    const candidate = buildCandidates(assertNflUnit(stored.unit), data).find(
      (item) => item.playerId === stored.playerId,
    );
    if (candidate === undefined) throw new Error(`Missing candidate for ${stored.playerId}`);
    return { slot, candidate, rating: stored.rating, spinSeed: stored.spinSeed };
  });
  return {
    draftId: state.id,
    sportId: 'nfl',
    schemeId: state.schemeId,
    ratingMode: state.ratingMode,
    picks: picks as unknown as CompletedRoster['picks'],
  };
}

export function createNflAdapter(): SportDraftAdapter {
  return {
    sportId: 'nfl',
    engine: () => getNflEngine(),
    buildCandidates: (unit) => buildCandidates(assertNflUnit(unit), getNflData()),
    availableSeasons: () => availableSeasons(getNflData()),
    resolveSpinUnit: (spinSeed, usedUnits) =>
      getNflEngine().resolveSpinUnit(spinSeed, {
        modeId: 'core',
        seasonRange: availableSeasons(getNflData()),
        excludedUnits: usedUnits,
        criteria: {},
      }),
    spinUnitView: async (unit) => {
      const nfl = assertNflUnit(unit);
      const data = getNflData();
      const franchise = data.franchises.find((item) => item.franchiseKey === nfl.franchiseId);
      if (franchise === undefined) throw new Error('Franchise not found');
      const season = data.franchiseSeasons.find(
        (item) => item.franchiseKey === nfl.franchiseId && item.season === nfl.season,
      );
      return {
        key: franchise.franchiseKey,
        name: franchise.name,
        abbreviation: franchise.abbreviation,
        conference: franchise.conference,
        logoUrl: (await getNflEngine().getFranchiseLogo(franchise.franchiseKey)).url,
        record:
          season === undefined || season.wins === null
            ? null
            : { wins: season.wins, losses: season.losses ?? 0, ties: season.ties ?? 0 },
        eraTier: season?.eraTier ?? 'legacy',
      };
    },
    opponentContext: () => {
      const data = getNflData();
      const records = new Map(
        data.franchiseSeasons
          .filter((season) => season.season === 2023)
          .map((season) => [season.franchiseKey, season]),
      );
      const opponents: Opponent[] = data.franchises.map((franchise) => {
        const record = records.get(franchise.franchiseKey);
        const games =
          record === null || record === undefined || record.wins === null
            ? 0
            : record.wins + (record.losses ?? 0) + (record.ties ?? 0);
        const winPct =
          games > 0 && record !== undefined && record.wins !== null
            ? (record.wins + 0.5 * (record.ties ?? 0)) / games
            : 0.5;
        // Map win% onto roughly a 30–90 strength band on the 0–99 scale.
        const strength = Math.min(99, Math.max(0, 30 + winPct * 60));
        return {
          id: franchise.franchiseKey,
          name: franchise.currentName,
          rating: ratingToElo(strength, NFL_SIMULATION_CONFIG.ratingScale),
          site: 'neutral',
          facts: {
            abbreviation: franchise.abbreviation,
            conference: franchise.conference,
            logoUrl: franchise.logoUrl,
          },
        };
      });
      return {
        season: 2023,
        modelVersion: NFL_SIMULATION_MODEL_VERSION,
        dataVersion: NFL_SIMULATION_DATA_VERSION,
        opponents,
        facts: {},
      };
    },
    simSeed: (draftId) => `nfl-sim:${draftId}`,
    simulationOptions: (input) => ({ fullGauntlet: input.fullGauntlet === true }),
    buildCompletedRoster: (state) => completedRoster(state, getNflEngine(), getNflData()),
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
