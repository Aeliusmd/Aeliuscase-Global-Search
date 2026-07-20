# UAT Chatbot Integration

This document is for the UAT web-app team. The UAT app creates and renews an
opaque chatbot session through HTTP. Authentication tokens are never delivered
to the iframe with `postMessage`.

## Authentication flow

1. On login, obtain the fresh, backend-signed envelope JWT.
2. Call the chatbot's `POST /api/auth/verify` endpoint.
3. Set the iframe `src` once using the returned opaque `sessionId`.
4. Before the envelope expires, call the same endpoint with the same
   `sessionId` and a fresh envelope.
5. On logout, delete the session and remove the iframe.

The renewal call updates Redis in place. Do not reload the iframe, change its
`src`, or send it a token during renewal.

```javascript
const CHAT_ORIGIN = 'https://YOUR-CHATBOT.vercel.app';
const iframe = document.getElementById('aelius-chat-frame');
let currentSessionId = null;

async function verifyEnvelope(envelope, sessionId) {
  const response = await fetch(`${CHAT_ORIGIN}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      envelope,
      ...(sessionId ? { sessionId } : {}),
    }),
  });

  if (!response.ok) throw new Error('Chatbot session verification failed');
  return response.json();
}

async function startChat(envelope) {
  const result = await verifyEnvelope(envelope);
  currentSessionId = result.sessionId;
  iframe.src =
    `${CHAT_ORIGIN}/embed?mode=compact&session=${encodeURIComponent(result.sessionId)}`;
}

async function renewChat(envelope) {
  if (!currentSessionId) return startChat(envelope);
  const result = await verifyEnvelope(envelope, currentSessionId);
  if (result.sessionId !== currentSessionId) {
    throw new Error('Unexpected chatbot session replacement');
  }
}

async function endChat() {
  if (currentSessionId) {
    await fetch(
      `${CHAT_ORIGIN}/api/auth/verify?sessionId=${encodeURIComponent(currentSessionId)}`,
      { method: 'DELETE' },
    );
  }
  currentSessionId = null;
  iframe.removeAttribute('src');
  iframe.hidden = true;
}
```

## Iframe

The UAT app owns the launcher and iframe. The session URL must be assigned only
after `startChat` succeeds.

```html
<button id="aelius-chat-btn" type="button">AI Search</button>
<iframe
  id="aelius-chat-frame"
  title="AeliusCase AI Search"
  hidden
  style="position:fixed;right:24px;bottom:90px;width:min(420px,calc(100vw - 32px));height:min(680px,calc(100vh - 114px));border:0;z-index:9998"
></iframe>
```

Do not put an AeliusCase API bearer token, envelope, user ID, or firm ID in the
iframe URL. The only credential-like URL value is the opaque, short-lived
chatbot session ID.

## CORS and deployment configuration

Every UAT origin that calls the verification endpoint or embeds the chatbot must
appear in the chatbot deployment's comma-separated `NEXT_PUBLIC_UAT_ORIGINS`
value. Origin matching is exact, including scheme and port.

Example:

```text
NEXT_PUBLIC_UAT_ORIGINS=https://uat.aeliuscase.com,https://staging.aeliuscase.com
```

The verification endpoint does not use cookies. It returns CORS headers only
for an allowed request origin.

## Error handling

- A failed login verification must leave the iframe closed.
- A failed renewal means the user must authenticate again; do not silently
  create a replacement session inside the existing iframe.
- If the iframe receives `401`, it displays
  `Session expired — please refresh the page`.
- Opening `/embed` without a session displays an AeliusCase access message.

## Security checklist

- Never log or persist the envelope, session ID, or upstream API token.
- Never send identity headers such as `x-user-id`; the chatbot derives identity
  from its Redis session.
- Use HTTPS outside local development.
- Remove the iframe and invalidate the session on logout.
- Renew proactively before the one-hour envelope expiry.
- Keep `NEXT_PUBLIC_UAT_ORIGINS` limited to exact trusted origins.
