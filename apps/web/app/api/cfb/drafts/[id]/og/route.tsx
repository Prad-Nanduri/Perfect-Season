import { createRequire as importedCreateRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextResponse } from 'next/server';
import React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getDraftStore } from '../../../../../../lib/server/draft-store';
import { getCfbTrophyDefinitions } from '@perfect-season/sport-engine-cfb';
import { resolveProgramTheme } from '../../../../../../lib/cfb-theme';
import { getCfbData } from '../../../../../../lib/server/sport-engines';
import { fetchImageDataUri } from '../../../../../../lib/server/og-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const builtinModule = (
  process as NodeJS.Process & {
    getBuiltinModule?: (name: string) => typeof import('node:module') | undefined;
  }
).getBuiltinModule?.('module');
const createRequire = builtinModule?.createRequire ?? importedCreateRequire;
const packageRequire = createRequire(resolve(process.cwd(), 'package.json'));
const boldPath = '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff';
const bodyPath = '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff';
const resolvePackage = packageRequire.resolve.bind(packageRequire);
let fonts: Promise<
  readonly [{ name: 'Barlow Condensed'; data: Buffer }, { name: 'Barlow Condensed'; data: Buffer }]
> | null = null;
function getFonts() {
  fonts ??= Promise.all([
    readFile(resolvePackage(boldPath)),
    readFile(resolvePackage(bodyPath)),
  ]).then(([bold, body]) => [
    { name: 'Barlow Condensed', data: bold },
    { name: 'Barlow Condensed', data: body },
  ]);
  return fonts;
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const draft = await getDraftStore().get(context.params.id);
  if (draft === undefined) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (draft.sportId !== 'cfb')
    return NextResponse.json({ error: 'Draft belongs to a different sport' }, { status: 409 });
  if (draft.result === null)
    return NextResponse.json({ error: 'Season not simulated yet' }, { status: 404 });
  const { season, trophies, mvp } = draft.result;
  const unit = Object.values(draft.picks)[0]?.unit;
  const team =
    unit?.sportId === 'cfb'
      ? getCfbData().teams.find((item) => item.cfbdTeamId === Number(unit.programId))
      : undefined;
  const theme = resolveProgramTheme({
    color: team?.color ?? null,
    alternateColor: team?.alternateColor ?? null,
    abbreviation: team?.abbreviation ?? '',
  });
  const record = `${season.record.wins}-${season.record.losses}`;
  const trophyNames = new Map(getCfbTrophyDefinitions().map((item) => [item.code, item.name]));
  const fullCampaign = season.facts.fullCampaign === true;
  // Deepest bowl played, for the badge + footer line.
  const bowlName =
    season.stages
      .flatMap((stage) => stage.games)
      .map((game) => game.facts.bowlName)
      .filter((name): name is string => typeof name === 'string')
      .at(-1) ?? null;
  const outcomeLabel =
    season.postseasonResult === 'national_champion'
      ? 'National Champions'
      : season.postseasonResult === 'cfp_runner_up'
        ? 'National runners-up'
        : season.postseasonResult === 'cfp_semifinal'
          ? 'CFP Semifinal exit'
          : season.postseasonResult === 'cfp_quarterfinal'
            ? 'CFP Quarterfinal exit'
            : season.postseasonResult === 'cfp_first_round'
              ? 'CFP First Round exit'
              : season.postseasonResult === 'bowl_won'
                ? `Won the ${bowlName ?? 'bowl'}`
                : season.postseasonResult === 'bowl_lost'
                  ? `Lost the ${bowlName ?? 'bowl'}`
                  : null;
  const exitBadge =
    season.postseasonResult === 'national_champion'
      ? { label: 'NATIONAL CHAMPIONS', color: '#e8b93c' }
      : season.postseasonResult === 'cfp_runner_up'
        ? { label: 'NATIONAL CHAMPIONSHIP', color: '#c8cdd2' }
        : season.postseasonResult === 'cfp_semifinal'
          ? { label: 'CFP SEMIFINAL', color: '#6ea8d8' }
          : season.postseasonResult === 'cfp_quarterfinal'
            ? { label: 'CFP QUARTERFINAL', color: '#6ec992' }
            : season.postseasonResult === 'cfp_first_round'
              ? { label: 'CFP FIRST ROUND', color: '#8a9a90' }
              : bowlName !== null
                ? { label: bowlName.toUpperCase(), color: theme.secondary }
                : null;
  const [mvpHeadshot, programLogo] = await Promise.all([
    fetchImageDataUri(mvp.headshotUrl),
    fetchImageDataUri(team?.logoUrl ?? null),
  ]);
  const element = (
    <div
      style={{
        background: '#0b0f0d',
        color: '#e8ede8',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '64px',
        width: '100%',
        fontFamily: 'Barlow Condensed',
      }}
    >
      <div
        style={{
          background: theme.primary,
          display: 'flex',
          height: 12,
          marginBottom: 28,
          width: '100%',
        }}
      />
      <div
        style={{
          borderBottom: `3px solid ${theme.primary}`,
          color: '#e8ede8',
          display: 'flex',
          fontSize: 24,
          letterSpacing: 4,
          paddingBottom: 8,
        }}
      >
        PERFECT SEASON · CFB CORE DRAFT
      </div>
      <div style={{ display: 'flex', fontSize: 144, fontWeight: 700, marginTop: 24 }}>{record}</div>
      <div style={{ color: '#9caba1', display: 'flex', fontSize: 28 }}>
        Points {season.pointsFor}–{season.pointsAgainst}
      </div>
      <div
        style={{
          alignItems: 'center',
          color: '#e8ede8',
          display: 'flex',
          fontSize: 32,
          gap: 14,
          marginTop: 32,
        }}
      >
        {programLogo !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori renders raw markup
          <img src={programLogo} width={44} height={44} alt="" style={{ objectFit: 'contain' }} />
        ) : (
          <div
            style={{
              background: theme.primary,
              borderRadius: 999,
              display: 'flex',
              height: 16,
              width: 16,
            }}
          />
        )}
        {team?.school ?? 'Program'} · MVP · {mvp.fullName}
        {mvpHeadshot !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori renders raw markup
          <img
            src={mvpHeadshot}
            width={56}
            height={56}
            alt=""
            style={{
              borderRadius: '50%',
              border: `2px solid ${theme.secondary}`,
              objectFit: 'cover',
            }}
          />
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
        {trophies.map((trophy) => (
          <div
            key={trophy.code}
            style={{
              border: `2px solid ${theme.secondary}`,
              borderRadius: 999,
              display: 'flex',
              fontSize: 22,
              padding: '10px 18px',
            }}
          >
            {trophyNames.get(trophy.code) ?? trophy.code}
          </div>
        ))}
      </div>
      <div style={{ alignItems: 'center', display: 'flex', gap: 20, marginTop: 'auto' }}>
        {exitBadge !== null ? (
          <div
            style={{
              border: `3px solid ${exitBadge.color}`,
              borderRadius: 12,
              color: exitBadge.color,
              display: 'flex',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 2,
              padding: '8px 16px',
            }}
          >
            {exitBadge.label}
          </div>
        ) : null}
        <div style={{ color: '#9caba1', display: 'flex', fontSize: 24 }}>
          {fullCampaign
            ? `Full Campaign${season.facts.conferenceChampion === true ? ' · Conference champions' : ''}${season.facts.cfpSeed !== null && season.facts.cfpSeed !== undefined ? ` · CFP seed ${season.facts.cfpSeed}` : ''}${outcomeLabel !== null ? ` · ${outcomeLabel}` : ''}`
            : 'Quick Season · 12 games'}
        </div>
      </div>
    </div>
  );
  const [boldFont, bodyFont] = await getFonts();
  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: boldFont.name, data: boldFont.data, style: 'normal', weight: 700 },
      { name: bodyFont.name, data: bodyFont.data, style: 'normal', weight: 600 },
    ],
  });
  return new Response(
    new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
      .render()
      .asPng() as unknown as BodyInit,
    {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600', 'Content-Type': 'image/png' },
    },
  );
}
