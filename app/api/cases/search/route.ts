import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const jwtToken = process.env.JWT_TOKEN;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!jwtToken || !apiBaseUrl) {
    return NextResponse.json(
      {
        succeeded: false,
        message:
          'Server configuration error: JWT_TOKEN or API_BASE_URL is not set. Update .env.local and restart the server.',
        data: null,
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);

  const upstream = new URL(`${apiBaseUrl}/api/Case/Search`);
  upstream.searchParams.set('searchText', searchParams.get('searchText') ?? '');
  upstream.searchParams.set('searchType', searchParams.get('searchType') ?? '1');
  upstream.searchParams.set('page', searchParams.get('page') ?? '1');
  upstream.searchParams.set('pageSize', searchParams.get('pageSize') ?? '20');

  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const data: unknown = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      {
        succeeded: false,
        message: 'Failed to reach the CaseController API. Check API_BASE_URL in .env.local.',
        data: null,
      },
      { status: 502 }
    );
  }
}
