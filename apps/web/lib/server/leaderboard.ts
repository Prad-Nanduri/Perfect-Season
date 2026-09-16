import { createSupabaseServiceClient } from '@perfect-season/db';
import type { SportId } from '@perfect-season/sport-engine-core';
import type { Difficulty, RatingMode } from '@perfect-season/sport-engine-core';
import type { DraftState, StoredResult } from './draft-store';
import { getSessionStore } from './session-store';

export function isLeaderboardConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

const ADJECTIVES = [
  'Audacious',
  'Blitzing',
  'Bone-Crushing',
  'Clutch',
  'Crafty',
  'Dazzling',
  'Electric',
  'Fearless',
  'Fiery',
  'Gritty',
  'Heraldic',
  'Ironclad',
  'Jumbo',
  'Lightning',
  'Mighty',
  'Nimble',
  'Overtime',
  'Prime-Time',
  'Rocket',
  'Ruthless',
  'Sideline',
  'Sneaky',
  'Stadium',
  'Thundering',
  'Two-Minute',
  'Untamed',
  'Victory',
  'Wildcat',
  'Wing-T',
  'Zero-Blitz',
] as const;

const ANIMALS = [
  'Badgers',
  'Bears',
  'Bengals',
  'Bison',
  'Broncos',
  'Bulldogs',
  'Cardinals',
  'Cavaliers',
  'Cobras',
  'Cougars',
  'Cyclones',
  'Eagles',
  'Falcons',
  'Foxes',
  'Gators',
  'Hawkeyes',
  'Hornets',
  'Huskies',
  'Jaguars',
  'Longhorns',
  'Mustangs',
  'Owls',
  'Panthers',
  'Raptors',
  'Rebels',
  'Seminoles',
  'Spartans',
  'Tigers',
  'Trojans',
  'Wolverines',
] as const;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic fun alias for a draft whose owner is anonymous. Never leaks
 *  the guest token or any internal id — the public output is just a name. */
export function guestAlias(draftId: number | string): string {
  const hash = fnv1a(`perfect-season:${String(draftId)}`);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length];
  const number = (Math.floor(hash / (ADJECTIVES.length * ANIMALS.length)) % 90) + 10;
  return `${adjective} ${animal} ${number}`;
}

/** Persist a completed draft + its simulated result into the platform-core
 *  Postgres tables so the leaderboard can read it. Best-effort: failures warn
 *  and never break the simulate response. */
export async function persistCompletedResult(
  state: DraftState,
  result: StoredResult,
): Promise<void> {
  if (!isLeaderboardConfigured()) return;
  try {
    const supabase = createSupabaseServiceClient();
    let userId: number | null = null;
    if (state.guestToken !== null) {
      const sessionStore = getSessionStore();
      const session = await sessionStore.getSession(state.guestToken);
      const user = session?.userId != null ? await sessionStore.getUser(session.userId) : undefined;
      if (user?.email) {
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('email', user.email)
          .maybeSingle();
        if (existing !== null) {
          userId = existing.id as number;
        } else {
          const { data: inserted } = await supabase
            .from('users')
            .insert({ email: user.email, display_name: user.displayName, is_guest: false })
            .select('id')
            .single();
          userId = (inserted?.id as number | undefined) ?? null;
        }
      }
    }
    const { data: draftRow, error: draftError } = await supabase
      .from('drafts')
      .insert({
        sport_id: state.sportId,
        user_id: userId,
        mode: state.modeId,
        draft_order: state.draftOrder,
        difficulty: state.difficulty,
        rating_mode: state.ratingMode,
        scheme_preset: state.schemeId,
        campaign_mode:
          state.sportId === 'cfb'
            ? result.season.facts.fullCampaign === true
              ? 'full_campaign'
              : 'quick_season'
            : null,
        status: 'complete',
        created_at: state.createdAt,
        completed_at: result.simulatedAt,
      })
      .select('id')
      .single();
    if (draftError || draftRow === null) {
      console.warn('[leaderboard] draft insert failed', draftError?.message);
      return;
    }
    const { error: resultError } = await supabase.from('season_results').insert({
      draft_id: draftRow.id,
      record_wins: result.season.record.wins,
      record_losses: result.season.record.losses,
      points_for: result.season.pointsFor,
      points_against: result.season.pointsAgainst,
      postseason_result: result.season.postseasonResult,
      simulated_at: result.simulatedAt,
      detail_jsonb: {
        ties: result.season.record.ties,
        fullGauntlet: result.fullGauntlet,
        trophies: result.trophies.map((trophy) => trophy.code),
        mvp: result.mvp.fullName,
        localDraftId: state.id,
      },
    });
    if (resultError) console.warn('[leaderboard] result insert failed', resultError.message);
  } catch (error) {
    console.warn('[leaderboard] persistence failed', error);
  }
}

/** Attach a verified email + chosen display name to one previously-persisted
 *  result (spec §0.5 guest → account upgrade). Returns false when the result
 *  was never persisted (e.g. drafted before this feature shipped). */
