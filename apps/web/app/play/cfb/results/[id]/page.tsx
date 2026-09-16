import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CfbSeasonResults } from '../../../../../components/draft/cfb-season-results';
import { toClientDraft } from '../../../../../lib/server/draft-client';
import { getDraftStore } from '../../../../../lib/server/draft-store';
import { getCfbTrophyDefinitions } from '@perfect-season/sport-engine-cfb';
import { labelCfbResult } from '../../../../../lib/cfb-game-labels';
import { getCfbData } from '../../../../../lib/server/sport-engines';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'CFB season results' };

export default async function CfbResultsPage({ params }: { params: { id: string } }) {
  const state = await getDraftStore().get(params.id);
  if (state?.sportId !== 'cfb' || state.result === null || state === undefined) notFound();
  const trophyInfo = Object.fromEntries(
    getCfbTrophyDefinitions().map((definition) => [
      definition.code,
      { name: definition.name, description: definition.description },
    ]),
  );
  return (
    <CfbSeasonResults
      draft={toClientDraft(state)}
      result={labelCfbResult(state.result, getCfbData().teams)}
      trophyInfo={trophyInfo}
    />
  );
}
