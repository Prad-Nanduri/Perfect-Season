'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Trophy } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { useToast } from '../ui/toast';
import { TeamLogo } from '../ui/team-logo';
import type { NflLabeledResult } from '../../lib/nfl-game-labels';
import type { ClientDraft } from './types';
import { SaveResultPrompt } from './save-result-prompt';

export type TrophyInfoMap = Readonly<
  Record<string, { readonly name: string; readonly description: string }>
>;

interface SeasonResultsProps {
  readonly draft: ClientDraft;
  readonly result: NflLabeledResult;
  readonly trophyInfo: TrophyInfoMap;
}

function recordLabel(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''}`;
}

function outcomeLabel(result: NflLabeledResult): string {
  switch (result.season.postseasonResult) {
    case 'won_super_bowl':
      return 'Won the Super Bowl';
    case 'lost_super_bowl':
      return 'Lost the Super Bowl';
    case 'lost_conference':
      return 'Lost the Conference Championship';
    case 'lost_divisional':
      return 'Lost in the Divisional Round';
    case 'lost_wild_card':
      return 'Lost in the Wild Card Round';
    default:
      return 'Missed the playoffs';
  }
}

export function SeasonResults({ draft, result, trophyInfo }: SeasonResultsProps) {
  const notify = useToast();
  const isPerfect = result.season.record.wins === 17 && result.season.record.losses === 0;
  const pointDifferential = result.season.pointsFor - result.season.pointsAgainst;
  const imageUrl = `/api/nfl/drafts/${draft.id}/og`;
  const mvpInitials = result.mvp.fullName
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  async function copyImageLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${imageUrl}`);
      notify({ title: 'Image link copied', tone: 'success' });
    } catch {
      notify({ title: 'Could not copy image link', tone: 'error' });
    }
  }
  return (
    <main id="main" className="page-container pb-section pt-8" data-sport="nfl">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-sport">NFL Core Draft · Season results</p>
          <h1 className="display-heading mt-2 text-heading">Your season record</h1>
        </div>
        <Link href="/play/nfl" className="text-link">
          Start another draft
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card elevation="raised" className="p-6 lg:col-span-2">
          <p className="eyebrow text-sport">Regular season</p>
          <p className="display-heading mt-2 text-scoreboard text-heading">
            {recordLabel(result.season.record)}
          </p>
          <p className="mt-2 text-large font-semibold text-ink">
            {isPerfect ? 'Perfect season!' : `Chasing 17-0: ${recordLabel(result.season.record)}`}
          </p>
          <p className="mt-3 text-small text-muted">
            Point differential:{' '}
            <span className="font-bold text-ink">
              {pointDifferential >= 0 ? '+' : ''}
              {pointDifferential}
            </span>
          </p>
          {result.fullGauntlet ? (
            <p className="mt-2 text-small font-semibold text-sport">
              Full Gauntlet · {outcomeLabel(result)}
            </p>
          ) : null}
        </Card>

        <SaveResultPrompt draftId={draft.id} />

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Trophy size={22} className="text-sport" aria-hidden="true" />
            <h2 className="text-large font-bold text-heading">Trophies</h2>
          </div>
          {result.trophies.length === 0 ? (
            <p className="mt-5 text-small text-muted">No trophies this season</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {result.trophies.map((trophy) => {
                const info = trophyInfo[trophy.code];
                return (
                  <li
                    key={trophy.code}
                    data-testid={`trophy-${trophy.code}`}
                    className="rounded-control border border-line bg-subtle p-3"
                  >
                    <p className="font-bold text-ink">
                      {info?.name ?? trophy.code.replaceAll('_', ' ')}
                    </p>
                    <p className="mt-1 text-caption text-muted">{info?.description ?? ''}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <p className="eyebrow text-sport">Season MVP</p>
          <div className="mt-4 flex min-w-0 items-center gap-4">
            {result.mvp.headshotUrl ? (
              <Image
                src={result.mvp.headshotUrl}
                width={64}
                height={64}
                unoptimized
                loading="lazy"
                alt=""
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sport text-xl font-bold text-canvas">
                {mvpInitials}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-title font-bold leading-tight text-heading sm:text-large">
                {result.mvp.fullName}
              </h2>
              <p className="text-small text-muted">{result.mvp.primaryPosition}</p>
            </div>
            <p className="ml-auto shrink-0 font-display text-scoreboard font-bold text-sport">
              {result.mvp.rating}
            </p>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-large font-bold text-heading">Game log</h2>
          <div className="mt-4 space-y-2">
            {result.season.stages.map((stage) => (
              <section key={stage.id} aria-labelledby={`${stage.id}-heading`}>
                <h3 id={`${stage.id}-heading`} className="eyebrow mb-2 text-muted">
                  {stage.name}
                </h3>
                <div className="space-y-1">
                  {stage.games.map((game, index) => (
                    <div
                      key={`${stage.id}-${index}`}
                      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-control border border-line px-3 py-2 text-caption"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        {game.opponentTeam !== null ? (
                          <TeamLogo team={game.opponentTeam} size="xs" />
                        ) : null}
                        <span className="truncate">{game.opponentName}</span>
                      </span>
                      <span className="text-muted">{game.site}</span>
                      <span className="font-semibold text-ink">
                        {game.pointsFor}-{game.pointsAgainst}
                      </span>
                      <span
                        className={
                          game.outcome === 'win'
                            ? 'font-bold text-success'
                            : game.outcome === 'loss'
                              ? 'font-bold text-error'
                              : 'font-bold text-muted'
                        }
                      >
                        {game.outcome.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-large font-bold text-heading">Share your season</h2>
          <div className="mt-4 overflow-hidden rounded-panel border border-line bg-subtle">
            <Image
              src={imageUrl}
              alt={`NFL season result ${recordLabel(result.season.record)}`}
              width={600}
              height={315}
              unoptimized
              className="h-auto w-full"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void copyImageLink()}>
              Copy image link
            </Button>
            <Link href="/play/nfl" className="text-link self-center">
              Start another draft
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
