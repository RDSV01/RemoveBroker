/** Types partages avec le serveur (apps/server/src/types.ts). */

export type BrokerCategory =
  | 'people-search' | 'phone-directory' | 'background-check' | 'b2b'
  | 'business-search' | 'marketing' | 'location' | 'credit-risk' | 'health' | 'other';

export type OptOutMethod = 'recipe' | 'email' | 'form' | 'manual';

export interface Broker {
  id: string;
  name: string;
  domain?: string;
  website?: string;
  category: BrokerCategory;
  regions: string[];
  email?: string;
  optOutUrl?: string;
  /** Politique de confidentialité: de la documentation, pas un formulaire. */
  privacyUrl?: string;
  guideUrl?: string;
  legalName?: string;
  description?: string;
  registeredCA?: boolean;
  sensitive?: string[];
  requiresId?: boolean;
  notes?: string;
  recipe?: string;
  sources: string[];
  firstSeen: string;
  methods: OptOutMethod[];
  score: number;
  /** Société française: priorité du projet, et réponse en français. */
  france?: boolean;
  euRelevant?: boolean;
  aliases?: string[];
  custom?: boolean;
  state?: { hidden: boolean; note?: string } | null;
  request?: { status: RequestStatus; requestId: string; updatedAt: string } | null;
}

export type RequestStatus =
  | 'queued' | 'in_progress' | 'sent' | 'awaiting_reply' | 'action_required'
  /** Aucun moyen de contact publié: rien à faire, ni pour vous ni pour l'application. */
  | 'unreachable'
  | 'confirmed' | 'completed' | 'rejected' | 'no_data' | 'failed' | 'skipped';

export interface RequestRow {
  id: string;
  campaign_id: string | null;
  broker_id: string;
  broker_name: string;
  method: 'email' | 'recipe' | 'form';
  status: RequestStatus;
  legal_basis: string | null;
  token: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  completed_at: string | null;
  deadline_at: string | null;
  next_action_at: string | null;
  message_id: string | null;
  last_error: string | null;
}

export interface PostalAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  zip: string;
  country: string;
}

export interface Profile {
  firstName: string;
  lastName: string;
  middleName?: string;
  previousNames?: string[];
  emails: string[];
  phones?: string[];
  addresses: PostalAddress[];
  dateOfBirth?: string;
  /**
   * Identifiants publicitaires du téléphone (IDFA sur iOS, AAID sur Android).
   * Facultatifs, mais ce sont les seules clés exploitables chez un courtier de
   * localisation: leurs bases n'indexent ni le nom ni l'adresse.
   */
  advertisingIds?: string[];
  jurisdiction: 'eu' | 'uk' | 'other';
  language: 'fr' | 'en';
}

export interface Settings {
  smtp: { preset: string; host: string; port: number; secure: boolean; user: string; password: string; fromName: string; fromEmail: string; verified?: boolean; hasPassword?: boolean };
  imap: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string; mailbox: string; verified?: boolean; hasPassword?: boolean };
  automation: { emailEnabled: boolean; webEnabled: boolean; dailyEmailLimit: number; concurrency: number; autoConfirmLinks: boolean; autoSubmitForms: boolean; captchaProvider: string; captchaKey: string };
  schedule: { enabled: boolean; sweepEveryDays: number; followUpAfterDays: number; escalateAfterDays: number };
  privacy: { keepEmailCopies: boolean; catalogAutoUpdate: boolean; catalogUrl: string; minimalLogs: boolean };
  /** null hors de l'application de bureau: le web ne sait pas inscrire au demarrage. */
  autoStart?: boolean | null;
  onboarding: { completed: boolean; step: number };
}

export interface AppState {
  locked: boolean;
  keyring: { mode: 'plain' | 'os' | 'passphrase'; unlocked: boolean; osAvailable: boolean };
  onboarding?: { completed: boolean; step: number };
  hasProfile?: boolean;
  profile?: Profile | null;
  settings?: Settings;
  catalog?: {
    total: number; reachable: number; needsDiscovery: number;
    withEmail: number; withRecipe: number; withForm: number;
    france: number; franceReachable: number;
    byCategory: Record<string, number>; byRegion: Record<string, number>;
    checkedAt?: string; count: number; added: string[];
    /** L'empreinte publiée a-t-elle été comparée à celle du fichier reçu ? */
    verified?: boolean;
  };
  requests?: {
    total: number; byStatus: Record<string, number>; sent: number; done: number; inFlight: number; pendingSend: number;
    actionRequired: number; unreachable: number; failed: number; rejected: number; progress: number;
  };
  queue?: { paused: boolean; inFlight: number; concurrency: number; counts: Record<string, number> };
  browser?: { available: boolean; source: string; canInstall: boolean };
  authority?: { name: string; url: string } | null;
  version?: string;
}

export interface RequestDetail {
  request: RequestRow;
  broker: Broker | null;
  events: { id: number; at: string; type: string; summary: string; detail: string | null }[];
  messages: { id: string; direction: 'in' | 'out'; at: string; subject: string; from: string; to: string; body: string; classification: string | null; confidence: number | null }[];
  artifacts: { id: number; kind: string; file: string; at: string }[];
}

export interface Provider {
  id: string;
  label: string;
  appPassword?: { required: boolean; url: string; help: string };
  note?: string;
}
