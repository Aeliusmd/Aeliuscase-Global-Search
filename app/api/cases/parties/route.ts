import { NextRequest, NextResponse } from 'next/server';
import { fetchCaseParties } from '@/lib/caseParties';
import { getRequestAuth } from '@/lib/auth/request';
import { collectCaseNumbers, recordAudit } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const auth = getRequestAuth(request);
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!auth) {
    return NextResponse.json(
      { succeeded: false, message: 'Authentication required.', data: null },
      { status: 401 },
    );
  }
  if (!apiBaseUrl) {
    return NextResponse.json(
      {
        succeeded: false,
        message: 'Server configuration error: API_BASE_URL is not set.',
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
    jwtToken: auth.token,
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

  recordAudit({
    userId: auth.userId,
    query: caseNumber ?? (caseId !== undefined ? `caseId:${caseId}` : ''),
    accessedCaseNumbers: caseNumber ? [caseNumber] : collectCaseNumbers(result),
    toolCalled: 'cases.parties.pagination',
    ip: auth.ip,
  });

  return NextResponse.json(
    {
      succeeded: true,
      data: result,
      message: 'OK',
    },
    { status: 200 },
  );
}
