'use client';

import type { PartiesToolOutput } from '@/types/caseParties';

export default function PartyResultCard({ result }: { result: PartiesToolOutput }) {
  if (!result.success) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3">
        <p className="text-sm text-red-700">{result.error ?? 'Failed to load parties.'}</p>
      </div>
    );
  }

  const parties = result.parties ?? [];
  const partyDocs = result.partyDocs ?? [];

  return (
    <div className="bg-background-50 border border-background-200 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-background-200 flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
          style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
          aria-hidden="true"
        >
          <i className="ri-team-line text-sm" />
        </div>
        <span className="text-sm font-semibold text-foreground-800">
          Parties &mdash; {result.caseRef}
        </span>
        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-background-200 text-foreground-600 border border-background-300">
          {parties.length} {parties.length === 1 ? 'party' : 'parties'}
        </span>
      </div>

      {/* Parties section */}
      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-foreground-600">
        Parties
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background-100">
            <tr>
              {['Role', 'Company', 'Phone', 'Email'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-xs font-semibold text-foreground-600"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parties.length > 0 ? (
              parties.map((party, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100 whitespace-nowrap">
                    {party.partyTypeName}
                  </td>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100">
                    {party.company || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100 whitespace-nowrap">
                    {party.phone || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100">
                    {party.email || '—'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 text-center text-foreground-500 py-4 text-sm border-t border-background-100"
                >
                  No parties found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Documents section */}
      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-foreground-600">
        Documents
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background-100">
            <tr>
              {['Type', 'Name', 'DOI'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-xs font-semibold text-foreground-600"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partyDocs.length > 0 ? (
              partyDocs.map((doc) => (
                <tr key={doc.id}>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100 whitespace-nowrap">
                    {doc.docTypeName}
                  </td>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100">
                    {doc.name}
                  </td>
                  <td className="px-4 py-2.5 text-foreground-800 border-t border-background-100">
                    {doc.doiValue == null ? (
                      '—'
                    ) : doc.doiValue.startsWith('http') ? (
                      <a
                        href={doc.doiValue}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-700 underline break-all"
                      >
                        {doc.doiValue}
                      </a>
                    ) : (
                      doc.doiValue
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 text-center text-foreground-500 py-4 text-sm border-t border-background-100"
                >
                  No documents found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
