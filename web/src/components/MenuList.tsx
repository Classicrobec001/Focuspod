/**
 * MenuList — the windowed list that every menu screen renders into.
 *
 * The LCD shows only a handful of rows, so the list scrolls by moving a window
 * over the items rather than by scrolling the DOM: the selected row is kept
 * inside the window and the window shifts only when the cursor would leave it.
 * That reproduces the device's behaviour, where the highlight moves and the
 * list jumps a page at a time.
 */

import { useEffect, useRef, useState } from 'react';
import { useTap } from './TapContext';

export interface MenuItem {
  key: string;
  label: string;
  /** Right-aligned secondary text: duration, chapter count, status. */
  meta?: string;
  /** Show the ">" affordance for rows that push a new screen. */
  arrow?: boolean;
  /**
   * A colour dot before the label. Used by the theme picker, where the row has
   * to show a palette that is not the one currently applied — so the colour
   * cannot come from a custom property and is passed in instead.
   */
  accent?: string;
}

interface MenuListProps {
  items: MenuItem[];
  cursor: number;
  emptyMessage?: string;
}

export default function MenuList({ items, cursor, emptyMessage = 'Nothing here' }: MenuListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(6);
  const [windowStart, setWindowStart] = useState(0);

  // Row height comes from a clamp() in CSS, so the number of rows that fit
  // depends on the viewport. Measure it rather than hard-coding.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rowHeight = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--row-height'),
      );
      if (rowHeight > 0) {
        setVisibleCount(Math.max(1, Math.floor(el.clientHeight / rowHeight)));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Shift the window only when the cursor would fall outside it.
  useEffect(() => {
    setWindowStart(prev => {
      if (cursor < prev) return cursor;
      if (cursor >= prev + visibleCount) return cursor - visibleCount + 1;
      const maxStart = Math.max(0, items.length - visibleCount);
      return Math.min(prev, maxStart);
    });
  }, [cursor, visibleCount, items.length]);

  const visible = items.slice(windowStart, windowStart + visibleCount);
  const { enabled: tapEnabled, onPick } = useTap();

  return (
    // Always exposed as a listbox, tappable or not: the click wheel is
    // aria-hidden, so this is the only thing a screen reader can navigate.
    <div className="menu" ref={containerRef} role="listbox" aria-label="Menu">
      {items.length === 0 ? (
        <div className="panel__center">
          <span className="panel__subtitle">{emptyMessage}</span>
        </div>
      ) : (
        visible.map((item, i) => {
          const index = windowStart + i;
          const selected = index === cursor;
          return (
            <div
              key={item.key}
              className={`menu__row${selected ? ' menu__row--selected' : ''}${
                tapEnabled ? ' menu__row--tappable' : ''
              }`}
              role="option"
              aria-selected={selected}
              aria-current={selected ? 'true' : undefined}
              tabIndex={tapEnabled ? 0 : -1}
              onClick={tapEnabled ? () => onPick(index) : undefined}
              onKeyDown={
                tapEnabled
                  ? e => {
                      // The row is focusable when tapping is on, so it has to
                      // answer the keyboard too — otherwise a screen reader can
                      // reach a row it cannot activate.
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onPick(index);
                      }
                    }
                  : undefined
              }
            >
              {item.accent && (
                <span className="swatch" style={{ background: item.accent }} aria-hidden="true" />
              )}
              <span className="menu__label">{item.label}</span>
              {item.meta && <span className="menu__meta">{item.meta}</span>}
              {item.arrow && <span className="menu__arrow">›</span>}
            </div>
          );
        })
      )}
    </div>
  );
}
