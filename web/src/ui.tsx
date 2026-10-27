import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Marked } from 'marked';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type TaskStatus } from './api';

// ---------- routing (hash based, no dependency) ----------

export type Route =
  | { name: 'projects' }
  | { name: 'today' }
  | { name: 'weekly' }
  | { name: 'area'; area: string }
  | { name: 'ideas' }
  | { name: 'inbox' }
  | { name: 'settings' }
  | { name: 'project'; id: string; taskId?: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'project' && parts[1]) return { name: 'project', id: parts[1], taskId: parts[2] === 'task' ? parts[3] : undefined };
  if (parts[0] === 'area' && parts[1]) return { name: 'area', area: decodeURIComponent(parts[1]) };
  if (parts[0] === 'projects' || parts[0] === 'today' || parts[0] === 'weekly' || parts[0] === 'ideas' || parts[0] === 'inbox' || parts[0] === 'settings') return { name: parts[0] };
  // The app opens on Today.
  return { name: 'today' };
}

export function href(r: Route): string {
  if (r.name === 'project') return `#/project/${r.id}${r.taskId ? `/task/${r.taskId}` : ''}`;
  if (r.name === 'area') return `#/area/${encodeURIComponent(r.area)}`;
  return `#/${r.name}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (r: Route) => {
  window.location.hash = href(r);
};

// ---------- formatting ----------

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  on_hold: 'On hold',
};

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d.length === 10 ? d + 'T12:00:00' : d);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(d: string | null | undefined): string {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDateTime(d);
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  if (m === 0) return '0m';
  const h = Math.floor(Math.abs(m) / 60);
  const rem = Math.abs(m) % 60;
  const sign = m < 0 ? '-' : '';
  if (h > 0 && rem > 0) return `${sign}${h}h ${rem}m`;
  if (h > 0) return `${sign}${h}h`;
  return `${sign}${rem}m`;
}

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (typeof v === 'string' && v in STATUS_LABEL) return STATUS_LABEL[v as TaskStatus];
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- small components ----------

export function StatusPill({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>
      {overdue && <span className="pill overdue">Overdue</span>}
    </span>
  );
}

export function ActorChip({ actor }: { actor: string }) {
  const label = actor === 'you' ? 'You' : actor === 'agent' ? 'Agent' : actor === 'import' ? 'Import' : 'System';
  return <span className={`chip ${actor}`}>{label}</span>;
}

export const Swatch = ({ color, size = 12 }: { color: string; size?: number }) => (
  <span className="swatch" style={{ background: color, width: size, height: size }} />
);

export function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="progress">
      <div style={{ width: `${percent}%`, background: color }} />
    </div>
  );
}

// Raw HTML in notes (which agents can write) is shown as text, never run; markdown images and links still work.
const md = new Marked({ breaks: true, renderer: { html: ({ text }) => escapeHtml(text) } });

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => md.parse(source, { async: false }) as string, [source]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- toasts ----------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            <span className="grow">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/**
 * Wraps a write: on success refreshes everything; on 409 says so and reloads the latest version
 * instead of silently overwriting; on other errors shows the message.
 */
export function useMutate() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string } = {}): Promise<T | undefined> => {
      try {
        const r = await fn();
        await qc.invalidateQueries();
        if (opts.success) toast({ text: opts.success, kind: 'info' });
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          toast({ text: `Not saved: ${e.message} The latest version is now shown.`, kind: 'error' });
        } else {
          toast({ text: (e as Error).message, kind: 'error' });
        }
        await qc.invalidateQueries();
        return undefined;
      }
    },
    [qc, toast],
  );
}

export function CopyPromptButton({ primary }: { primary?: boolean }) {
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['prompt'], queryFn: () => api.get<{ prompt: string; empty: boolean }>('/api/agent/prompt') });
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.prompt);
      toast({ text: 'Agent prompt copied. Paste it into Claude.', kind: 'info' });
    } catch {
      window.prompt('Copy this prompt:', data.prompt);
    }
  };
  return (
    <button className={`btn ${primary ? 'primary' : ''}`} onClick={copy} disabled={!data}>
      Copy agent prompt
    </button>
  );
}

/**
 * Text input that saves on blur (and Enter), only when the value changed.
 * It remembers the item's version from when editing started, so a save made after someone else's
 * change is sent with the old version and gets a conflict instead of silently overwriting.
 */
export function BlurInput(props: {
  value: string;
  version?: number;
  /** Return the save's promise; when it resolves to undefined (not saved) the field shows the latest value again. */
  onSave: (v: string, baseVersion?: number) => unknown;
  className?: string;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  rows?: number;
  'aria-label'?: string;
  style?: React.CSSProperties;
}) {
  const [v, setV] = useState(props.value);
  const focused = useRef(false);
  const latest = useRef(props.value);
  latest.current = props.value;
  const base = useRef<{ value: string; version?: number } | null>(null);
  useEffect(() => {
    if (!focused.current) setV(props.value);
  }, [props.value]);
  const onFocus = () => {
    focused.current = true;
    base.current = { value: props.value, version: props.version };
  };
  const commit = () => {
    focused.current = false;
    const start = base.current ?? { value: props.value, version: props.version };
    base.current = null;
    if (v === start.value) return setV(props.value);
    void Promise.resolve(props.onSave(v, start.version)).then((saved) => {
      if (saved === undefined || saved === '' || saved === false) setV(latest.current);
    });
  };
  if (props.multiline) {
    return (
      <textarea
        className={props.className ?? 'textarea'}
        value={v}
        rows={props.rows ?? 4}
        placeholder={props.placeholder}
        aria-label={props['aria-label']}
        style={props.style}
        onChange={(e) => setV(e.target.value)}
        onFocus={onFocus}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      className={props.className ?? 'input'}
      type={props.type ?? 'text'}
      value={v}
      placeholder={props.placeholder}
      aria-label={props['aria-label']}
      style={props.style}
      onChange={(e) => setV(e.target.value)}
      onFocus={onFocus}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(props.value);
          e.stopPropagation();
        }
      }}
    />
  );
}
