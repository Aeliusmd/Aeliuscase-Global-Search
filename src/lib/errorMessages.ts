export const ERR_JWT_EXPIRED =
  'Your session token has expired. Ask a developer to update JWT_TOKEN in .env.local and restart the server.';

export const ERR_NETWORK =
  'Could not reach the server. Check your network connection and try again.';

export const ERR_API =
  'Something went wrong with the search. Please try again.';

export const ERR_CONFIG =
  'The server is not configured correctly. Contact your administrator.';

export const emptyResultsMessage = (query: string) =>
  `No cases found for "${query}". Try a different name, case number, or keyword.`;