export async function claimResultForUser(
  email: string,
  displayName: string,
  localDraftId: string,
): Promise<boolean> {
  if (!isLeaderboardConfigured()) return false;
  const supabase = createSupabaseServiceClient();
  const { data: result, error: findError } = await supabase
    .from('season_results')
    .select('draft_id')
    .filter('detail_jsonb->>localDraftId', 'eq', localDraftId)
    .maybeSingle();
  if (findError || result === null) {
    if (findError) console.warn('[leaderboard] claim lookup failed', findError.message);
    return false;
  }
  const normalized = email.trim().toLowerCase();
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalized)
    .maybeSingle();
  let userId: number;
  if (existing !== null) {
    userId = existing.id as number;
    await supabase.from('users').update({ display_name: displayName }).eq('id', userId);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('users')
      .insert({ email: normalized, display_name: displayName, is_guest: false })
      .select('id')
      .single();
    if (insertError || inserted === null) {
      console.warn('[leaderboard] claim user upsert failed', insertError?.message);
      return false;
    }
    userId = inserted.id as number;
  }
  const { error: updateError } = await supabase
    .from('drafts')
    .update({ user_id: userId })
    .eq('id', result.draft_id);
  if (updateError) console.warn('[leaderboard] claim update failed', updateError.message);
  return updateError === null;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly alias: string;
  readonly sport: SportId;
  readonly difficulty: Difficulty;
  readonly ratingMode: RatingMode;
  readonly record: { readonly wins: number; readonly losses: number; readonly ties: number };
  readonly pointDifferential: number;
  readonly postseasonResult: string | null;
  readonly trophyCount: number;
  readonly completedAt: string;
}

interface LeaderboardDraftRow {
  id: number;
  sport_id: SportId;
  difficulty: Difficulty;
  rating_mode: RatingMode;
  completed_at: string | null;
  user_id: number | null;
}

interface LeaderboardResultRow {
  draft_id: number;
  record_wins: number;
  record_losses: number;
  points_for: number;
  points_against: number;
  postseason_result: string | null;
  simulated_at: string;
  detail_jsonb: { ties?: number; trophies?: unknown[] } | null;
}

// Two plain selects joined in app code: the embedded-join form proved flaky
// against the hosted PostgREST (empty embeds on some filters, no error).
export async function listLeaderboard(input: {
  sport: SportId;
  difficulty: Difficulty | 'all';
  limit?: number;
}): Promise<readonly LeaderboardEntry[]> {
  if (!isLeaderboardConfigured()) return [];
  const supabase = createSupabaseServiceClient();
  let draftQuery = supabase
    .from('drafts')
    .select('id,sport_id,difficulty,rating_mode,completed_at,user_id')
    .eq('sport_id', input.sport)
    .eq('status', 'complete')
    .limit(500);
  if (input.difficulty !== 'all') draftQuery = draftQuery.eq('difficulty', input.difficulty);
  const { data: draftRows, error: draftError } = await draftQuery;
  if (draftError || draftRows === null || draftRows.length === 0) {
    if (draftError) console.warn('[leaderboard] drafts query failed', draftError.message);
    return [];
  }
  const drafts = new Map(
    (draftRows as unknown as LeaderboardDraftRow[]).map((row) => [row.id, row]),
  );

  const { data: resultRows, error: resultError } = await supabase
    .from('season_results')
    .select(
      'draft_id,record_wins,record_losses,points_for,points_against,postseason_result,simulated_at,detail_jsonb',
    )
    .in('draft_id', [...drafts.keys()])
    .order('record_wins', { ascending: false })
    .order('points_for', { ascending: false })
    .limit(500);
  if (resultError || resultRows === null) {
    if (resultError) console.warn('[leaderboard] results query failed', resultError.message);
    return [];
  }

  const userIds = [
    ...new Set(
      [...drafts.values()].map((draft) => draft.user_id).filter((id): id is number => id !== null),
    ),
  ];
  const aliases = new Map<number, string>();
  if (userIds.length > 0) {
    const { data: userRows } = await supabase
      .from('users')
      .select('id,display_name')
      .in('id', userIds);
    for (const user of (userRows ?? []) as { id: number; display_name: string | null }[]) {
      if (user.display_name !== null) aliases.set(user.id, user.display_name);
    }
  }

  const rows = (resultRows as unknown as LeaderboardResultRow[]).filter(
    (row) => drafts.get(row.draft_id) !== undefined,
  );
  rows.sort((a, b) => {
    if (b.record_wins !== a.record_wins) return b.record_wins - a.record_wins;
    if (a.record_losses !== b.record_losses) return a.record_losses - b.record_losses;
    const aDiff = a.points_for - a.points_against;
    const bDiff = b.points_for - b.points_against;
    if (bDiff !== aDiff) return bDiff - aDiff;
    return a.simulated_at.localeCompare(b.simulated_at);
  });
  const limit = Math.min(input.limit ?? 50, 100);
  return rows.slice(0, limit).map((row, index) => {
    const draft = drafts.get(row.draft_id)!;
    const ties = row.detail_jsonb?.ties ?? 0;
    return {
      rank: index + 1,
      alias:
        (draft.user_id !== null ? aliases.get(draft.user_id) : undefined) ?? guestAlias(draft.id),
      sport: draft.sport_id,
      difficulty: draft.difficulty,
      ratingMode: draft.rating_mode,
      record: { wins: row.record_wins, losses: row.record_losses, ties },
      pointDifferential: row.points_for - row.points_against,
      postseasonResult: row.postseason_result,
      trophyCount: row.detail_jsonb?.trophies?.length ?? 0,
      completedAt: draft.completed_at ?? row.simulated_at,
    };
  });
}
