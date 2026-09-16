import type {
  CompletedRoster,
  EngineFacts,
  GameResult,
  Opponent,
  OpponentContext,
  SeasonRecord,
  SeasonResult,
  SeasonStageResult,
  SimulationMode,
} from '@perfect-season/sport-engine-core';
import {
  aggregateRosterRating,
  createRng,
  createSeed,
  type DeterministicRng,
} from '@perfect-season/sport-engine-core/utils';
import {
  generateSchedule,
  ratingToElo,
  simulateGame as defaultSimulateGame,
  type SimulatedGame,
} from '@perfect-season/simulation';
import {
  CFB_CONFERENCE_TITLE_WIN_THRESHOLD,
  CFB_REGULAR_SEASON_GAMES,
  CFB_SIMULATION_CONFIG,
  ENABLE_FULL_CAMPAIGN,
} from './config';

export type CfbPostseasonResult =
  | 'bowl_won'
  | 'bowl_lost'
  | 'cfp_first_round'
  | 'cfp_quarterfinal'
  | 'cfp_semifinal'
  | 'cfp_runner_up'
  | 'national_champion';

export interface CfbSeasonDependencies {
  readonly simulateGame?: typeof defaultSimulateGame;
  readonly rng?: DeterministicRng;
  readonly seed?: string;
  // Test hook: overrides the shipping default ENABLE_FULL_CAMPAIGN.
  readonly enableFullCampaign?: boolean;
}

const CFP_ROUNDS = ['first_round', 'quarterfinal', 'semifinal', 'championship'] as const;
type CfpRound = (typeof CFP_ROUNDS)[number];

// Escalating synthetic-opponent strength: mean + N standard deviations per
// round (spec §2A.4 — a tougher draw the deeper the run goes).
const CFP_ROUND_SD_OFFSETS: Readonly<Record<CfpRound, number>> = {
  first_round: 1,
  quarterfinal: 1.5,
  semifinal: 2,
  championship: 2.5,
};

const CFP_LOSS_OUTCOMES: Readonly<Record<CfpRound, CfbPostseasonResult>> = {
  first_round: 'cfp_first_round',
  quarterfinal: 'cfp_quarterfinal',
  semifinal: 'cfp_semifinal',
  championship: 'cfp_runner_up',
};

function recordFor(games: readonly GameResult[]): SeasonRecord {
  return games.reduce(
    (record, game) => ({
      wins: record.wins + (game.outcome === 'win' ? 1 : 0),
      losses: record.losses + (game.outcome === 'loss' ? 1 : 0),
      ties: record.ties + (game.outcome === 'tie' ? 1 : 0),
    }),
    { wins: 0, losses: 0, ties: 0 },
  );
}

function toGameResult(game: SimulatedGame, extraFacts: EngineFacts = {}): GameResult {
  return {
    opponentId: game.opponentId,
    site: game.site,
    pointsFor: game.pointsFor,
    pointsAgainst: game.pointsAgainst,
    outcome: game.tied ? 'tie' : game.won ? 'win' : 'loss',
    facts: {
      ...game.facts,
      ...extraFacts,
      overtimePeriods: game.overtimePeriods,
    },
  };
}

function syntheticOpponent(id: string, name: string, sdOffset: number): Opponent {
  const { meanRating, sdRating } = CFB_SIMULATION_CONFIG.opponentDistribution;
  return {
    id,
    name,
    rating: ratingToElo(meanRating + sdOffset * sdRating, CFB_SIMULATION_CONFIG.ratingScale),
    site: 'neutral',
    facts: {},
  };
}

// Bowl names for each CFP round (new-year's-six rotation, abridged) and for
// non-playoff consolation bowls; picked deterministically via the run's rng.
const CFP_ROUND_BOWLS: Readonly<Record<CfpRound, readonly string[]>> = {
  first_round: [],
  quarterfinal: ['Rose Bowl', 'Sugar Bowl', 'Orange Bowl', 'Cotton Bowl Classic'],
  semifinal: ['Fiesta Bowl', 'Peach Bowl'],
  championship: ['CFP National Championship'],
};

const CONSOLATION_BOWLS = [
  'ReliaQuest Bowl',
  'Alamo Bowl',
  'Pop-Tarts Bowl',
  'Holiday Bowl',
  'Citrus Bowl',
  'Gator Bowl',
  'Sun Bowl',
  'Music City Bowl',
  'Liberty Bowl',
  'Texas Bowl',
] as const;

