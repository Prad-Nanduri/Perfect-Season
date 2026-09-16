import type { GameResult } from '@perfect-season/sport-engine-core';
import type { StoredResult } from './server/draft-store';
import type { Team } from './teams';
import { nflTeams } from './teams/nfl';

export type NflLabeledGame = GameResult & {
  readonly opponentName: string;
  readonly opponentTeam: Team | null;
};
export type NflLabeledResult = Omit<StoredResult, 'season'> & {
  readonly season: Omit<StoredResult['season'], 'stages'> & {
    readonly stages: readonly (Omit<StoredResult['season']['stages'][number], 'games'> & {
      readonly games: readonly NflLabeledGame[];
    })[];
  };
};

const teamsByKey = new Map(nflTeams.map((team) => [team.abbreviation, team]));

function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .map((part) => (part[0] === undefined ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Human-readable opponent for an NFL game log row. Simulated opponents carry
 * their franchiseKey, which matches the UI team's abbreviation; legacy
 * synthetic ids (`synthetic-N`, `playoff-<round>`) render a generic label —
 * the raw id is never shown.
 */
export function nflOpponentLabel(game: GameResult): { name: string; team: Team | null } {
  const team = teamsByKey.get(game.opponentId);
  if (team !== undefined) return { name: team.displayName, team };
  const synthetic = /^synthetic-(\d+)$/.exec(game.opponentId);
  if (synthetic !== null) return { name: `League opponent ${synthetic[1]}`, team: null };
  if (game.opponentId.startsWith('playoff-')) {
    return { name: `${titleCase(game.opponentId.slice('playoff-'.length))} opponent`, team: null };
  }
  return { name: 'Opponent', team: null };
}

/** Decorate every game in a stored NFL result with a resolved opponent. */
export function labelNflResult(result: StoredResult): NflLabeledResult {
  return {
    ...result,
    season: {
      ...result.season,
      stages: result.season.stages.map((stage) => ({
        ...stage,
        games: stage.games.map((game) => {
          const { name, team } = nflOpponentLabel(game);
          return { ...game, opponentName: name, opponentTeam: team };
        }),
      })),
    },
  };
}
