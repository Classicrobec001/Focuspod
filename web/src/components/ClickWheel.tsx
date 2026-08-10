/**
 * ClickWheel — the physical wheel, ported from mobile/src/components/IpodWheel.tsx.
 *
 * The gesture model is unchanged:
 *   • Touch inside the centre button        → select on release
 *   • Touch on the ring, rotated ≥ 8°       → drag; onRotate fires per move,
 *                                             with a detent every 18°
 *   • Touch on the ring, released before 8° → tap, zone taken from the angle
 *                                             at press time (MENU top, ▶▶ right,
 *                                             ▶/❙❙ bottom, ◀◀ left)
 *
 * What changed is the input plumbing. React Native's touch responder system is
 * replaced by Pointer Events with setPointerCapture, which keeps delivering
 * moves after the finger leaves the element — the browser equivalent of the
 * responder lock. `touch-action: none` in CSS is load-bearing: without it the
 * browser treats the drag as a scroll and stops sending pointermove entirely.
 *
 * The RN version's Android elevation workaround is gone; in the DOM the centre
 * button is simply `pointer-events: none` and the wheel handles every event.
 */

import { useCallback, useRef, useState } from 'react';
import { webHaptics } from '../ports';

const DRAG_THRESHOLD = 8; // degrees before a press is treated as a rotation
const DETENT_STEP = 18; // degrees between clicks
const CENTER_FRACTION = 0.32; // matches .wheel__center width in index.css
const CENTER_TOLERANCE = 1.1; // slightly generous centre hit area, as on device

export interface ClickWheelProps {
  onSelect?: () => void;
  onMenu?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  /** Rotation delta in degrees: positive clockwise. */
  onRotate?: (degrees: number) => void;
  disabled?: boolean;
}

/**
 * Wheel glyphs as inline SVG rather than characters.
 *
 * ▶▶, ◀◀ and ❙❙ carry emoji presentation by default, so Android renders them
 * through the colour emoji font — the labels come out blue-green and cartoonish
 * while iOS draws them as plain glyphs. Text-presentation selectors (U+FE0E)
 * are honoured inconsistently across Android versions. Drawing the shapes
 * ourselves makes them identical everywhere and lets them inherit the wheel's
 * ink colour.
 */
function TransportIcon({ kind }: { kind: 'next' | 'prev' | 'playpause' }) {
  const common = {
    height: '1em',
    fill: 'currentColor',
    'aria-hidden': true as const,
    focusable: 'false' as const,
  };
  if (kind === 'playpause') {
    return (
      <svg {...common} viewBox="0 0 30 12" width="2.5em">
        <path d="M1 1 L10 6 L1 11 Z" />
        <rect x="17" y="1" width="3" height="10" rx="0.6" />
        <rect x="23" y="1" width="3" height="10" rx="0.6" />
      </svg>
    );
  }
  const next = kind === 'next';
  return (
    <svg {...common} viewBox="0 0 22 12" width="1.9em">
      {next ? (
        <>
          <path d="M1 1 L10 6 L1 11 Z" />
          <path d="M11 1 L20 6 L11 11 Z" />
        </>
      ) : (
        <>
          <path d="M11 1 L2 6 L11 11 Z" />
          <path d="M21 1 L12 6 L21 11 Z" />
        </>
      )}
    </svg>
  );
}

/** Degrees 0–360 with 0° at 12 o'clock, increasing clockwise. */
function angleDeg(dx: number, dy: number): number {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  if (deg >= 360) deg -= 360;
  return deg;
}

/** True when deg falls in [start, end), wrapping through 0 when needed. */
function inZone(deg: number, start: number, end: number): boolean {
  return start < end ? deg >= start && deg < end : deg >= start || deg < end;
}

interface Gesture {
  pointerId: number;
  startAngle: number;
  lastAngle: number;
  totalRotation: number;
  accumulatedSinceDetent: number;
  isCenter: boolean;
  isDragging: boolean;
}

