import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, subscribeToEvents } from './lib/api';
import { Layout } from './components/Layout';
import { Spinner, useToast } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Brokers } from './pages/Brokers';
import { Requests } from './pages/Requests';
import { SettingsPage } from './pages/Settings';
import { Onboarding } from './pages/Onboarding';
import { Unlock } from './pages/Unlock';

export function App() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: state, isLoading } = useQuery({ queryKey: ['state'], queryFn: api.state, refetchInterval: 30_000 });

  // Le serveur pousse ses changements: l'interface reste juste sans sondage.
  useEffect(() => {
    return subscribeToEvents({
      onChange: () => {
        void queryClient.invalidateQueries({ queryKey: ['state'] });
        void queryClient.invalidateQueries({ queryKey: ['requests'] });
        void queryClient.invalidateQueries({ queryKey: ['brokers'] });
      },
      onNotice: (notice) => toast.push(notice.level === 'warn' ? 'warn' : notice.level === 'error' ? 'error' : 'info', notice.message),
    });
  }, [queryClient, toast]);

  if (isLoading || !state) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  if (state.locked) return <Unlock />;
  if (!state.onboarding?.completed) return <Onboarding state={state} />;

  return (
    <Layout state={state}>
      <Routes>
        <Route path="/" element={<Dashboard state={state} />} />
        <Route path="/courtiers" element={<Brokers state={state} />} />
        <Route path="/demandes" element={<Requests />} />
        <Route path="/demandes/:id" element={<Requests />} />
        <Route path="/parametres" element={<SettingsPage state={state} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
