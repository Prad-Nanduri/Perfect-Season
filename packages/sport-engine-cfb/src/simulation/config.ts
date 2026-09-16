import type { SportSimulationConfig } from '@perfect-season/simulation';

export const CFB_SIMULATION_CONFIG: SportSimulationConfig = {
  possessionsPerTeam: 12,
  scoringTable: [
    { outcome: 'touchdown', points: 7, probability: 0.22 },
    { outcome: 'field_goal', points: 3, probability: 0.14 },
    { outcome: 'safety', points: 2, probability: 0.005 },
    { outcome: 'none', points: 0, probability: 0.635 },
  ],
  strengthTilt: 0.35,
  ratingScale: { baseElo: 1500, eloPerRatingPoint: 16 },
  homeAdvantageRating: 3,
  varianceSigmaRating: 6,
  // CFB has no ties; overtime repeats until a winner.
  overtime: { maxPeriods: null, tiesAllowed: false },
  opponentDistribution: { meanRating: 68, sdRating: 10 },
  difficultyOffsets: { easy: -5, normal: 0, hard: 5 },
};

// Full campaign (conference title + CFP/bowl) is opt-in per draft via the
// `fullCampaign` simulation option; seeding is still provisional — by win
// total rather than real AP/CFP rankings (spec §2A.4, §2B).
export const ENABLE_FULL_CAMPAIGN = true as const;

export const CFB_REGULAR_SEASON_GAMES = 12;
export const CFB_CONFERENCE_TITLE_WIN_THRESHOLD = 10;
