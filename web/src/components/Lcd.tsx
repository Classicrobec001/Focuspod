import type { ReactNode } from 'react';

interface LcdProps {
  title: string;
  /** Rendered at the right of the title bar — playing indicator, item counts. */
  status?: ReactNode;
  children: ReactNode;
}

export default function Lcd({ title, status, children }: LcdProps) {
  return (
    <div className="lcd">
      <div className="lcd__glass">
        <div className="lcd__titlebar">
          <span className="lcd__title">{title}</span>
          {status && <span className="lcd__battery">{status}</span>}
        </div>
        {/*
          The LCD is the app's live region: the wheel is aria-hidden, so screen
          readers follow state changes here instead.
        */}
        <div className="lcd__content" role="status" aria-live="polite">
          {children}
        </div>
      </div>
    </div>
  );
}
