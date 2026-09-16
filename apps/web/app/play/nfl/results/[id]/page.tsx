import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getNflTrophyDefinitions } from '@perfect-season/sport-engine-nfl';
import { SeasonResults } from '../../../../../components/draft/season-results';
import { toClientDraft } from '../../../../../lib/server/draft-client';
import { getDraftStore } from '../../../../../lib/server/draft-store';
import { labelNflResult } from '../../../../../lib/nfl-game-labels';

export const dynamic = 'force-dynamic';

interface ResultsPageProps {
  readonly params: { id: string };
}

export async function generateMetadata({ params }: ResultsPageProps): Promise<Metadata> {
  const state = await getDraftStore().get(params.id);
  if (state?.result === null || state === undefined) return { title: 'Season results' };
  const { wins, losses, ties } = state.result.season.record;
  const record = `${wins}-${losses}${ties > 0 ? `-${ties}` : ''}`;
  return {
    title: `${record} · Perfect Season`,
    openGraph: { images: [`/api/nfl/drafts/${params.id}/og`] },
  };
}

export default async function ResultsPage({ params }: ResultsPageProps) {
  const state = await getDraftStore().get(params.id);
  if (state?.result === null || state === undefined) notFound();
  const draft = toClientDraft(state);
  const trophyInfo = Object.fromEntries(
    getNflTrophyDefinitions().map((definition) => [
      definition.code,
      { name: definition.name, description: definition.description },
    ]),
  );
  return (
    <SeasonResults draft={draft} result={labelNflResult(state.result)} trophyInfo={trophyInfo} />
  );
}
