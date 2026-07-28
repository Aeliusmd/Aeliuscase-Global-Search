import { getSession } from '@/lib/auth/session';

/**
 * Authenticated document-download proxy.
 *
 * Every backend endpoint (confirmed via the backend's own Swagger spec —
 * global `security: [{Oidc:[], Bearer:[]}]`, no per-endpoint override, no
 * query-string API-key alternative) requires a header-based Bearer JWT. A
 * plain browser `<a href>` click can never attach that header, so a document
 * link can't point at the backend directly — live-reproduced 2026-07-28 as a
 * 401 on both GetFilByPath and GetFirmDocFile when hit without the header.
 *
 * This route is the fix: the chat UI's document link points HERE (a same-
 * origin route the browser CAN navigate to), carrying our own opaque
 * sessionId in the query string (the same one already used as the
 * X-Session-Id header elsewhere) instead of a header. Server-side, we look
 * up the real upstream token for that session and attach it ourselves when
 * calling GetFirmDocFile, then stream the file back.
 *
 * Deliberately NOT registered in middleware.ts's matcher — that middleware
 * expects the session id as a header (fine for our own fetch() calls, not
 * for a plain link click), so this route resolves the session itself
 * instead, reading it from the query string.
 *
 * docId/docCategory map to the raw document's `docId`/`origin` fields
 * (confirmed live 2026-07-28 via the dashboard's own Preview-Document
 * network call: compositeKey "{docId}_{origin}" matched the exact
 * docId/docCategory pair that returned 200 — NOT `id` or `docCategoryId`,
 * which are different fields entirely).
 */
export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const docId = searchParams.get('docId');
  const docCategory = searchParams.get('docCategory');

  if (!sessionId) {
    return Response.json({ error: 'Missing sessionId.' }, { status: 400 });
  }
  if (!docId || !/^\d+$/.test(docId) || !docCategory || !/^\d+$/.test(docCategory)) {
    return Response.json({ error: 'Missing or invalid docId/docCategory.' }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return Response.json({ error: 'Authentication required or session expired.' }, { status: 401 });
  }

  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    return Response.json({ error: 'Server configuration error: API_BASE_URL is not set.' }, { status: 500 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiBaseUrl}/api/Filehandling/GetFirmDocFile?docId=${docId}&docCategory=${docCategory}`,
      {
        headers: { Authorization: `Bearer ${session.token}`, Accept: '*/*' },
        cache: 'no-store',
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return Response.json({ error: `Failed to reach document storage: ${message}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: `Document storage returned ${upstream.status}.` }, { status: upstream.status || 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
    },
  });
}
