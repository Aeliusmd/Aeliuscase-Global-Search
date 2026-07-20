'use client';

import { useState } from 'react';
import type { UIMessage } from 'ai';
import type { CaseSearchItem, MainSearchType, SearchToolOutput } from '@/types/case';
import CaseResultList from './CaseResultList';
import type { PartiesToolOutput } from '@/types/caseParties';
import PartyResultCard from './PartyResultCard';
import type { FilterToolOutput } from '@/types/caseFilters';

interface ToolPart {
  type: string;
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | string;
  input?: { searchText?: string; searchType?: number; page?: number };
  output?: SearchToolOutput;
}

interface PartiesToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: { caseNumber?: string; caseId?: number };
  output?: PartiesToolOutput;
}

interface FilterToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: FilterToolOutput;
}

const FILTER_TOOL_TYPES = new Set([
  'tool-getByStatusId', 'tool-getBySubTypeId', 'tool-getBySubStatusId',
  'tool-getBySubStatusId2', 'tool-getByVenueId', 'tool-getBySpecialInstruction',
  'tool-getBySolDate', 'tool-getByBodyPartIds',
  'tool-getByCaseDate', 'tool-getByCaseTypeId', 'tool-getByLastNameInitial', 'tool-getByStaff',
  'tool-combinedSearch',
]);

export type OnLoadMore = (
  messageId: string,
  toolCallId: string,
  searchText: string,
  searchType: MainSearchType,
  currentPage: number,
  existingCases: CaseSearchItem[],
) => Promise<void>;

interface MessageBubbleProps {
  message: UIMessage;
  onLoadMore: OnLoadMore;
  sessionId: string;
  onSessionExpired: () => void;
}

