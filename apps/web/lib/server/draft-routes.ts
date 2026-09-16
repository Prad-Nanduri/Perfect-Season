import { randomUUID } from 'node:crypto';
import type {
  DraftOrder,
  DraftPoolUnit as CoreDraftPoolUnit,
  Difficulty,
  RatingMode,
  SchemeId,
  SportId,
} from '@perfect-season/sport-engine-core';
import { createSeed } from '@perfect-season/sport-engine-core/utils';
import { NextResponse } from 'next/server';
import { toClientDraft } from './draft-client';
import type { DraftState } from './draft-store';
import { getDraftStore } from './draft-store';
import { getSportAdapter } from './sport-adapter';
import { draftBelongsTo, findActiveDraft, readGuestToken } from './session';
import { SPORT_LOCK_MESSAGE, isSportLocked } from '../sport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: 400 | 404 | 409) {
  return NextResponse.json({ error: message }, { status });
}
function isChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}
function assertSport(current: { sportId: SportId }, sportId: SportId): Response | null {
  return current.sportId === sportId
    ? null
    : errorResponse('Draft belongs to a different sport', 409);
}
function lockedDraft(draft: DraftState | null): boolean {
  return isSportLocked(
    draft === null
      ? null
      : {
          sportId: draft.sportId,
          status: draft.status,
          pickCount: Object.keys(draft.picks).length,
          simulated: draft.result !== null,
        },
  );
}

export async function createDraft(sportId: SportId, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON', 400);
  }
  if (typeof body !== 'object' || body === null)
    return errorResponse('Request body must be an object', 400);
  const input = body as Record<string, unknown>;
  const adapter = getSportAdapter(sportId);
  const guestToken = readGuestToken(request);
  const active = guestToken === null ? null : await findActiveDraft(guestToken);
  if (active !== null && active.sportId !== sportId && lockedDraft(active))
    return errorResponse(SPORT_LOCK_MESSAGE, 409);
  const ruleset = adapter.engine().getModeRuleset('core');
  const draftOrders: readonly DraftOrder[] = ruleset.draftOrders;
  const ratingModes: readonly RatingMode[] = ruleset.ratingModes;
  const schemes: readonly SchemeId[] = ruleset.schemeIds;
  const difficulties: readonly Difficulty[] = ['easy', 'normal', 'hard'];
  if (!isChoice(input.draftOrder, draftOrders)) return errorResponse('Invalid draftOrder', 400);
  if (!isChoice(input.difficulty, difficulties)) return errorResponse('Invalid difficulty', 400);
  if (!isChoice(input.ratingMode, ratingModes)) return errorResponse('Invalid ratingMode', 400);
  if (!isChoice(input.schemeId, schemes)) return errorResponse('Invalid schemeId', 400);
  const state = {
    id: randomUUID(),
    sportId,
    modeId: 'core' as const,
    draftOrder: input.draftOrder,
    difficulty: input.difficulty,
    ratingMode: input.ratingMode,
    schemeId: input.schemeId,
    status: 'in_progress' as const,
    guestToken,
    spinCount: 0,
    rerollsRemaining: ruleset.difficultyRules[input.difficulty].rerolls,
    pendingSpin: null,
    picks: {},
    usedUnits: [],
    createdAt: new Date().toISOString(),
    result: null,
  };
  const draft = await getDraftStore().create(state);
  return NextResponse.json({ draft: toClientDraft(draft) }, { status: 201 });
}

export async function getDraft(sportId: SportId, request: Request, id: string): Promise<Response> {
  const draft = await getDraftStore().get(id);
  if (draft === undefined || !draftBelongsTo(draft, request))
    return errorResponse('Draft not found', 404);
  const wrong = assertSport(draft, sportId);
  if (wrong !== null) return wrong;
  return NextResponse.json({ draft: toClientDraft(draft) });
}

export async function abandonDraft(
  sportId: SportId,
  request: Request,
  id: string,
): Promise<Response> {
  const store = getDraftStore();
  const current = await store.get(id);
  if (current === undefined || !draftBelongsTo(current, request))
    return errorResponse('Draft not found', 404);
  const wrong = assertSport(current, sportId);
  if (wrong !== null) return wrong;
  if (current.result !== null) return errorResponse('Season already simulated', 409);
  const next = await store.update(id, { ...current, status: 'abandoned', pendingSpin: null });
  return NextResponse.json({ draft: toClientDraft(next) });
}

