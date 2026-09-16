import { createRequire as importedCreateRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextResponse } from 'next/server';
import React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getDraftStore } from '../../../../../../lib/server/draft-store';
import { getNflTrophyDefinitions } from '@perfect-season/sport-engine-nfl';
import { fetchImageDataUri } from '../../../../../../lib/server/og-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const builtinModule = (
  process as NodeJS.Process & {
    getBuiltinModule?: (name: string) => typeof import('node:module') | undefined;
  }
).getBuiltinModule?.('module');
const createRequire = builtinModule?.createRequire ?? importedCreateRequire;
// Anchor resolution at the app's cwd: the bundled import.meta.url points at the build machine.
const packageRequire = createRequire(resolve(process.cwd(), 'package.json'));
const boldFontPath = '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff';
const bodyFontPath = '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff';
const resolvePackage = packageRequire.resolve.bind(packageRequire);
let fontsPromise: Promise<
  readonly [
    { readonly name: 'Barlow Condensed'; readonly data: Buffer },
    { readonly name: 'Barlow Condensed'; readonly data: Buffer },
  ]
> | null = null;

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

async function getFonts(): Promise<
  readonly [
    { readonly name: 'Barlow Condensed'; readonly data: Buffer },
    { readonly name: 'Barlow Condensed'; readonly data: Buffer },
  ]
> {
  if (fontsPromise === null) {
    fontsPromise = Promise.all([
      readFile(resolvePackage(boldFontPath)),
      readFile(resolvePackage(bodyFontPath)),
    ]).then(([bold, body]) => [
      { name: 'Barlow Condensed', data: bold },
      { name: 'Barlow Condensed', data: body },
    ]);
  }
  return fontsPromise;
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const draft = await getDraftStore().get(context.params.id);
  if (draft === undefined) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (draft.result === null) {
    return NextResponse.json({ error: 'Season not simulated yet' }, { status: 404 });
  }
  const { season, trophies, mvp, fullGauntlet } = draft.result;
  const trophyNames = new Map(
    getNflTrophyDefinitions().map((definition) => [definition.code, definition.name]),
  );
  const record = `${season.record.wins}-${season.record.losses}${
    season.record.ties > 0 ? `-${season.record.ties}` : ''
  }`;
  const gauntletLabel =
    season.postseasonResult === 'won_super_bowl'
      ? 'Won the Super Bowl'
      : season.postseasonResult === 'lost_super_bowl'
        ? 'Lost the Super Bowl'
        : season.postseasonResult === 'lost_conference'
          ? 'Lost the Conference Championship'
          : season.postseasonResult === 'lost_divisional'
            ? 'Lost in the Divisional Round'
            : season.postseasonResult === 'lost_wild_card'
              ? 'Lost in the Wild Card Round'
              : 'Missed the playoffs';
  // Each playoff exit gets its own badge styling — gold for a Lombardi run.
  const exitBadge =
    season.postseasonResult === 'won_super_bowl'
      ? { label: 'SUPER BOWL CHAMPIONS', color: '#e8b93c', border: '#e8b93c' }
      : season.postseasonResult === 'lost_super_bowl'
        ? { label: 'SUPER BOWL', color: '#c8cdd2', border: '#c8cdd2' }
        : season.postseasonResult === 'lost_conference'
          ? { label: 'CONFERENCE CHAMPIONSHIP', color: '#6ea8d8', border: '#6ea8d8' }
          : season.postseasonResult === 'lost_divisional'
            ? { label: 'DIVISIONAL ROUND', color: '#6ec992', border: '#6ec992' }
            : season.postseasonResult === 'lost_wild_card'
              ? { label: 'WILD CARD', color: '#8a9a90', border: '#8a9a90' }
              : null;
  const mvpHeadshot = await fetchImageDataUri(mvp.headshotUrl);
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
      <div style={{ color: '#6ec992', display: 'flex', fontSize: 24, letterSpacing: 4 }}>
        {'PERFECT SEASON \u00b7 NFL CORE DRAFT'}
      </div>
      <div
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontFamily: 'Barlow Condensed', fontSize: 144, fontWeight: 700 }}>
            {record}
          </div>
          <div style={{ color: '#9caba1', display: 'flex', fontSize: 28 }}>
            Point differential {signed(season.pointsFor - season.pointsAgainst)}
          </div>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', gap: 18 }}>
          {mvpHeadshot !== null ? (
            // eslint-disable-next-line @next/next/no-img-element -- satori renders raw markup
            <img
              src={mvpHeadshot}
              width={96}
              height={96}
              alt=""
              style={{
                borderRadius: '50%',
                border: '3px solid #6ec992',
                objectFit: 'cover',
              }}
            />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
            <div style={{ color: '#9caba1', display: 'flex', fontSize: 22 }}>MVP</div>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>{mvp.fullName}</div>
            <div style={{ color: '#6ec992', display: 'flex', fontSize: 28 }}>
              {mvp.primaryPosition} {'\u00b7'} {mvp.rating}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 42 }}>
        {trophies.map((trophy) => (
          <div
            key={trophy.code}
            style={{
              background: '#1b241f',
              border: '1px solid #2e3b34',
              borderRadius: 999,
              color: '#d8e4da',
              display: 'flex',
              fontSize: 22,
              padding: '10px 18px',
            }}
          >
            {trophyNames.get(trophy.code) ?? trophy.code}
          </div>
        ))}
      </div>
      <div style={{ alignItems: 'center', display: 'flex', gap: 32, marginTop: 'auto' }}>
        <div style={{ color: '#6ec992', display: 'flex', fontSize: 32 }}>
          17-0 {season.record.wins === 17 && season.record.losses === 0 ? 'YES' : 'NO'}
        </div>
        {fullGauntlet ? (
          <div style={{ alignItems: 'center', display: 'flex', gap: 16 }}>
            {exitBadge !== null ? (
              <div
                style={{
                  border: `3px solid ${exitBadge.border}`,
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
            <div style={{ color: '#9caba1', display: 'flex', fontSize: 26 }}>
              {'Full Gauntlet \u00b7 '}
              {gauntletLabel}
            </div>
          </div>
        ) : null}
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
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return new Response(png as unknown as BodyInit, {
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
      'Content-Type': 'image/png',
    },
  });
}