const CFP_ROUND_LABELS: Readonly<Record<CfpRound, string>> = {
  first_round: 'CFP First Round',
  quarterfinal: 'Quarterfinal',
  semifinal: 'Semifinal',
  championship: 'National Championship',
};

function singleGameStage(
  id: string,
  name: string,
  game: GameResult,
  won: string,
  lost: string,
): SeasonStageResult {
  return {
    id,
    name,
    games: [game],
    record: recordFor([game]),
    outcome: game.outcome === 'win' ? won : lost,
  };
}

// Seed mapping (spec §2A.4): seeds 1–4 get a first-round bye (3 games to the
// title); seeds 5+ play the full 4-round path.
function cfpSeedFor(record: SeasonRecord): number {
  if (record.wins >= 12) return 1;
  if (record.wins === 11) return 3;
  if (record.wins === 10) return 5;
  return 9;
}

export function simulateCfbSeason(
  roster: CompletedRoster,
  mode: SimulationMode,
  opponentContext: OpponentContext,
  deps: CfbSeasonDependencies = {},
): SeasonResult {
  const seed =
    deps.seed ??
    createSeed('cfb-season', roster.draftId, mode.modeId, mode.seed, opponentContext.season);
  const rng = deps.rng ?? createRng(seed);
  const rosterRating = aggregateRosterRating(roster);
  const schedule = generateSchedule({
    games: CFB_REGULAR_SEASON_GAMES,
    difficulty: mode.difficulty,
    opponents: opponentContext.opponents,
    config: CFB_SIMULATION_CONFIG,
    rng,
  });
  const simulateGame = deps.simulateGame ?? defaultSimulateGame;
  const regularGames = schedule.map(({ opponent }) =>
    toGameResult(simulateGame(rosterRating, opponent, CFB_SIMULATION_CONFIG, rng), opponent.facts),
  );
  const regularRecord = recordFor(regularGames);
  const regularStage: SeasonStageResult = {
    id: 'regular_season',
    name: 'Regular Season',
    games: regularGames,
    record: regularRecord,
    outcome: 'complete',
  };

  const fullCampaign =
    (deps.enableFullCampaign ?? ENABLE_FULL_CAMPAIGN) && mode.options.fullCampaign === true;
  const pointsFor = regularGames.reduce((total, game) => total + game.pointsFor, 0);
  const pointsAgainst = regularGames.reduce((total, game) => total + game.pointsAgainst, 0);

  if (!fullCampaign) {
    return {
      draftId: roster.draftId,
      sportId: 'cfb',
      modeId: mode.modeId,
      seed,
      modelVersion: opponentContext.modelVersion,
      dataVersion: opponentContext.dataVersion,
      record: regularRecord,
      pointsFor,
      pointsAgainst,
      postseasonResult: null,
      stages: [regularStage],
      facts: { fullCampaign: false, rosterRating },
    };
  }

  const postseason = simulatePostseasonAndBracket(
    rosterRating,
    regularRecord,
    simulateGame,
    rng,
    opponentContext.opponents,
  );
  return {
    draftId: roster.draftId,
    sportId: 'cfb',
    modeId: mode.modeId,
    seed,
    modelVersion: opponentContext.modelVersion,
    dataVersion: opponentContext.dataVersion,
    record: regularRecord,
    pointsFor,
    pointsAgainst,
    postseasonResult: postseason.result,
    stages: [regularStage, ...postseason.stages],
    facts: {
      fullCampaign: true,
      rosterRating,
      conferenceChampion: postseason.conferenceChampion,
      cfpSeed: postseason.cfpSeed,
    },
  };
}

interface PostseasonOutcome {
  readonly result: CfbPostseasonResult;
  readonly stages: readonly SeasonStageResult[];
  readonly conferenceChampion: boolean;
  readonly cfpSeed: number | null;
}

function drawPostseasonOpponent(
  pool: readonly Opponent[],
  used: Set<string>,
  rng: DeterministicRng,
  fallback: Opponent,
): Opponent {
  const remaining = pool.filter((opponent) => !used.has(opponent.id));
  if (remaining.length === 0) return fallback;
  // Postseason draw leans on the stronger half of the pool.
  const sorted = [...remaining].sort((a, b) => b.rating - a.rating);
  const window = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const pick = window[rng.integer(0, window.length)];
  if (pick === undefined) return fallback;
  used.add(pick.id);
  return pick;
}

function pickBowlName(names: readonly string[], rng: DeterministicRng): string | null {
  if (names.length === 0) return null;
  return names[rng.integer(0, names.length)] ?? null;
}

