import { NextRequest, NextResponse } from 'next/server';
import { fetchCaseParties } from '@/lib/caseParties';

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
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const caseNumberParam = searchParams.get('caseNumber');
  const caseIdParam = searchParams.get('caseId');

  const caseNumber = caseNumberParam ?? undefined;
  const caseId =
    caseIdParam !== null && caseIdParam !== '' ? Number(caseIdParam) : undefined;

  const result = await fetchCaseParties({
    apiBaseUrl,
    jwtToken,
    caseId,
    caseNumber,
  });

  if (!result.success) {
    return NextResponse.json(
      {
        succeeded: false,
        data: result,
        message: result.error ?? 'Request failed',
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      succeeded: true,
      data: result,
      message: 'OK',
    },
    { status: 200 },
  );
}
