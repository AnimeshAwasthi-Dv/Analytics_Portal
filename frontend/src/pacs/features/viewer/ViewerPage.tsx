import { centralFetch as fetch } from "../../../central/transport";
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { PORTAL_TOKEN_KEY } from '../../lib/session';
import { isViewerSessionPath } from './viewerLinks';
import ViewerBoundary from './ViewerBoundary';

type ViewerSession = { enabled: boolean; mode?: 'quick' | 'external'; viewerUrl?: string; quickViewUrl?: string; message?: string };

const QuickViewPane = lazy(() => import('./QuickViewPane'));

function Message({ text, retry }: { text: string; retry?: () => void }) {
  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#05070a', color: '#d9e4ef', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', textAlign: 'center' }}>
    <div style={{ display: 'grid', gap: 16, maxWidth: 480 }}><p style={{ margin: 0, lineHeight: 1.7 }} role="status">{text}</p>{retry && <button onClick={retry} style={{ justifySelf: 'center', padding: '9px 18px', borderRadius: 5, background: '#213a50', border: '1px solid #476782', color: '#d9e4ef', cursor: 'pointer' }}>Try again</button>}<a href="/" style={{ color: '#7ed6ff' }}>Back to the portal</a></div>
  </main>;
}

/**
 * Target of "Open viewer in a new tab" (/viewer?session=<viewer-session endpoint>). It asks the server for
 * the viewer exactly like the in-portal pane: QuickView studies open here full-screen, everything else
 * (CT, MR, …) redirects to the external DICOM viewer, just as the old link did.
 */
export default function ViewerPage() {
  const endpoint = new URLSearchParams(window.location.search).get('session');
  const valid = isViewerSessionPath(endpoint);
  const token = localStorage.getItem(PORTAL_TOKEN_KEY) ?? '';
  const [session, setSession] = useState<ViewerSession | null>(null);
  const [error, setError] = useState('');

  const open = useCallback(async (full: boolean) => {
    if (!valid) return;
    setSession(null);
    setError('');
    try {
      const response = await fetch(full ? `${endpoint}?viewer=full` : endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await response.json() as ViewerSession;
      if (!response.ok) throw new Error(data.message || 'Unable to open this study');
      // External studies go straight to the full DICOM viewer, like the previous new-tab link.
      if (data.enabled && data.mode !== 'quick' && data.viewerUrl) { window.location.replace(data.viewerUrl); return; }
      setSession(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open this study');
    }
  }, [endpoint, token, valid]);

  useEffect(() => { void open(false); }, [open]);

  if (!valid) return <Message text="This viewer link is not valid." />;
  if (error) return <Message text={error} retry={() => void open(false)} />;
  if (session && !session.enabled) return <Message text={session.message || 'This study cannot be opened.'} retry={() => void open(false)} />;
  if (!session?.quickViewUrl) return <Message text="Opening study viewer…" />;
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#05070a' }}>
    <ViewerBoundary key={session.quickViewUrl}><Suspense fallback={<Message text="Opening study viewer…" />}>
      <QuickViewPane baseUrl={session.quickViewUrl} token={token || undefined} onOpenFull={() => void open(true)} />
    </Suspense></ViewerBoundary>
  </div>;
}
