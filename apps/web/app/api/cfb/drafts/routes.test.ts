import { describe, expect, it } from 'vitest';
import { POST as createDraft } from './route';
import { GET as getDraft } from './[id]/route';
import { POST as pick } from './[id]/picks/route';
import { GET as getResult } from './[id]/result/route';
import { POST as simulate } from './[id]/simulate/route';
import { GET as spin } from '../spin/route';

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function create(guestToken?: string) {
  const response = await createDraft(
    new Request('http://localhost/api/cfb/drafts', {
      method: 'POST',
      body: JSON.stringify({
        draftOrder: 'squad_first',
        difficulty: 'normal',
        ratingMode: 'career_season',
        schemeId: '4-3',
      }),
      headers: {
        'content-type': 'application/json',
        ...(guestToken ? { cookie: `ps_guest=${guestToken}` } : {}),
      },
    }),
  );
  return {
    status: response.status,
    body: await json<{ draft?: { id: string }; error?: string }>(response),
  };
}

async function completeCfbDraft(guestToken?: string) {
  const created = await create(guestToken);
  const draftId = created.body.draft?.id;
  if (!draftId) throw new Error('create failed');
  for (let index = 0; index < 24; index += 1) {
    const spinResponse = await spin(
      new Request(
        `http://localhost/api/cfb/spin?draftId=${draftId}`,
        guestToken ? { headers: { cookie: `ps_guest=${guestToken}` } } : {},
      ),
    );
    if (spinResponse.status !== 200)
      throw new Error(`spin failed: ${spinResponse.status} ${await spinResponse.text()}`);
    const spinPayload = await json<{
      spin: {
        spinSeed: string;
        candidates: readonly { playerId: string; eligibleSlots: readonly { slotCode: string }[] }[];
      };
    }>(spinResponse);
    const candidate = spinPayload.spin.candidates[0];
    const slot = candidate?.eligibleSlots[0];
    const pickResponse = await pick(
      new Request(`http://localhost/api/cfb/drafts/${draftId}/picks`, {
        method: 'POST',
        body: JSON.stringify({
          slotCode: slot?.slotCode,
          playerId: candidate?.playerId,
          spinSeed: spinPayload.spin.spinSeed,
        }),
        headers: {
          'content-type': 'application/json',
          ...(guestToken ? { cookie: `ps_guest=${guestToken}` } : {}),
        },
      }),
      { params: { id: draftId } },
    );
    if (pickResponse.status !== 200)
      throw new Error(`pick failed: ${pickResponse.status} ${await pickResponse.text()}`);
  }
  return draftId;
}

describe('CFB draft routes', () => {
  it('runs a complete 24-pick CFB flow through the real engine', async () => {
    const draftId = await completeCfbDraft();
    const completed = await json<{ draft: { status: string; usedUnits: readonly unknown[] } }>(
      await getDraft(new Request(`http://localhost/api/cfb/drafts/${draftId}`), {
        params: { id: draftId },
      }),
    );
    expect(completed.draft.status).toBe('complete');
    expect(completed.draft.usedUnits).toHaveLength(24);
  });

  it(
    'accepts Full Campaign requests and simulates the postseason',
    { timeout: 30_000 },
    async () => {
      const draftId = await completeCfbDraft();
      const response = await simulate(
        new Request(`http://localhost/api/cfb/drafts/${draftId}/simulate`, {
          method: 'POST',
          body: JSON.stringify({ fullCampaign: true }),
          headers: { 'content-type': 'application/json' },
        }),
        { params: { id: draftId } },
      );
      expect(response.status).toBe(201);
      const payload = await json<{
        result: {
          season: {
            stages: readonly { id: string }[];
            postseasonResult: string | null;
            facts: { fullCampaign?: boolean };
          };
        };
      }>(response);
      expect(payload.result.season.facts.fullCampaign).toBe(true);
      expect(payload.result.season.stages.length).toBeGreaterThan(1);
      expect(payload.result.season.postseasonResult).not.toBeNull();
    },
  );

  it(
    'simulates a 12-game Quick Season with one stage, no ties, and null postseason',
    { timeout: 30_000 },
    async () => {
      const draftId = await completeCfbDraft();
      const response = await simulate(
        new Request(`http://localhost/api/cfb/drafts/${draftId}/simulate`, {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'content-type': 'application/json' },
        }),
        { params: { id: draftId } },
      );
      expect(response.status).toBe(201);
      const payload = await json<{
        result: {
          season: {
            record: { wins: number; losses: number; ties: number };
            stages: readonly { games: readonly unknown[] }[];
            postseasonResult: string | null;
          };
        };
      }>(response);
      expect(payload.result.season.stages).toHaveLength(1);
      expect(payload.result.season.stages[0]?.games).toHaveLength(12);
      expect(payload.result.season.record.ties).toBe(0);
      expect(payload.result.season.record.wins + payload.result.season.record.losses).toBe(12);
      expect(payload.result.season.postseasonResult).toBeNull();
      const resultResponse = await getResult(
        new Request(`http://localhost/api/cfb/drafts/${draftId}/result`),
        { params: { id: draftId } },
      );
      expect(resultResponse.status).toBe(200);
    },
  );
});