export default function ClickWheel({
  onSelect,
  onMenu,
  onNext,
  onPrevious,
  onPlayPause,
  onRotate,
  disabled = false,
}: ClickWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [pressed, setPressed] = useState(false);

  const geometry = useCallback(() => {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      radius: rect.width / 2,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const geo = geometry();
      if (!geo) return;

      const dx = e.clientX - geo.cx;
      const dy = e.clientY - geo.cy;
      const distance = Math.hypot(dx, dy);

      // Ignore presses in the corners of the bounding box, outside the circle.
      if (distance > geo.radius) return;

      const centerRadius = geo.radius * CENTER_FRACTION * CENTER_TOLERANCE;
      const angle = angleDeg(dx, dy);

      gesture.current = {
        pointerId: e.pointerId,
        startAngle: angle,
        lastAngle: angle,
        totalRotation: 0,
        accumulatedSinceDetent: 0,
        isCenter: distance <= centerRadius,
        isDragging: false,
      };

      setPressed(gesture.current.isCenter);
      // Keeps moves coming even if the finger slides off the wheel.
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [disabled, geometry],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId || g.isCenter) return;

      const geo = geometry();
      if (!geo) return;

      const angle = angleDeg(e.clientX - geo.cx, e.clientY - geo.cy);

      // Shortest signed arc between samples, so crossing 0°/360° doesn't
      // register as a near-full-circle jump.
      let delta = angle - g.lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;

      g.lastAngle = angle;
      g.totalRotation += delta;
      g.accumulatedSinceDetent += delta;

      if (!g.isDragging && Math.abs(g.totalRotation) >= DRAG_THRESHOLD) {
        g.isDragging = true;
      }
      if (!g.isDragging) return;

      // Emit one discrete detent per DETENT_STEP degrees rather than a
      // continuous stream, so a slow drag moves the cursor exactly one row.
      while (Math.abs(g.accumulatedSinceDetent) >= DETENT_STEP) {
        const direction = g.accumulatedSinceDetent > 0 ? 1 : -1;
        g.accumulatedSinceDetent -= direction * DETENT_STEP;
        webHaptics.tick();
        onRotate?.(direction * DETENT_STEP);
      }
    },
    [geometry, onRotate],
  );

  const endGesture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      gesture.current = null;
      setPressed(false);
      if (!g || g.pointerId !== e.pointerId) return;

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      if (g.isCenter) {
        webHaptics.select();
        onSelect?.();
        return;
      }
      // A drag consumed the press; no button fires.
      if (g.isDragging) return;

      webHaptics.select();
      const a = g.startAngle;
      if (inZone(a, 315, 45)) onMenu?.();
      else if (inZone(a, 45, 135)) onNext?.();
      else if (inZone(a, 135, 225)) onPlayPause?.();
      else onPrevious?.();
    },
    [onSelect, onMenu, onNext, onPlayPause, onPrevious],
  );

  const handlePointerCancel = useCallback(() => {
    gesture.current = null;
    setPressed(false);
  }, []);

  return (
    <div className="wheel-area">
      <div
        ref={wheelRef}
        className={`wheel${pressed ? ' wheel--pressed' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={handlePointerCancel}
        // The wheel is driven by the keyboard handler in useKeyboardControls;
        // this element is decorative to assistive tech, with the LCD carrying
        // the live state.
        aria-hidden="true"
      >
        <span className="wheel__label wheel__label--menu">MENU</span>
        <span className="wheel__label wheel__label--next">
          <TransportIcon kind="next" />
        </span>
        <span className="wheel__label wheel__label--prev">
          <TransportIcon kind="prev" />
        </span>
        <span className="wheel__label wheel__label--playpause">
          <TransportIcon kind="playpause" />
        </span>
        <div className="wheel__center" />
      </div>
    </div>
  );
}