// --- Markdown rendering helpers ---

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(
      /`([^`]+)`/g,
      '<code style="background:oklch(var(--primary-100));color:#6763AC;padding:1px 5px;border-radius:4px;font-size:0.8em;">$1</code>',
    )
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

function parseTableBlock(block: string): { headers: string[]; rows: string[][] } | null {
  const lines = block.trim().split('\n');
  if (lines.length < 3) return null;
  const sep = lines[1];
  if (!/^\|[\s\-:|]+\|$/.test(sep.trim())) return null;
  const parseRow = (line: string) =>
    line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).filter((l) => l.trim().startsWith('|')).map(parseRow);
  return { headers, rows };
}

function MarkdownTable({ block }: { block: string }) {
  const parsed = parseTableBlock(block);
  if (!parsed)
    return <pre className="text-xs text-foreground-700 whitespace-pre-wrap">{block}</pre>;
  const { headers, rows } = parsed;
  return (
    <div className="overflow-x-auto my-3 rounded-lg border border-background-200">
      <table className="chat-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseContent(content: string): Array<{ type: 'text' | 'table'; value: string }> {
  const blocks: Array<{ type: 'text' | 'table'; value: string }> = [];
  const lines = content.split('\n');
  let current: string[] = [];
  let inTable = false;

  const flushText = () => {
    if (current.length > 0) {
      blocks.push({ type: 'text', value: current.join('\n') });
      current = [];
    }
  };
  const flushTable = () => {
    if (current.length > 0) {
      blocks.push({ type: 'table', value: current.join('\n') });
      current = [];
    }
  };

  for (const line of lines) {
    const isTableLine = line.trim().startsWith('|');
    if (isTableLine && !inTable) {
      flushText();
      inTable = true;
      current.push(line);
    } else if (isTableLine && inTable) {
      current.push(line);
    } else if (!isTableLine && inTable) {
      flushTable();
      inTable = false;
      current.push(line);
    } else {
      current.push(line);
    }
  }
  if (inTable) flushTable();
  else flushText();
  return blocks;
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.trim() === '') return <div key={i} className="h-2" />;
        if (line.startsWith('**') && line.endsWith('**') && !line.slice(2, -2).includes('**')) {
          return (
            <p
              key={i}
              className="font-semibold text-foreground-900 mt-2"
              dangerouslySetInnerHTML={{ __html: renderInline(line) }}
            />
          );
        }
        if (line.trim().startsWith('- ')) {
          return (
            <div key={i} className="flex items-start gap-2 text-sm text-foreground-700">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
              <span dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^[\s-]+/, '')) }} />
            </div>
          );
        }
        return (
          <p
            key={i}
            className="text-sm text-foreground-800 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInline(line) }}
          />
        );
      })}
    </div>
  );
}

// --- Main component ---

export default function MessageBubble({
  message,
  onLoadMore,
  sessionId,
  onSessionExpired,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // User message
  if (isUser) {
    const textPart = message.parts?.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    const text = textPart?.text ?? '';

    return (
      <div className="flex items-end gap-3 justify-end group msg-animate">
        <div className="max-w-[85%] xs:max-w-[75%] sm:max-w-[70%]">
          <div
            className="px-4 py-3 rounded-2xl rounded-br-sm text-white text-sm leading-relaxed shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6763AC 0%, #4e8fbd 100%)' }}
          >
            {text}
          </div>
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mb-5 shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
        >
          <i className="ri-user-line text-sm" />
        </div>
      </div>
    );
  }

  // Assistant message — iterate parts
  const allText =
    message.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('') ?? '';

  return (
    <div className="flex items-start gap-3 group msg-animate">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-sm"
        style={{ background: 'linear-gradient(135deg, #3DC0EC 0%, #6763AC 100%)' }}
      >
        <i className="ri-sparkling-2-fill text-white text-sm" />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {message.parts?.map((rawPart, idx) => {
          // Text part
          if (rawPart.type === 'text') {
            const p = rawPart as { type: 'text'; text: string };
            if (!p.text.trim()) return null;
            const blocks = parseContent(p.text);
            return (
              <div
                key={`${message.id}-t${idx}`}
                className="bg-background-50 border border-background-200 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm"
              >
                <div className="space-y-1">
                  {blocks.map((block, bi) =>
                    block.type === 'table' ? (
                      <MarkdownTable key={bi} block={block.value} />
                    ) : (
                      <TextBlock key={bi} text={block.value} />
                    ),
                  )}
                </div>
              </div>
            );
          }

          // Tool searching indicator
          if (rawPart.type === 'tool-searchCases') {
            const part = rawPart as unknown as ToolPart;

            if (part.state === 'input-streaming' || part.state === 'input-available') {
              return (
                <div
                  key={`${message.id}-tc${idx}`}
                  className="flex items-center gap-2 text-xs py-1"
                  style={{ color: '#6763AC' }}
                >
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Searching for &ldquo;{part.input?.searchText ?? '...'}&rdquo;</span>
                </div>
              );
            }

            if (part.state === 'output-available' && part.output) {
              const result = part.output;
              if (!result.success) {
                return (
                  <div
                    key={`${message.id}-te${idx}`}
                    className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3"
                  >
                    <p className="text-sm text-red-700">{result.error ?? 'Search failed.'}</p>
                  </div>
                );
              }
              return (
                <CaseResultList
                  key={`${message.id}-tr${idx}`}
                  sessionId={sessionId}
                  onSessionExpired={onSessionExpired}
                  msgId={message.id}
                  toolCallId={part.toolCallId}
                  cases={result.cases}
                  totalRecords={result.totalRecords}
                  totalPages={result.totalPages ?? 1}
                  query={result.searchText}
                  searchType={result.searchType as MainSearchType}
                  page={result.page}
                  hasMorePages={result.hasMorePages}
                  onLoadMore={onLoadMore}
                />
              );
            }
          }

          if (rawPart.type === 'tool-getCaseParties') {
            const part = rawPart as unknown as PartiesToolPart;

            if (part.state === 'input-streaming' || part.state === 'input-available') {
              const ref = part.input?.caseNumber ?? (part.input?.caseId ? `case ${part.input.caseId}` : '...');
              return (
                <div
                  key={`${message.id}-pc${idx}`}
                  className="flex items-center gap-2 text-xs py-1"
                  style={{ color: '#6763AC' }}
                >
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Fetching parties for &ldquo;{ref}&rdquo;&hellip;</span>
                </div>
              );
            }

            if (part.state === 'output-available' && part.output) {
              return (
                <PartyResultCard
                  key={`${message.id}-pr${idx}`}
                  result={part.output}
                />
              );
            }
          }

          // Filter tools (getByStatusId, getByVenueId, getBySolDate, etc.)
          if (FILTER_TOOL_TYPES.has(rawPart.type)) {
            const part = rawPart as unknown as FilterToolPart;

            if (part.state === 'input-streaming' || part.state === 'input-available') {
              return (
                <div
                  key={`${message.id}-fc${idx}`}
                  className="flex items-center gap-2 text-xs py-1"
                  style={{ color: '#6763AC' }}
                >
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Filtering cases&hellip;</span>
                </div>
              );
            }

            if (part.state === 'output-available' && part.output) {
              const result = part.output;
              if (!result.success) return null;
              return (
                <CaseResultList
                  key={`${message.id}-fr${idx}`}
                  sessionId={sessionId}
                  onSessionExpired={onSessionExpired}
                  msgId={message.id}
                  toolCallId={part.toolCallId}
                  cases={result.cases}
                  totalRecords={result.totalRecords}
                  totalPages={result.totalPages ?? 1}
                  query={result.filterLabel}
                  searchType={1 as MainSearchType}
                  page={result.page}
                  hasMorePages={result.hasMorePages}
                  filterType={result.filterType}
                  filterValue={result.filterValue}
                  onLoadMore={onLoadMore}
                />
              );
            }
          }

          return null;
        })}

        {/* Copy / feedback actions */}
        {allText.trim() && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 mt-1">
            <button
              onClick={() => handleCopy(allText)}
              className="w-9 h-9 flex items-center justify-center rounded hover:bg-background-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              title="Copy"
              aria-label="Copy message"
            >
              <i className={`text-xs ${copied ? 'ri-check-line text-accent-500' : 'ri-file-copy-line text-secondary-400'}`} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
