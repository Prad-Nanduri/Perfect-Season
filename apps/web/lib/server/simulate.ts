import type { SimulationMode } from '@perfect-season/sport-engine-core';
import type { DraftState, StoredResult } from './draft-store';
import { completedRoster } from './draft-client';
import { getSportAdapter } from './sport-adapter';

export const NFL_SIMULATION_MODEL_VERSION = 'nfl-sim-v1';
export const NFL_SIMULATION_DATA_VERSION = '2023-fixtures';

export function pickMvp(
  state: DraftState,
  scheme: Parameters<ReturnType<typeof getSportAdapter>['pickMvp']>[1],
): StoredResult['mvp'] {
  return getSportAdapter(state.sportId).pickMvp(state, scheme);
}

export async function simulateDraft(
  state: DraftState,
  opts: {
    readonly fullGauntlet: boolean;
    readonly fullCampaign?: boolean;
    readonly seed: string | null;
  },
): Promise<StoredResult> {
  const adapter = getSportAdapter(state.sportId);
  const engine = adapter.engine();
  const roster = completedRoster(state);
  const unit = [...state.usedUnits].at(-1) ?? null;
  const input =
    state.sportId === 'nfl'
      ? { fullGauntlet: opts.fullGauntlet }
      : { fullCampaign: opts.fullCampaign === true };
  const options = adapter.simulationOptions(input);
  const mode: SimulationMode = {
    modeId: 'core',
    difficulty: state.difficulty,
    seed: opts.seed ?? adapter.simSeed(state.id),
    options,
  };
  const season = await engine.simulateSeason(roster, mode, adapter.opponentContext(unit));
  const evaluatedAt = new Date().toISOString();
  const trophies = engine.evaluateTrophies(season, {
    userId: null,
    roster,
    priorResults: [],
    earnedTrophies: [],
    evaluatedAt,
    facts: {},
  });
  const scheme = engine.getSchemePresets().find((item) => item.id === state.schemeId);
  if (scheme === undefined)
    throw new Error(`Unknown ${state.sportId.toUpperCase()} scheme: ${state.schemeId}`);
  return {
    season,
    trophies,
    mvp: adapter.pickMvp(state, scheme),
    fullGauntlet: opts.fullGauntlet,
    simulatedAt: evaluatedAt,
  };
}
