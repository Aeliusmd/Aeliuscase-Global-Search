# API Contract — CaseController Search Endpoint
**Version:** 1.1 (CONFIRMED — extracted from CaseController API.docx)
**Date:** 2026-06-02
**Status:** Confirmed against CaseController API.docx. Open items: CORS, case detail URL path (see QUESTIONS.md API-11).

---

## Base URL

```
API_BASE_URL (server-side only, in .env.local)
UAT environment: https://uatapi.aeliuscase.com
```

> The browser never calls this URL directly. All requests go through the Next.js API Route proxy at `/api/cases/search`.

---

## Authentication

All requests to the CaseController API require a JWT Bearer token.

```
Authorization: Bearer <JWT_TOKEN>
```

- Token stored server-side in `.env.local` as `JWT_TOKEN` (no `NEXT_PUBLIC_` prefix).
- **Never sent to the browser.** Only `app/api/cases/search/route.ts` reads it.
- Token validity period: ~1 hour (manually rotated by developer/operator).
- Rotation: update `JWT_TOKEN` in `.env.local` and restart the Next.js server.
- A `401 Unauthorized` response from the CaseController is forwarded to the browser, triggering the JWT-expiry error message in the widget.

---

## Case Search Endpoint (PRIMARY — used by widget)

```
GET /api/Case/Search
```

### Request Headers

| Header | Value | Required |
|---|---|---|
| Authorization | `Bearer <JWT>` | Yes |
| Accept | `application/json` | Yes |

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `searchText` | `string` | Yes | Free-text search string (English or Sinhala) |
| `searchType` | `number` | No | Filter by case category. See `MainSearchType` enum below. Default: `1` (AllCases) |
| `page` | `number` | No | 1-based page number. Default: `1` |
| `pageSize` | `number` | No | Results per page. Default: `20` |
| `enteredUserId` | `number` | No | Filter by case creator/assignee user ID |

#### `MainSearchType` enum values

| Value | Meaning |
|---|---|
| `1` | AllCases |
| `2` | OpenCases |
| `3` | ClosedCases |
| `4` | SubOutCases |

#### Example Request

```
GET https://uatapi.aeliuscase.com/api/Case/Search?searchText=John+Smith&searchType=2&page=1&pageSize=20
Authorization: Bearer eyJhbGci...
```

---

### Success Response — 200 OK

The API wraps all responses in a `PagedResponse<T>` envelope:

```json
{
  "page": 1,
  "pageSize": 20,
  "totalPages": 3,
  "totalRecords": 42,
  "isFirstPage": true,
  "isLastPage": false,
  "hasMorePages": true,
  "status": 200,
  "succeeded": true,
  "message": null,
  "errors": null,
  "data": [
    {
      "id": 12345,
      "caseNumber": "AC-2025-00123",
      "caseName": "Smith v. ACME Corp",
      "caseType": "WCAB",
      "caseStatusDescription": "Open",
      "caseApplicant": {
        "fullName": "john smith",
        "firstName": "John",
        "lastName": "Smith"
      },
      "caseAttorneyNickName": "J. Patel",
      "caseCoordinatorNickName": "M. Lee",
      "createdDateTime": "2025-01-15T08:30:00Z"
    }
  ]
}
```

> **Important:** There is **no `caseUrl` field** in the response. The widget constructs the case detail link as:
> `${VITE_APP_BASE_URL}/cases/${item.id}`
> `VITE_APP_BASE_URL` must be added to `.env` (see API-11 in QUESTIONS.md for URL path confirmation).

---

### Error Response

All error responses use the same `PagedResponse<T>` envelope with `succeeded: false`:

```json
{
  "status": 401,
  "succeeded": false,
  "message": "JWT token has expired.",
  "errors": ["Unauthorized"],
  "data": null
}
```

| HTTP Status | Meaning | Widget Behaviour |
|---|---|---|
| `400 Bad Request` | Malformed query parameters | Display generic error message |
| `401 Unauthorized` | JWT missing, expired, or invalid | Display JWT-expiry specific message + restart hint |
| `403 Forbidden` | Insufficient permissions | Display generic error message |
| `404 Not Found` | Endpoint not found | Display generic error message |
| `500 Internal Server Error` | Backend failure | Display generic error message |

---

## TypeScript Interfaces (confirmed field names)

```typescript
// MainSearchType enum
export enum MainSearchType {
  AllCases = 1,
  OpenCases = 2,
  ClosedCases = 3,
  SubOutCases = 4,
}

// PagedResponse wrapper
export interface PagedApiResponse<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  totalRecords: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  hasMorePages: boolean;
  status: number;
  succeeded: boolean;
  message: string | null;
  errors: string[] | null;
  data: T[] | null;
}

// Case search result item
export interface CaseSearchItem {
  id: number;
  caseNumber: string;
  caseName: string;
  caseType: string;
  caseStatusDescription: string;
  caseApplicant: {
    fullName: string;
    firstName: string;
    lastName: string;
  };
  caseAttorneyNickName: string;
  caseCoordinatorNickName: string;
  createdDateTime: string;  // ISO 8601 full datetime, e.g. "2025-01-15T08:30:00Z"
}

// Search request params
export interface CaseSearchParams {
  searchText: string;
  searchType?: MainSearchType;
  page?: number;
  pageSize?: number;
  enteredUserId?: number;
}
```

---

## Case Detail URL Construction

Since `caseUrl` is not returned by the API, construct it as:

```typescript
const caseDetailUrl = `${import.meta.env.VITE_APP_BASE_URL}/cases/${item.id}`;
```

`.env` must include:
```
VITE_APP_BASE_URL=https://uataeliuscase.com   # confirm with dev team — see QUESTIONS.md API-11
```

---

## Environment Variables (.env.local)

```
JWT_TOKEN=eyJhbGci...                          # Server-side only — NEVER use NEXT_PUBLIC_ prefix
API_BASE_URL=https://uatapi.aeliuscase.com     # Server-side only
NEXT_PUBLIC_APP_BASE_URL=https://uat.aeliuscase.com   # Client-safe — for case detail link construction
```

## Next.js API Route (proxy layer)

The browser calls the local Next.js route, not the CaseController directly:

```
GET /api/cases/search?searchText=John&searchType=1&page=1&pageSize=20
```

The Next.js server then calls:
```
GET https://uatapi.aeliuscase.com/api/Case/Search?searchText=John&searchType=1&page=1&pageSize=20
Authorization: Bearer <JWT_TOKEN>
```

Source: `app/api/cases/search/route.ts`

---

## CORS Requirements

> TO BE CONFIRMED — see QUESTIONS.md INF-4

The CaseController API must allow cross-origin requests from the host Aeliuscase origin:

```
Access-Control-Allow-Origin: <Aeliuscase host origin>
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Authorization, Accept
```

---

## Open Items

See `docs/requirements/QUESTIONS.md` — specifically API-11 (case detail URL path) and INF-4 (CORS confirmation).
