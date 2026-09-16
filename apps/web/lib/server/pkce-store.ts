import { createRedisClient } from '@perfect-season/db';
import type { RedisLike } from './redis-store';
import { isRedisConfigured } from './store-backend';

/**
 * PKCE code verifiers from server-initiated magic links. The Supabase client
 * that calls `signInWithOtp` generates the verifier in its own storage, which
 * is lost before the user clicks the email link — so we persist it against the
 * guest token; the callback runs in the same browser session that requested
 * the link and can retrieve it for `exchangeCodeForSession`.
 */
const VERIFIER_TTL_SECONDS = 3600;

function verifierKey(guestToken: string): string {
  return `ps:pkce-verifier:${guestToken}`;
}

interface VerifierGlobal {
  __perfectSeasonPkceVerifiers?: Map<string, { verifier: string; expiresAt: number }>;
}

const verifierGlobal = globalThis as typeof globalThis & VerifierGlobal;

function memoryStore(): Map<string, { verifier: string; expiresAt: number }> {
  verifierGlobal.__perfectSeasonPkceVerifiers ??= new Map();
  return verifierGlobal.__perfectSeasonPkceVerifiers;
}

let redisClient: RedisLike | null = null;
function redis(): RedisLike | null {
  if (!isRedisConfigured()) return null;
  redisClient ??= createRedisClient() as RedisLike;
  return redisClient;
}

export async function storePkceVerifier(guestToken: string, verifier: string): Promise<void> {
  const client = redis();
  if (client !== null) {
    await client.set(verifierKey(guestToken), verifier, { ex: VERIFIER_TTL_SECONDS });
    return;
  }
  memoryStore().set(guestToken, {
    verifier,
    expiresAt: Date.now() + VERIFIER_TTL_SECONDS * 1000,
  });
}

export async function takePkceVerifier(guestToken: string): Promise<string | null> {
  const client = redis();
  if (client !== null) {
    const key = verifierKey(guestToken);
    const verifier = await client.get<string>(key);
    if (verifier !== null) await client.del(key);
    return verifier ?? null;
  }
  const store = memoryStore();
  const entry = store.get(guestToken) ?? null;
  store.delete(guestToken);
  if (entry === null || entry.expiresAt < Date.now()) return null;
  return entry.verifier;
}