export async function spin(sportId: SportId, request: Request): Promise<Response> {
  const draftId = new URL(request.url).searchParams.get('draftId');
  if (!draftId) return errorResponse('draftId is required', 400);
  const store = getDraftStore();
  const current = await store.get(draftId);
  if (current === undefined || !draftBelongsTo(current, request))
    return errorResponse('Draft not found', 404);
  const wrong = assertSport(current, sportId);
  if (wrong !== null) return wrong;
  if (current.status !== 'in_progress') return errorResponse('Draft is not in progress', 409);
  const reroll = new URL(request.url).searchParams.get('reroll') === '1';
  if (current.pendingSpin !== null && !reroll)
    return errorResponse('Pick or reroll the pending spin first', 409);
  if (reroll && current.pendingSpin === null)
    return errorResponse('There is no pending spin to reroll', 409);
  if (reroll && current.rerollsRemaining <= 0) return errorResponse('No rerolls remaining', 409);
  const adapter = getSportAdapter(sportId);
  const engine = adapter.engine();
  const scheme = engine.getSchemePresets().find((item) => item.id === current.schemeId);
  if (scheme === undefined) return errorResponse('Invalid draft scheme', 400);
  const openSlots = scheme.slots.filter((slot) => current.picks[slot.code] === undefined);
  if (openSlots.length === 0) return errorResponse('Draft has no open slots', 409);
  const targetSlotCode =
    current.draftOrder === 'position_first' ? (openSlots[0]?.code ?? null) : null;
  const ruleset = engine.getModeRuleset('core');
  const rerollsRemaining = reroll ? current.rerollsRemaining - 1 : current.rerollsRemaining;
  const rerollsUsed = ruleset.difficultyRules[current.difficulty].rerolls - rerollsRemaining;
  const spinSeed = createSeed(`${sportId}-spin`, current.id, current.spinCount, rerollsUsed);
  const deadUnits: CoreDraftPoolUnit[] = [...(current.deadUnits ?? [])];
  const toClientCandidates = (unit: CoreDraftPoolUnit) => {
    const candidates = adapter.buildCandidates(unit);
    return candidates
      .map((candidate) => {
        const rating = engine.computeRating(candidate, current.ratingMode);
        const eligibleSlots = openSlots.flatMap((slot) =>
          targetSlotCode !== null && slot.code !== targetSlotCode
            ? []
            : (() => {
                const eligibility = engine.validateSlotEligibility(candidate, slot);
                return eligibility.eligible
                  ? [{ slotCode: slot.code, warnings: eligibility.warnings }]
                  : [];
              })(),
        );
        return {
          playerId: candidate.playerId,
          fullName: candidate.fullName,
          primaryPosition: candidate.primaryPosition,
          headshotUrl:
            typeof candidate.traits.headshotUrl === 'string' ? candidate.traits.headshotUrl : null,
          rating: current.difficulty === 'hard' ? null : rating.overall,
          badges: Array.isArray(candidate.traits.badges)
            ? candidate.traits.badges.filter((item): item is string => typeof item === 'string')
            : undefined,
          eligibleSlots,
          positionGroup: rating.positionGroup,
        };
      })
      .filter((candidate) => candidate.eligibleSlots.length > 0)
      .sort(
        (left, right) =>
          (right.rating ?? 0) - (left.rating ?? 0) || left.fullName.localeCompare(right.fullName),
      )
      .map((candidate) => {
        const { positionGroup, ...clientCandidate } = candidate;
        void positionGroup;
        return clientCandidate;
      });
  };
  const unitExcluded = [...current.usedUnits, ...deadUnits];
  let unit: CoreDraftPoolUnit | null = null;
  let view: Awaited<ReturnType<typeof adapter.spinUnitView>> | null = null;
  let clientCandidates: ReturnType<typeof toClientCandidates> = [];
  for (let attempt = 0; attempt <= 100; attempt += 1) {
    const attemptSeed = attempt === 0 ? spinSeed : createSeed(spinSeed, `retry-${attempt}`);
    const resolved = await adapter.resolveSpinUnit(attemptSeed, unitExcluded);
    const attemptCandidates = toClientCandidates(resolved);
    if (attemptCandidates.length > 0) {
      unit = resolved;
      view = await adapter.spinUnitView(resolved);
      clientCandidates = attemptCandidates;
      break;
    }
    deadUnits.push(resolved);
    unitExcluded.push(resolved);
  }
  if (unit === null || view === null)
    return errorResponse('No draftable units remain for this draft', 409);
  const next = await store.update(current.id, {
    ...current,
    rerollsRemaining,
    deadUnits,
    pendingSpin: { spinSeed, unit, targetSlotCode },
  });
  return NextResponse.json({
    spin: {
      spinSeed,
      unit,
      franchise: view,
      record: view.record,
      eraTier: view.eraTier,
      targetSlotCode,
      candidates: clientCandidates,
    },
    draft: toClientDraft(next),
  });
}

