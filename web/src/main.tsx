import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './components/Sidebar';
import { AllProjects } from './screens/AllProjects';
import { AreaScreen } from './screens/Area';
import { IdeasPage, InboxPage, SettingsPage } from './screens/Other';
import { TodayPage } from './screens/Today';
import { WeeklyReviewScreen } from './screens/WeeklyReview';
import { ProjectScreen } from './screens/ProjectScreen';
import './styles.css';
import { ToastProvider, useRoute, useToast } from './ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: true, retry: 1 } },
});

/** The server says when anything changed; the UI refetches. */
function useServerEvents() {
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: number | undefined;
    const connect = () => {
      es = new EventSource('/api/events');
      es.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.type === 'folder' && e.message !== 'settings') toast({ text: e.message, kind: 'info' });
        window.clearTimeout(timer);
        timer = window.setTimeout(() => qc.invalidateQueries(), 60);
      };
      es.onerror = () => {
        es?.close();
        window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => es?.close();
  }, [qc, toast]);
}

function App() {
  const route = useRoute();
  useServerEvents();
  let screen;
  switch (route.name) {
    case 'project':
      screen = <ProjectScreen key={route.id} id={route.id} taskId={route.taskId} />;
      break;
    case 'area':
      screen = <AreaScreen key={route.area} area={route.area} />;
      break;
    case 'inbox':
      screen = <InboxPage />;
      break;
    case 'settings':
      screen = <SettingsPage />;
      break;
    case 'today':
      screen = <TodayPage />;
      break;
    case 'weekly':
      screen = <WeeklyReviewScreen />;
      break;
    case 'ideas':
      screen = <IdeasPage />;
      break;
    default:
      screen = <AllProjects />;
  }
  // On a phone the sidebar is a drawer; any navigation closes it.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [route]);
  // There the window scrolls, not .main, so a new page starts at the top (opening a task popup doesn't count).
  const page = route.name === 'project' ? `project/${route.id}` : route.name === 'area' ? `area/${route.area}` : route.name;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <header className="topbar">
        <button className="topbar-menu" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className="brand">Tracker</span>
      </header>
      <div className="scrim" onClick={() => setMenuOpen(false)} />
      <Sidebar route={route} />
      <main className="main">{screen}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <App />
    </ToastProvider>
  </QueryClientProvider>,
);
