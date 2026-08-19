import clsx from 'clsx';
import { NavLink, useLocation } from 'react-router-dom';
import { Building2, LayoutDashboard, Mail, Moon, Settings, Shield, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme } from '../lib/theme';
import type { AppState } from '../lib/types';

/**
 * Ossature de l'application: barre latérale sur grand écran, barre d'onglets
 * en bas sur mobile. Quatre destinations, pas une de plus: c'est ce qui rend
 * l'outil compréhensible sans documentation.
 */

const NAV = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
  { to: '/courtiers', label: 'Courtiers', icon: Building2, end: false },
  { to: '/demandes', label: 'Demandes', icon: Mail, end: false },
  { to: '/parametres', label: 'Paramètres', icon: Settings, end: false },
];

export function Layout({ state, children }: { state: AppState; children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const pending = state.requests?.actionRequired ?? 0;

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-[var(--color-line)] px-3 py-4 md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white">
            <Shield size={17} />
          </span>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">RemoveBroker</div>
            <div className="text-[0.72rem] text-[var(--color-ink-faint)]">Suppression automatique</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.9rem] transition-colors',
                  isActive
                    ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent-ink)]'
                    : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-sunk)] hover:text-[var(--color-ink)]',
                )
              }
            >
              <Icon size={17} />
              <span className="flex-1">{label}</span>
              {to === '/demandes' && pending > 0 && (
                <span className="tnum rounded-md bg-[var(--color-warn-soft)] px-1.5 text-[0.72rem] font-medium text-[var(--color-warn)]">{pending}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto px-2 pt-4">
          <button
            type="button"
            onClick={toggle}
            className="flex w-full items-center gap-2.5 rounded-lg px-0.5 py-1.5 text-[0.85rem] text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-ink)]"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          </button>
          <p className="mt-2 text-[0.72rem] text-[var(--color-ink-faint)]">
            Version {state.version ?? '1.0.0'} · tout reste sur cet ordinateur
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-[var(--color-line)] bg-[var(--color-canvas)]/95 px-4 py-3 backdrop-blur md:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white">
            <Shield size={15} />
          </span>
          <span className="font-semibold tracking-tight">RemoveBroker</span>
          <button type="button" onClick={toggle} className="btn btn-ghost ml-auto p-1.5" aria-label="Changer de theme">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        <main key={location.pathname} className="animate-fade mx-auto w-full max-w-[1180px] flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-7">
          {children}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-[var(--color-line)] bg-[var(--color-surface)] md:hidden">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx('flex flex-col items-center gap-0.5 py-2 text-[0.68rem]', isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]')
              }
            >
              <span className="relative">
                <Icon size={19} />
                {to === '/demandes' && pending > 0 && (
                  <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-[var(--color-warn)]" />
                )}
              </span>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.35rem] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[0.9rem] text-[var(--color-ink-soft)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}
