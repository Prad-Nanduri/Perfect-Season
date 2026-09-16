/**
 * Fetch a remote image and inline it as a data URI for satori/OG rendering.
 * Returns null on any failure so the image degrades gracefully.
 */
export async function fetchImageDataUri(url: string | null | undefined): Promise<string | null> {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
