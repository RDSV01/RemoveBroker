import type {
  AppState, Broker, Profile, Provider, RequestDetail, RequestRow, Settings,
} from './types';

/** Client HTTP minimal vers l'API locale. Aucune requête ne sort de la machine. */

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Le type de contenu n'est déclaré que s'il y a effectivement un corps:
  // annoncer du JSON sans rien envoyer fait répondre 400 au serveur, ce qui
  // cassait toutes les actions sans paramètre (relever les réponses, suspendre
  // la file, vérifier le catalogue, effacer les journaux).
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> ?? {}) };
  if (options.body != null) headers['content-type'] = 'application/json';

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // `error` vient de nos routes, `message` des erreurs internes de Fastify:
    // sans le second, l'utilisateur ne voyait qu'un « Bad request » opaque.
    throw new Error(data?.error ?? data?.message ?? `Erreur ${res.status}`);
  }
  return data as T;
}

const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) => call<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => call<T>(path, { method: 'DELETE' });

export interface TestResult {
  ok: boolean;
  error?: string;
  hint?: string;
}

export const api = {
  state: () => get<AppState>('/api/state'),
  unlock: (passphrase?: string) => post<{ ok: boolean }>('/api/unlock', { passphrase }),

  providers: (email?: string) => get<{
    providers: Provider[];
    detected: (Provider & { smtp: SmtpTarget; imap: SmtpTarget }) | null;
    suggestion: { provider: string; smtp: SmtpTarget; imap: SmtpTarget } | null;
  }>(`/api/providers${email ? `?email=${encodeURIComponent(email)}` : ''}`),

  saveProfile: (profile: Profile) => put<{ profile: Profile }>('/api/profile', profile),

  settings: () => get<Settings>('/api/settings'),
  setAutoStart: (enabled: boolean) => put<{ autoStart: boolean }>('/api/settings/auto-start', { enabled }),
  saveSettings: (section: keyof Settings, values: Record<string, unknown>) => put<Settings>(`/api/settings/${section}`, values),
  testSmtp: (values: Record<string, unknown>) => post<TestResult>('/api/settings/smtp/test', values),
  testImap: (values: Record<string, unknown>) => post<TestResult>('/api/settings/imap/test', values),
  setSecurityMode: (mode: string, passphrase?: string) => put<{ ok: boolean }>('/api/security/mode', { mode, passphrase }),
  exportKey: () => post<{ key: string }>('/api/security/key', {}),

  completeOnboarding: (startCampaign: boolean, scope: 'all' | 'recommended') =>
    post<{ ok: boolean; campaign: { id: string; total: number } | null }>('/api/onboarding/complete', { startCampaign, scope }),

  brokers: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
    return get<{ total: number; brokers: Broker[]; stats: AppState['catalog'] }>(`/api/brokers?${search}`);
  },
  broker: (id: string) => get<{ broker: Broker; requests: RequestRow[] }>(`/api/brokers/${id}`),
  addBroker: (broker: Record<string, unknown>) => post<{ broker: Broker }>('/api/brokers', broker),
  deleteBroker: (id: string) => del<{ ok: boolean }>(`/api/brokers/${id}`),
  setBrokerState: (id: string, state: { hidden?: boolean; note?: string }) => post<{ ok: boolean }>(`/api/brokers/${id}/state`, state),
  previewMail: (id: string) =>
    get<{
      to?: string;
      via: 'email' | 'recipe' | 'form' | 'discovery';
      optOutUrl?: string;
      subject: string;
      text: string;
      legalBasis: string;
    }>(`/api/brokers/${id}/preview`),

  previewCampaign: (options: Record<string, unknown>) =>
    post<{ total: number; byMethod: { email: number; recipe: number; form: number; discovery: number }; estimatedDays: number }>('/api/campaigns/preview', options),
  createCampaign: (options: Record<string, unknown>) => post<{
    id: string;
    total: number;
    skipped: number;
    skippedReasons: { alreadyOpen: number; noContact: number };
    byMethod: { email: number; recipe: number; form: number; discovery: number };
  }>('/api/campaigns', options),
  campaigns: () => get<{ campaigns: Record<string, unknown>[] }>('/api/campaigns'),

  requests: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
    return get<{ rows: RequestRow[]; total: number; stats: AppState['requests'] }>(`/api/requests?${search}`);
  },
  request: (id: string) => get<RequestDetail>(`/api/requests/${id}`),
  retryRequest: (id: string) => post<{ ok: boolean }>(`/api/requests/${id}/retry`),
  assistRequest: (id: string) => post<{
    url: string;
    filled: { champ: string; valeur: string }[];
    ignored: number;
    captcha: boolean;
    formDetected: boolean;
  }>(`/api/requests/${id}/assist`),
  resolveRequest: (id: string, status: string, note?: string) => post<{ ok: boolean }>(`/api/requests/${id}/resolve`, { status, note }),
  complaint: (id: string) => get<{ text: string; authority: { name: string; url: string } }>(`/api/requests/${id}/complaint`),

  pauseQueue: () => post<unknown>('/api/queue/pause'),
  resumeQueue: () => post<unknown>('/api/queue/resume'),
  pollInbox: () => post<{ scanned: number; matched: number }>('/api/inbox/poll'),
  updateCatalog: () => post<{ updated: boolean; total: number; added: string[]; message: string }>('/api/catalog/update'),
  sweepCatalog: () => post<{ created: number }>('/api/catalog/sweep'),

  browserStatus: () => get<{ available: boolean; source: string }>('/api/browser/status'),

  clearLogs: () => post<{ ok: boolean }>('/api/logs/clear'),
  wipe: () => post<{ ok: boolean }>('/api/wipe', { confirm: 'SUPPRIMER' }),
};

export interface SmtpTarget {
  host: string;
  port: number;
  secure: boolean;
}

/** Flux d'évènements du serveur, pour rafraîchir l'interface en direct. */
export function subscribeToEvents(handlers: {
  onChange?: () => void;
  onNotice?: (n: { level: string; message: string }) => void;
}): () => void {
  const source = new EventSource('/api/events');
  const change = () => handlers.onChange?.();
  for (const channel of ['request', 'event', 'job', 'campaign']) source.addEventListener(channel, change);
  source.addEventListener('notice', (e) => {
    try {
      handlers.onNotice?.(JSON.parse((e as MessageEvent).data));
    } catch {
      /* message illisible: ignore */
    }
  });
  return () => source.close();
}

/** Installation du navigateur, avec progression ligne par ligne. */
export function installBrowser(onLine: (line: string) => void, onDone: (error?: string) => void): void {
  fetch('/api/browser/install', { method: 'POST' })
    .then(async (res) => {
      const reader = res.body?.getReader();
      if (!reader) return onDone('flux indisponible');
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const payload = part.replace(/^data: /, '').trim();
          if (!payload) continue;
          try {
            const data = JSON.parse(payload);
            if (data.line) onLine(data.line);
            if (data.error) return onDone(data.error);
            if (data.done) return onDone();
          } catch {
            /* fragment incomplet */
          }
        }
      }
      onDone();
    })
    .catch((err) => onDone(String(err.message)));
}
