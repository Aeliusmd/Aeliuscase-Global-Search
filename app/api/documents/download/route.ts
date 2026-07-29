import { getRequestAuth } from '@/lib/auth/request';

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
 * Registered in middleware.ts's matcher like every other authenticated
 * route — it resolves X-Session-Id into the standard x-aelius-* identity
 * headers, which getRequestAuth() reads here exactly like app/api/chat does.
 *
 * The document link itself carries ONLY docId/docCategory, no session id —
 * live bug fixed 2026-07-29: an earlier version embedded the sessionId IN
 * the link's query string, which is only valid for that session's ~1h
 * lifetime, so a link opened even a day later (completely normal for chat
 * history) 401'd even with a perfectly valid CURRENT session. Auth now
 * happens at CLICK TIME instead: MessageBubble.tsx intercepts the click and
 * fetches this route with the browser's CURRENT live X-Session-Id header —
 * the same pattern CaseResultList.tsx already uses for pagination — so the
 * link never goes stale.
 *
 * docId/docCategory map to the raw document row's `id`/`origin` fields (see
 * lib/caseFullDetail.ts's buildDownloadUrl doc comment for how those were
 * confirmed live, including the origin=1 id-vs-docId gotcha).
 */
export async function GET(req: Request): Promise<Response> {
  const auth = getRequestAuth(req);
  if (!auth) {
    return Response.json({ error: 'Authentication required or session expired.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const docId = searchParams.get('docId');
  const docCategory = searchParams.get('docCategory');
  if (!docId || !/^\d+$/.test(docId) || !docCategory || !/^\d+$/.test(docCategory)) {
    return Response.json({ error: 'Missing or invalid docId/docCategory.' }, { status: 400 });
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
        headers: { Authorization: `Bearer ${auth.token}`, Accept: '*/*' },
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
