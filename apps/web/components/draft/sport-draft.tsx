'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { SportId } from '@perfect-season/sport-engine-core';
import { ArrowLeft } from '@phosphor-icons/react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '../session/session-provider';
import { useToast } from '../ui/toast';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { DraftSetup } from './draft-setup';
import { SPORT_DRAFT_COPY } from './sport-copy';
import { CFB_SCHEME_PRESETS } from '@perfect-season/sport-engine-cfb/schemes';
import { SCHEME_PRESETS } from '@perfect-season/sport-engine-core';
import { nflTeams } from '../../lib/teams/nfl';
import { cfbTeams } from '../../lib/teams/cfb';
import { CandidateCard } from './candidate-card';
import { DraftBoard } from './draft-board';
import { SpinWheel } from './spin-wheel';
import type { ClientDraft, DraftSpin } from './types';
import { slotKeyboardCoordinates } from './keyboard-coordinates';
import { fetchJson } from '../../lib/api-client';

export function SportDraft({ sport }: { sport: SportId }) {
  const notify = useToast();
  const router = useRouter();
  const session = useSession();
  const { setActiveDraft, refresh: refreshSession } = session;
  const [draft, setDraftState] = useState<ClientDraft | null>(null);
  const [resuming, setResuming] = useState(true);
  const [spin, setSpin] = useState<DraftSpin | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [fullGauntlet, setFullGauntlet] = useState(false);
  const copy = SPORT_DRAFT_COPY[sport];
  const teams = sport === 'nfl' ? nflTeams : cfbTeams;
  const schemeOptions = sport === 'nfl' ? SCHEME_PRESETS : CFB_SCHEME_PRESETS;
  const resumeId =
    session.loaded && session.activeDraft?.sportId === sport ? session.activeDraft.id : null;

  function setDraft(next: ClientDraft | null) {
    setDraftState(next);
    setActiveDraft(
      next === null
        ? null
        : {
            id: next.id,
            sportId: next.sportId,
            status: next.status,
            pickCount: Object.keys(next.picks).length,
            simulated: next.result !== null,
          },
    );
  }

  // Landing on /play/<sport> means the session cookie should follow; PATCH it
  // once loaded so the header toggle and future resumes agree. Skipped while a
  // cross-sport draft is locked (§0.5).
  useEffect(() => {
    if (session.loaded && session.sport !== sport && !session.sportLocked) {
      void session.chooseSport(sport).catch(() => undefined);
    }
  }, [session, sport]);

  useEffect(() => {
    if (!session.loaded || !resuming) return;
    if (resumeId === null) {
      setResuming(false);
      return;
    }
    let cancelled = false;
    fetchJson<{ draft: ClientDraft }>(`/api/${sport}/drafts/${resumeId}`)
      .then((payload) => {
        if (!cancelled) setDraftState(payload.draft);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.loaded, resuming, resumeId]);

  async function abandonDraft(id: string) {
    setLoading(true);
    try {
      await fetchJson(`/api/${sport}/drafts/${id}/abandon`, { method: 'POST' });
      setDraft(null);
      setSpin(null);
    } catch (error) {
      notify({
        title: 'Could not abandon draft',
        description: error instanceof Error ? error.message : 'Try again',
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: slotKeyboardCoordinates }),
  );

  if (draft === null) {
    if (resuming) {
      return (
        <main id="main" className="page-container pb-section pt-8">
          <p className="text-small text-muted" aria-live="polite">
            Loading your draft room…
          </p>
        </main>
      );
    }
    return (
      <main id="main" className="page-container pb-section pt-8">
        <div className="mb-5">
          <Link href="/" className="text-link">
            <ArrowLeft size={16} aria-hidden="true" /> Back to the game
          </Link>
        </div>
        <DraftSetup sport={sport} schemeOptions={schemeOptions} onStarted={setDraft} />
      </main>
    );
  }
  const activeDraft = draft;
  const candidateName = (id: string | number) =>
    spin?.candidates.find((candidate) => candidate.playerId === String(id))?.fullName ?? 'Player';
  const announcements: Announcements = {
    onDragStart({ active }) {
      return `Picked up ${candidateName(active.id)}. Use arrow keys to move between open slots, Enter to place.`;
    },
    onDragOver({ active, over }) {
      const name = candidateName(active.id);
      return over ? `${name} over slot ${String(over.id)}` : `${name} is not over a slot`;
    },
    onDragEnd({ active, over }) {
      const name = candidateName(active.id);
      return over ? `${name} placed in ${String(over.id)}` : `${name} dropped without a slot`;
    },
    onDragCancel() {
      return 'Placement cancelled';
    },
  };

  async function requestSpin(reroll: boolean): Promise<DraftSpin> {
    setLoading(true);
    try {
      const suffix = reroll ? '&reroll=1' : '';
      const payload = await fetchJson<{ spin: DraftSpin; draft: ClientDraft }>(
        `/api/${sport}/spin?draftId=${encodeURIComponent(activeDraft.id)}${suffix}`,
      );
      setDraft(payload.draft);
      setSpin(payload.spin);
      setSelectedCandidateId(null);
      return payload.spin;
    } finally {
      setLoading(false);
    }
  }

  async function placeCandidate(candidateId: string, slotCode: string) {
    if (spin === null) return;
    setLoading(true);
    try {
      const payload = await fetchJson<{ draft: ClientDraft; warnings: string[] }>(
        `/api/${sport}/drafts/${activeDraft.id}/picks`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slotCode, playerId: candidateId, spinSeed: spin.spinSeed }),
        },
      );
      setDraft(payload.draft);
      setSpin(null);
      setSelectedCandidateId(null);
      for (const warning of payload.warnings) {
        notify({ title: 'Versatile placement', description: warning, tone: 'info' });
      }
    } catch (error) {
      notify({
        title: 'Pick unavailable',
        description: error instanceof Error ? error.message : 'Could not place player',
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const candidateId = String(event.active.id);
    setDraggingId(candidateId);
    setSelectedCandidateId(candidateId);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    if (event.over) void placeCandidate(String(event.active.id), String(event.over.id));
  }

  const draggingCandidate = spin?.candidates.find((candidate) => candidate.playerId === draggingId);
  const complete = activeDraft.status === 'complete';
  async function simulateSeason() {
    setLoading(true);
    try {
      await fetchJson(`/api/${sport}/drafts/${activeDraft.id}/simulate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sport === 'nfl' ? { fullGauntlet } : { fullCampaign: fullGauntlet }),
      });
      await refreshSession();
      router.push(`/play/${sport}/results/${activeDraft.id}`);
    } catch (error) {
      notify({
        title: 'Simulation unavailable',
        description: error instanceof Error ? error.message : 'Could not simulate season',
        tone: 'error',
      });
      setLoading(false);
    }
  }
  return (
    <main
      id="main"
      className="page-container overflow-x-hidden pb-section pt-7"
      data-sport={sport}
      style={
        sport === 'cfb' && activeDraft.theme
          ? ({
              '--program-primary': activeDraft.theme.primary,
              '--program-secondary': activeDraft.theme.secondary,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-link">
          <ArrowLeft size={16} aria-hidden="true" /> Back to the game
        </Link>
        <div className="flex items-center gap-3">
          <Badge tone="sport">{complete ? 'Draft complete' : 'Draft in progress'}</Badge>
          {!complete ? (
            <Button
              variant="ghost"
              size="small"
              disabled={loading}
              onClick={() => void abandonDraft(activeDraft.id)}
            >
              Abandon draft
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-7">
        {complete ? (
          <Card
            elevation="raised"
            className="mb-7 flex flex-wrap items-center justify-between gap-5 p-5"
          >
            <div>
              <p className="eyebrow text-sport border-b-2 border-[var(--program-primary)]">
                {copy.revealEyebrow}
              </p>
              <h1 className="display-heading mt-2 text-heading">
                Your {sport === 'nfl' ? 'season' : 'program season'} starts now.
              </h1>
              <p className="mt-2 text-small text-muted">
                {activeDraft.schemeId} · {activeDraft.ratingMode.replace('_', '-')}
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <p className="text-caption text-muted">Aggregate rating</p>
              <p className="font-display text-scoreboard font-semibold text-sport">
                {activeDraft.aggregateRating?.toFixed(1)}
              </p>
              {sport === 'cfb' && !fullGauntlet ? (
                <Badge tone="sport">Quick Season · 12 games</Badge>
              ) : null}
              <label className="flex items-center gap-2 text-caption text-muted">
                <input
                  type="checkbox"
                  checked={fullGauntlet}
                  onChange={(event) => setFullGauntlet(event.target.checked)}
                  className="h-4 w-4 accent-action"
                />
                {sport === 'nfl'
                  ? 'Full Gauntlet (playoffs)'
                  : 'Full Campaign (conference title + CFP/bowl)'}
              </label>
              <Button onClick={() => void simulateSeason()} loading={loading}>
                Simulate season
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={loading}
                onClick={() => void abandonDraft(activeDraft.id)}
              >
                Start another draft
              </Button>
            </div>
          </Card>
        ) : null}
        <DndContext
          sensors={sensors}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'Press Enter or Space to pick up a player, arrow keys to move between eligible slots, Enter to place, Escape to cancel.',
            },
          }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
            <div className="grid min-w-0 grid-cols-1 gap-5">
              <SpinWheel
                draftId={activeDraft.id}
                spin={spin}
                rerollsRemaining={activeDraft.rerollsRemaining}
                loading={loading}
                onSpin={requestSpin}
                onError={(message) =>
                  notify({ title: 'Spin unavailable', description: message, tone: 'error' })
                }
                teams={teams}
                sport={sport}
              />
              {spin ? (
                <section aria-labelledby="candidates-heading">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id="candidates-heading" className="text-small font-bold">
                      Choose your player
                    </h2>
                    <p className="text-caption text-muted">
                      Tap a player, then tap a highlighted slot.
                    </p>
                  </div>
                  <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                    {spin.candidates.map((candidate) => (
                      <CandidateCard
                        key={candidate.playerId}
                        candidate={candidate}
                        franchise={spin.franchise}
                        selected={candidate.playerId === selectedCandidateId}
                        onSelect={() => setSelectedCandidateId(candidate.playerId)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
            <DraftBoard
              draft={activeDraft}
              candidates={spin?.candidates ?? []}
              targetSlotCode={spin?.targetSlotCode ?? null}
              selectedCandidateId={selectedCandidateId}
              draggingId={draggingId}
              onPlace={placeCandidate}
            />
          </div>
          <DragOverlay>
            {draggingCandidate ? (
              <div className="rotate-2 opacity-90">
                <CandidateCard
                  candidate={draggingCandidate}
                  franchise={spin?.franchise ?? null}
                  selected
                  onSelect={() => undefined}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </main>
  );
}
