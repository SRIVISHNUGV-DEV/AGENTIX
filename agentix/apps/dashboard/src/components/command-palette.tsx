'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { NAV_ITEMS } from './sidebar';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
}

/**
 * Cmd+K command palette: filters the sidebar pages by label/id and navigates on selection.
 * @param open - Whether the palette is shown; closing also clears the query.
 * @param onClose - Called on backdrop click, Escape, or Cmd/Ctrl+K while open.
 * @param onNavigate - Called with the selected page id (the palette then closes itself).
 * @returns null when closed; otherwise the modal overlay with a focused search input and the filtered page list (or a "No results" state).
 * Maps to: component Sidebar (NAV_ITEMS is the searchable list); Maps to: internal — DashboardInner (which owns the open state).
 * Side effects: focuses the input 50ms after opening; listens for window keydown.
 */
export function CommandPalette({ open, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [open]);

  /**
   * Global key handler for the palette: Cmd/Ctrl+K closes it when open, Escape closes it when open.
   * Opening is owned by DashboardInner, not by this handler.
   * @returns void.
   * Maps to: internal — CommandPalette.
   * Side effects: calls onClose() (and preventDefault on Cmd/Ctrl+K).
   */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (open) onClose();
    }
    if (e.key === 'Escape' && open) {
      onClose();
    }
  }, [open, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const filtered = query
    ? NAV_ITEMS.filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.id.toLowerCase().includes(query.toLowerCase())
      )
    : NAV_ITEMS;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-[hsl(var(--overlay))]" />
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-up">
          <div className="flex items-center gap-3 px-4 border-b border-border">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-muted-foreground flex-shrink-0">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pages, actions..."
              className="flex-1 py-3.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <kbd>ESC</kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-2 space-y-0.5">
            {filtered.map(item => (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs hover:bg-accent transition-colors"
              >
                <item.icon className="w-4 h-4 text-muted-foreground" />
                <span>{item.label}</span>
                {item.group && <span className="ml-auto text-[9px] text-muted-foreground/30 uppercase tracking-wider">{item.group}</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground/50">No results for &ldquo;{query}&rdquo;</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
