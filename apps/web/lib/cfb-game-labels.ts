import type { GameResult } from '@perfect-season/sport-engine-core';
import type { StoredResult } from './server/draft-store';
import type { CfbTeam } from '@perfect-season/sport-engine-cfb';

export type CfbLabeledGame = GameResult & {
  readonly opponentName: string;
  readonly opponentLogoUrl: string | null;
};
export type CfbLabeledResult = Omit<StoredResult, 'season'> & {
  readonly season: Omit<StoredResult['season'], 'stages'> & {
    readonly stages: readonly (Omit<StoredResult['season']['stages'][number], 'games'> & {
      readonly games: readonly CfbLabeledGame[];
    })[];
  };
};

const FLAVOR_LABELS: Record<string, string> = {
  rivalry: 'Rivalry game',
  nonconference_marquee: 'Marquee non-conference',
  conference: 'Conference opponent',
  nonconference: 'Non-conference opponent',
};

/**
 * Human-readable opponent name for a CFB game log row. Real opponents carry
 * their numeric cfbdTeamId and resolve to the school name; synthetic slate
 * fillers (`cfb-synth-*`, spec §2A.4) render their flavor instead — the raw
 * synthetic id is never shown.
 */
export function cfbOpponentLabel(
  game: GameResult,
  teams: readonly Pick<CfbTeam, 'cfbdTeamId' | 'school' | 'logoUrl'>[],
): { readonly name: string; readonly logoUrl: string | null } {
  if (/^\d+$/.test(game.opponentId)) {
    const team = teams.find((entry) => entry.cfbdTeamId === Number(game.opponentId));
    if (team !== undefined) return { name: team.school, logoUrl: team.logoUrl };
  }
  const flavor = game.facts.flavor;
  if (typeof flavor === 'string' && flavor in FLAVOR_LABELS) {
    return { name: FLAVOR_LABELS[flavor] ?? 'Opponent', logoUrl: null };
  }
  return { name: 'Opponent', logoUrl: null };
}

/** Slate-calibrated opponent strength (0–99), when the game carries it. */
export function cfbOpponentStrength(game: GameResult): number | null {
  const strength = game.facts.strengthRating;
  return typeof strength === 'number' ? Math.round(strength) : null;
}

/** Decorate every game in a stored CFB result with a resolved opponentName. */
export function labelCfbResult(
  result: StoredResult,
  teams: readonly Pick<CfbTeam, 'cfbdTeamId' | 'school' | 'logoUrl'>[],
): CfbLabeledResult {
  return {
    ...result,
    season: {
      ...result.season,
      stages: result.season.stages.map((stage) => ({
        ...stage,
        games: stage.games.map((game) => {
          const { name, logoUrl } = cfbOpponentLabel(game, teams);
          return { ...game, opponentName: name, opponentLogoUrl: logoUrl };
        }),
      })),
    },
  };
}
