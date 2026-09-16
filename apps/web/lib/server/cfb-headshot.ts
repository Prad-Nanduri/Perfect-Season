import { getCfbData } from './sport-engines';

interface EspnSearchResult {
  readonly displayName?: string;
  readonly description?: string;
  readonly subtitle?: string;
  readonly image?: { readonly default?: string };
}

interface EspnSearchResponse {
  readonly results?: readonly {
    readonly type?: string;
    readonly contents?: readonly EspnSearchResult[];
  }[];
}

const cache = new Map<string, Promise<string | null>>();

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function schoolMatches(subtitle: string | undefined, school: string | null): boolean {
  if (subtitle === undefined || school === null) return false;
  const needle = normalize(subtitle);
  // School names like 'Arizona State' vs subtitles like 'Arizona State Sun Devils'.
  return school
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .some((word) => needle.includes(normalize(word)));
}

/**
 * Resolve a CFB player's headshot via ESPN's public search API.
 * CFBD player ids don't map to ESPN athlete ids, so match on exact display
 * name among NCAAF results, preferring the entry whose subtitle mentions the
 * player's school. Returns null on any failure — headshots are best-effort.
 */
export async function resolveCfbHeadshot(input: {
  readonly fullName: string;
  readonly programId: string;
}): Promise<string | null> {
  const key = `${normalize(input.fullName)}|${input.programId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const promise = (async () => {
    const school =
      getCfbData().teams.find((team) => team.cfbdTeamId === Number(input.programId))?.school ??
      null;
    const url = `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(
      input.fullName,
    )}&limit=10`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const body = (await response.json()) as EspnSearchResponse;
      const players = (body.results ?? [])
        .filter((group) => group.type === 'player')
        .flatMap((group) => group.contents ?? [])
        .filter(
          (entry) =>
            entry.description === 'NCAAF' &&
            entry.displayName !== undefined &&
            normalize(entry.displayName) === normalize(input.fullName),
        );
      if (players.length === 0) return null;
      const match =
        players.find((entry) => schoolMatches(entry.subtitle, school)) ?? players[0] ?? null;
      const image = match?.image?.default;
      return typeof image === 'string' && image.length > 0 ? image : null;
    } catch {
      return null;
    }
  })();
  cache.set(key, promise);
  return promise;
}
