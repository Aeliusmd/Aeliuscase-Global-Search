'use client';

import { useState } from 'react';
import { type Conversation } from '@/mocks/chatData';

interface SidebarProps {
  activeId: string;
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onClose: () => void;
}

interface ConvItemProps {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}

function ConvItem({ conv, active, onClick }: ConvItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 group cursor-pointer whitespace-nowrap relative ${
        active
          ? 'text-white'
          : 'text-white/70 hover:text-white'
      }`}
      style={
        active
          ? {
              background: 'linear-gradient(135deg, rgba(103,99,172,0.35) 0%, rgba(61,192,236,0.20) 100%)',
              boxShadow: '0 0 0 1px rgba(61,192,236,0.25), 0 2px 12px rgba(61,192,236,0.10)',
            }
          : hovered
          ? { background: 'rgba(255,255,255,0.08)' }
          : {}
      }
    >
      {/* Active left-accent bar */}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
          style={{ background: 'linear-gradient(to bottom, #3DC0EC, #6763AC)' }}
        />
      )}

      <div className="flex items-center gap-2.5 min-w-0 pl-1">
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          <i
            className={`ri-chat-3-line text-sm transition-colors ${
              active ? 'text-accent-300' : 'text-white/40 group-hover:text-white/70'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium truncate leading-tight ${active ? 'text-white' : ''}`}>
            {conv.title}
          </p>
          {(active || hovered) && (
            <p className="text-xs text-white/40 truncate mt-0.5">{conv.timestamp}</p>
          )}
        </div>
        {active && (
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: '#3DC0EC', boxShadow: '0 0 6px rgba(61,192,236,0.7)' }}
          />
        )}
      </div>
    </button>
  );
}

export default function Sidebar({
  activeId,
  conversations,
  onSelect,
  onNewChat,
  isOpen,
  onClose,
}: SidebarProps) {
  const pinned = conversations.filter((c) => c.pinned);
  const recent = conversations.filter((c) => !c.pinned);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } md:relative md:inset-auto md:h-full md:translate-x-0 md:z-auto md:flex-shrink-0`}
      style={{
        background: 'linear-gradient(180deg, #1e0a3c 0%, #2B0D57 40%, #1a0730 100%)',
      }}
    >
      {/* Subtle top glow */}
      <div
        className="absolute top-0 left-0 right-0 h-32 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% -20%, rgba(61,192,236,0.12) 0%, transparent 70%)',
        }}
      />

      {/* Logo / brand */}
      <div className="relative px-4 pt-5 pb-4 flex items-center gap-2.5 justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md"
            style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
          >
            <i className="ri-sparkling-2-fill text-white text-sm" />
          </div>
          <div>
            <h1
              className="font-semibold text-sm leading-tight"
              style={{
                fontFamily: 'var(--font-heading)',
                background: 'linear-gradient(135deg, #fff 0%, #b8d4ff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Aeliuscase AI
            </h1>
            <p className="text-white/40 text-xs">Case Search</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="md:hidden w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
          aria-label="Close navigation"
        >
          <i className="ri-close-line text-white text-xl" />
        </button>
      </div>

      {/* New conversation button */}
      <div className="relative px-3 pb-4">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 hover:opacity-90 hover:shadow-md cursor-pointer whitespace-nowrap"
          style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-add-line text-base" />
          </div>
          New Search
        </button>
      </div>

      <div className="mx-4 border-t border-white/10 mb-3" />

      {/* Conversation list */}
      <div className="relative flex-1 overflow-y-auto px-2 space-y-4">
        {pinned.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-2 mb-1.5">
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-bookmark-fill text-accent-400 text-xs" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
                Bookmarked
              </span>
            </div>
            <div className="space-y-0.5">
              {pinned.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeId === conv.id}
                  onClick={() => onSelect(conv.id)}
                />
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-2 mb-1.5">
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-time-line text-white/30 text-xs" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
                Recent Searches
              </span>
            </div>
            <div className="space-y-0.5">
              {recent.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeId === conv.id}
                  onClick={() => onSelect(conv.id)}
                />
              ))}
            </div>
          </div>
        )}

        {conversations.length === 0 && (
          <div className="px-3 py-10 text-center">
            <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center opacity-20"
              style={{ background: 'linear-gradient(135deg, #6763AC, #3DC0EC)' }}
            >
              <i className="ri-chat-3-line text-white text-lg" />
            </div>
            <p className="text-xs text-white/30">No recent searches</p>
            <p className="text-xs text-white/20 mt-1">Start a new search above</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="relative px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/8 transition-colors cursor-pointer group">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
          >
            <i className="ri-user-line text-sm" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">Aeliuscase</p>
            <p className="text-xs text-white/40 truncate">Legal AI Search</p>
          </div>
          <div className="w-5 h-5 flex items-center justify-center">
            <i className="ri-settings-3-line text-white/30 group-hover:text-white/60 text-sm transition-colors" />
          </div>
        </div>
      </div>
    </aside>
  );
}