export async function pick(sportId: SportId, request: Request, id: string): Promise<Response> {
  const store = getDraftStore();
  const current = await store.get(id);
  if (current === undefined || !draftBelongsTo(current, request))
    return errorResponse('Draft not found', 404);
  const wrong = assertSport(current, sportId);
  if (wrong !== null) return wrong;
  if (current.status !== 'in_progress') return errorResponse('Draft is not in progress', 409);
  if (current.pendingSpin === null) return errorResponse('There is no pending spin', 409);
  if (current.pendingSpin.unit.sportId !== current.sportId)
    return errorResponse('Draft belongs to a different sport', 409);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON', 400);
  }
  if (typeof body !== 'object' || body === null)
    return errorResponse('Request body must be an object', 400);
  const input = body as Record<string, unknown>;
  if (
    typeof input.slotCode !== 'string' ||
    typeof input.playerId !== 'string' ||
    typeof input.spinSeed !== 'string'
  )
    return errorResponse('slotCode, playerId, and spinSeed are required', 400);
  if (input.spinSeed !== current.pendingSpin.spinSeed)
    return errorResponse('Spin seed does not match the pending spin', 409);
  const adapter = getSportAdapter(sportId);
  const engine = adapter.engine();
  const scheme = engine.getSchemePresets().find((item) => item.id === current.schemeId);
  if (scheme === undefined) return errorResponse('Invalid draft scheme', 400);
  const slot = scheme.slots.find((item) => item.code === input.slotCode);
  if (slot === undefined) return errorResponse('Unknown roster slot', 400);
  if (current.picks[slot.code] !== undefined)
    return errorResponse('Roster slot is already filled', 409);
  if (current.draftOrder === 'position_first' && current.pendingSpin.targetSlotCode !== slot.code)
    return errorResponse('Position-first draft requires the target slot', 400);
  const candidate = adapter
    .buildCandidates(current.pendingSpin.unit)
    .find((item) => item.playerId === input.playerId);
  if (candidate === undefined) return errorResponse('Player is not in the pending spin pool', 400);
  const eligibility = engine.validateSlotEligibility(candidate, slot);
  if (!eligibility.eligible) return errorResponse(eligibility.reason, 400);
  const rating = engine.computeRating(candidate, current.ratingMode);
  const badges = Array.isArray(candidate.traits.badges)
    ? candidate.traits.badges.filter((item): item is string => typeof item === 'string')
    : [];
  const storedPick = {
    slotCode: slot.code,
    playerId: candidate.playerId,
    fullName: candidate.fullName,
    primaryPosition: candidate.primaryPosition,
    headshotUrl:
      typeof candidate.traits.headshotUrl === 'string' ? candidate.traits.headshotUrl : null,
    unit: current.pendingSpin.unit,
    spinSeed: current.pendingSpin.spinSeed,
    rating,
    ...(badges.length > 0 ? { badges } : {}),
  };
  const picks = { ...current.picks, [slot.code]: storedPick };
  const usedUnits = [...current.usedUnits, current.pendingSpin.unit];
  const status =
    Object.keys(picks).length === scheme.slots.length
      ? ('complete' as const)
      : ('in_progress' as const);
  const next = await store.update(id, {
    ...current,
    status,
    spinCount: current.spinCount + 1,
    pendingSpin: null,
    picks,
    usedUnits,
  });
  return NextResponse.json({ draft: toClientDraft(next), warnings: eligibility.warnings });
}

export async function simulate(sportId: SportId, request: Request, id: string): Promise<Response> {
  const store = getDraftStore();
  const current = await store.get(id);
  if (current === undefined || !draftBelongsTo(current, request))
    return errorResponse('Draft not found', 404);
  const wrong = assertSport(current, sportId);
  if (wrong !== null) return wrong;
  if (current.status !== 'complete') return errorResponse('Draft is not complete', 409);
  if (current.result !== null) return errorResponse('Season already simulated', 409);
  let body: unknown = {};
  if (request.headers.get('content-type')?.includes('application/json')) {
    try {
      body = await request.json();
    } catch {
      return errorResponse('Request body must be valid JSON', 400);
    }
  }
  if (typeof body !== 'object' || body === null)
    return errorResponse('Request body must be an object', 400);
  const input = body as Record<string, unknown>;
  if (input.fullGauntlet !== undefined && typeof input.fullGauntlet !== 'boolean')
    return errorResponse('fullGauntlet must be a boolean', 400);
  if (input.fullCampaign !== undefined && typeof input.fullCampaign !== 'boolean')
    return errorResponse('fullCampaign must be a boolean', 400);
  const seed = input.seed;
  if (seed !== undefined && typeof seed !== 'string')
    return errorResponse('seed must be a string', 400);
  if (typeof seed === 'string' && process.env.PERFECT_SEASON_ALLOW_SEED_OVERRIDE !== '1')
    return errorResponse('Seed override is disabled', 400);
  const result = await (
    await import('./simulate')
  ).simulateDraft(current, {
    fullGauntlet: input.fullGauntlet === true,
    fullCampaign: input.fullCampaign === true,
    seed: typeof seed === 'string' ? seed : null,
  });
  const next = await store.update(id, { ...current, result });
  const { persistCompletedResult } = await import('./leaderboard');
  void persistCompletedResult(next, result);
  return NextResponse.json({ draft: toClientDraft(next), result }, { status: 201 });
}

export async function result(sportId: SportId, request: Request, id: string): Promise<Response> {
  const draft = await getDraftStore().get(id);
  if (draft === undefined || !draftBelongsTo(draft, request))
    return errorResponse('Draft not found', 404);
  const wrong = assertSport(draft, sportId);
  if (wrong !== null) return wrong;
  if (draft.result === null) return errorResponse('Season not simulated yet', 404);
  return NextResponse.json({ draft: toClientDraft(draft), result: draft.result });
}
