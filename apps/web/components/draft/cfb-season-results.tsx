'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Trophy } from '@phosphor-icons/react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import type { CSSProperties } from 'react';
import type { CfbLabeledGame, CfbLabeledResult } from '../../lib/cfb-game-labels';
import { cfbOpponentStrength } from '../../lib/cfb-game-labels';
import type { ClientDraft } from './types';
import type { TrophyInfoMap } from './season-results';
import { SaveResultPrompt } from './save-result-prompt';

function recordLabel(record: { wins: number; losses: number; ties: number }) {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

function gameDetail(game: CfbLabeledGame): string | null {
  const bowl = typeof game.facts.bowlName === 'string' ? game.facts.bowlName : null;
  const round = typeof game.facts.roundLabel === 'string' ? game.facts.roundLabel : null;
  const parts = [bowl, round].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function postseasonSummary(result: CfbLabeledResult): {
  conferenceTitle: string;
  postseason: string;
} {
  const titleGame = result.season.stages.find((stage) => stage.id === 'conference_championship');
  const conferenceTitle =
    result.season.facts.conferenceChampion === true
      ? 'Champions'
      : titleGame !== undefined
        ? 'Runner-up'
        : 'Did not qualify';
  const bowlName =
    result.season.stages
      .flatMap((stage) => stage.games)
      .map((game) => game.facts.bowlName)
      .filter((name): name is string => typeof name === 'string')
      .at(-1) ?? null;
  const postseason =
    result.season.postseasonResult === 'national_champion'
      ? 'National Champions'
      : result.season.postseasonResult === 'cfp_runner_up'
        ? 'Lost the National Championship'
        : result.season.postseasonResult === 'cfp_semifinal'
          ? `Lost in the CFP Semifinal${bowlName !== null ? ` (${bowlName})` : ''}`
          : result.season.postseasonResult === 'cfp_quarterfinal'
            ? `Lost in the CFP Quarterfinal${bowlName !== null ? ` (${bowlName})` : ''}`
            : result.season.postseasonResult === 'cfp_first_round'
              ? 'Lost in the CFP First Round'
              : result.season.postseasonResult === 'bowl_won'
                ? `Won the ${bowlName ?? 'bowl'}`
                : result.season.postseasonResult === 'bowl_lost'
                  ? `Lost the ${bowlName ?? 'bowl'}`
                  : 'No postseason';
  return { conferenceTitle, postseason };
}

export function CfbSeasonResults({
  draft,
  result,
  trophyInfo,
}: {
  draft: ClientDraft;
  result: CfbLabeledResult;
  trophyInfo: TrophyInfoMap;
}) {
  const notify = useToast();
  const imageUrl = `/api/cfb/drafts/${draft.id}/og`;
  const fullCampaign = result.season.facts.fullCampaign === true;
  const path = postseasonSummary(result);
  const mvpInitials = result.mvp.fullName
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const undefeated =
    result.season.record.wins === 12 &&
    result.season.record.losses === 0 &&
    result.season.record.ties === 0;
  async function copyImageLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${imageUrl}`);
      notify({ title: 'Image link copied', tone: 'success' });
    } catch {
      notify({ title: 'Could not copy image link', tone: 'error' });
    }
  }
  return (
    <main
      id="main"
      className="page-container pb-section pt-8"
      data-sport="cfb"
      style={
        (draft.theme
          ? {
              '--program-primary': draft.theme.primary,
              '--program-secondary': draft.theme.secondary,
            }
          : undefined) as CSSProperties | undefined
      }
    >
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow border-b-2 border-[var(--program-primary)] text-sport">
            CFB Core Draft · Season results
          </p>
          <h1 className="display-heading mt-2 text-heading">Your program season</h1>
        </div>
        <Link href="/play/cfb" className="text-link">
          Start another draft
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card elevation="raised" className="p-6 lg:col-span-2">
          <p className="eyebrow text-sport">
            {fullCampaign ? 'Full Campaign' : 'Quick Season · 12 games'}
          </p>
          <p className="display-heading mt-2 text-scoreboard text-heading">
            {recordLabel(result.season.record)}
          </p>
          <p className="mt-2 text-large font-semibold text-ink">
            {undefeated ? 'Undefeated & Untied' : 'Season complete'}
          </p>
          <p className="mt-3 text-small text-muted">
            Points for/against:{' '}
            <span className="font-bold text-ink">
              {result.season.pointsFor} / {result.season.pointsAgainst}
            </span>
          </p>
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
          <h2 className="text-large font-bold text-heading">Season path</h2>
          <dl className="mt-4 space-y-2 text-small">
            <div className="flex justify-between border-b border-line py-2">
              <dt>Conference championship</dt>
              <dd className="font-semibold">
                {fullCampaign ? path.conferenceTitle : 'N/A (Quick Season)'}
              </dd>
            </div>
            <div className="flex justify-between border-b border-line py-2">
              <dt>CFP / bowl</dt>
              <dd className="font-semibold">
                {fullCampaign ? path.postseason : 'N/A (Quick Season)'}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt>Ranking movement</dt>
              <dd className="font-semibold">N/A (ranking system not built yet)</dd>
            </div>
          </dl>
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
                      key={`${game.opponentId}-${index}`}
                      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-control border border-line px-3 py-2 text-caption"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {game.opponentLogoUrl !== null ? (
                          <Image
                            src={game.opponentLogoUrl}
                            width={24}
                            height={24}
                            unoptimized
                            loading="lazy"
                            alt=""
                            className="h-6 w-6 shrink-0 object-contain"
                          />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block truncate">{game.opponentName}</span>
                          {gameDetail(game) !== null ? (
                            <span className="text-micro text-muted">{gameDetail(game)}</span>
                          ) : cfbOpponentStrength(game) !== null ? (
                            <span className="text-micro text-muted">
                              opp. strength {cfbOpponentStrength(game)}
                            </span>
                          ) : null}
                        </span>
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
          <Image
            src={imageUrl}
            alt={`CFB season result ${recordLabel(result.season.record)}`}
            width={600}
            height={315}
            unoptimized
            className="mt-4 h-auto w-full rounded-panel border border-line"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void copyImageLink()}>
              Copy image link
            </Button>
            <Link href="/play/cfb" className="text-link self-center">
              Start another draft
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
