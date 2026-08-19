/** Types partages entre le serveur et l'interface (copies dans apps/web/src/lib/types.ts). */

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
  videoUrl?: string;
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
  /**
   * Le courtier traite-t-il des données de personnes résidant en Europe ?
   * Un site américain de recherche de personnes indexe des dossiers publics
   * américains: pour un résident français, la demande n'aboutira souvent à rien.
   */
  /** Société française: priorité du projet, et réponse en français. */
  france?: boolean;
  euRelevant?: boolean;
  /** Autres marques exploitées par la même société, utiles à la recherche. */
  aliases?: string[];
  /** Ajouté par l'utilisateur depuis l'interface, absent du catalogue public. */
  custom?: boolean;
}

export interface RecipeField {
  selector: string;
  value: string;
  optional?: boolean;
}

export interface Recipe {
  id: string;
  domain: string;
  name: string;
  kind: 'direct-form' | 'search-form';
  captcha?: 'none' | 'recaptcha' | 'hcaptcha' | 'turnstile' | 'unknown';
  timeoutMs?: number;
  search?: { url: string; listingPattern?: string };
  form: {
    url: string;
    fields: RecipeField[];
    submit: string;
    success?: { urlContains?: string[]; text?: string[] };
  };
  confirmByEmail?: boolean;
  expectedSender?: string;
}

export interface Catalog {
  brokers: Broker[];
  recipes: Recipe[];
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
   * Identifiants publicitaires du téléphone: IDFA sur iOS, AAID sur Android.
   * Facultatifs, mais ce sont les seules clés exploitables chez un courtier de
   * localisation, dont les bases n'indexent ni le nom ni l'adresse.
   */
  advertisingIds?: string[];
  /** Détermine le fondement juridique invoqué dans les demandes. */
  jurisdiction: 'eu' | 'uk' | 'other';
  language: 'fr' | 'en';
}

export type RequestStatus =
  | 'queued'
  | 'in_progress'
  | 'sent'
  | 'awaiting_reply'
  | 'action_required'
  | 'confirmed'
  | 'completed'
  | 'rejected'
  | 'no_data'
  | 'failed'
  | 'skipped';

export type RequestMethod = 'email' | 'recipe' | 'form';

export interface RequestRow {
  id: string;
  campaign_id: string | null;
  broker_id: string;
  broker_name: string;
  method: RequestMethod;
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

export interface SmtpSettings {
  preset: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  verified?: boolean;
}

export interface ImapSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  verified?: boolean;
}

export interface AutomationSettings {
  emailEnabled: boolean;
  webEnabled: boolean;
  /** Nombre maximum d'envois par jour: rester sous les limites des fournisseurs. */
  dailyEmailLimit: number;
  concurrency: number;
  /** Ouvre automatiquement les liens de confirmation reçus par email. */
  autoConfirmLinks: boolean;
  /** Soumet les formulaires sans intervention, quand rien ne bloque. */
  autoSubmitForms: boolean;
  captchaProvider: 'none' | '2captcha' | 'capsolver';
  captchaKey: string;
}

export interface ScheduleSettings {
  enabled: boolean;
  /** Relance automatique des nouveaux brokers tous les N jours. */
  sweepEveryDays: number;
  /** Délai avant relance quand un broker ne répond pas. */
  followUpAfterDays: number;
  /** Délai avant proposition de plainte a l'autorité de contrôle. */
  escalateAfterDays: number;
}

export interface PrivacySettings {
  keepEmailCopies: boolean;
  catalogAutoUpdate: boolean;
  catalogUrl: string;
  minimalLogs: boolean;
}

export interface OnboardingState {
  completed: boolean;
  step: number;
}