function simulatePostseasonAndBracket(
  rosterRating: number,
  regularRecord: SeasonRecord,
  simulateGame: typeof defaultSimulateGame,
  rng: DeterministicRng,
  pool: readonly Opponent[],
): PostseasonOutcome {
  const usedOpponents = new Set<string>();

  const bowlGame = (): GameResult => {
    const bowlName = pickBowlName(CONSOLATION_BOWLS, rng) ?? 'Bowl';
    const opponent = drawPostseasonOpponent(
      pool,
      usedOpponents,
      rng,
      syntheticOpponent('bowl', 'Bowl opponent', 1),
    );
    return toGameResult(simulateGame(rosterRating, opponent, CFB_SIMULATION_CONFIG, rng), {
      stage: 'bowl',
      bowlName,
    });
  };

  // ≥10 regular-season wins earns the 13th conference-championship game.
  if (regularRecord.wins < CFB_CONFERENCE_TITLE_WIN_THRESHOLD) {
    const bowl = bowlGame();
    const stageName = typeof bowl.facts.bowlName === 'string' ? bowl.facts.bowlName : 'Bowl Game';
    return {
      result: bowl.outcome === 'win' ? 'bowl_won' : 'bowl_lost',
      stages: [singleGameStage('bowl', stageName, bowl, 'won', 'lost')],
      conferenceChampion: false,
      cfpSeed: null,
    };
  }

  const conferencePool = pool.filter((opponent) => opponent.facts.flavor === 'conference');
  const titleOpponent = drawPostseasonOpponent(
    conferencePool.length > 0 ? conferencePool : pool,
    usedOpponents,
    rng,
    syntheticOpponent('conference-title', 'Conference Championship opponent', 1),
  );
  const titleGame = toGameResult(
    simulateGame(rosterRating, titleOpponent, CFB_SIMULATION_CONFIG, rng),
    { stage: 'conference_championship' },
  );
  const conferenceChampion = titleGame.outcome === 'win';
  const titleStage = singleGameStage(
    'conference_championship',
    'Conference Championship',
    titleGame,
    'won',
    'lost',
  );

  // CFP bid: conference champion, or undefeated regular season.
  if (!conferenceChampion && regularRecord.wins < CFB_REGULAR_SEASON_GAMES) {
    const bowl = bowlGame();
    const bowlStageName =
      typeof bowl.facts.bowlName === 'string' ? bowl.facts.bowlName : 'Bowl Game';
    return {
      result: bowl.outcome === 'win' ? 'bowl_won' : 'bowl_lost',
      stages: [titleStage, singleGameStage('bowl', bowlStageName, bowl, 'won', 'lost')],
      conferenceChampion,
      cfpSeed: null,
    };
  }

  const cfpSeed = cfpSeedFor(regularRecord);
  // Seeds 1–4 skip the first round (3 games); seeds ≥5 play all 4 rounds.
  const rounds = CFP_ROUNDS.slice(cfpSeed <= 4 ? 1 : 0);
  const stages: SeasonStageResult[] = [titleStage];
  const cfpGames: GameResult[] = [];
  for (const round of rounds) {
    const bowlName = pickBowlName(CFP_ROUND_BOWLS[round], rng);
    const opponent = drawPostseasonOpponent(
      pool,
      usedOpponents,
      rng,
      syntheticOpponent(`cfp-${round}`, `CFP ${round} opponent`, CFP_ROUND_SD_OFFSETS[round]),
    );
    const game = toGameResult(simulateGame(rosterRating, opponent, CFB_SIMULATION_CONFIG, rng), {
      stage: 'cfp',
      round,
      roundLabel: CFP_ROUND_LABELS[round],
      ...(bowlName !== null ? { bowlName } : {}),
    });
    cfpGames.push(game);
    if (game.outcome !== 'win') {
      stages.push({
        id: 'cfp',
        name: 'College Football Playoff',
        games: cfpGames,
        record: recordFor(cfpGames),
        outcome: CFP_LOSS_OUTCOMES[round],
      });
      return {
        result: CFP_LOSS_OUTCOMES[round],
        stages,
        conferenceChampion,
        cfpSeed,
      };
    }
  }
  stages.push({
    id: 'cfp',
    name: 'College Football Playoff',
    games: cfpGames,
    record: recordFor(cfpGames),
    outcome: 'national_champion',
  });
  return {
    result: 'national_champion',
    stages,
    conferenceChampion,
    cfpSeed,
  };
}
