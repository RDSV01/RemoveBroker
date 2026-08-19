import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Shield } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, Divider, Field, Input } from '../components/ui';

/** Écran de déverrouillage, affiche uniquement en mode phrase secrète. */

export function Unlock() {
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.unlock(passphrase);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="animate-in w-full max-w-sm overflow-hidden">
        <div className="flex flex-col items-center px-6 pb-5 pt-7 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent)] text-white">
            <Shield size={21} />
          </span>
          <h1 className="mt-3 text-[1.15rem] font-semibold tracking-tight">RemoveBroker</h1>
          <p className="mt-1 text-[0.87rem] text-[var(--color-ink-soft)]">
            Vos donnees sont protegees par une phrase secrete.
          </p>
        </div>
        <Divider />
        <form onSubmit={submit} className="px-6 py-5">
          <Field label="Phrase secrète" error={error}>
            <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoFocus autoComplete="current-password" />
          </Field>
          <Button type="submit" variant="primary" className="mt-4 w-full" loading={loading} icon={<Lock size={15} />}>
            Deverrouiller
          </Button>
        </form>
      </Card>
    </div>
  );
}
