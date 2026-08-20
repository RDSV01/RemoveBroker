import type { BrokerCategory, RequestStatus } from './types';

/** Libelles français et couleurs sémantiques, définis une seule fois. */

export const STATUS_LABELS: Record<RequestStatus, string> = {
  queued: 'En attente',
  in_progress: 'En cours',
  sent: 'Envoyée',
  awaiting_reply: 'Réponse attendue',
  action_required: 'Action requise',
  confirmed: 'Confirmée',
  completed: 'Supprimée',
  rejected: 'Refusée',
  no_data: 'Aucune donnée',
  unreachable: 'Injoignable',
  failed: 'Échec',
  skipped: 'Ignorée',
};

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

export const STATUS_TONES: Record<RequestStatus, Tone> = {
  queued: 'neutral',
  in_progress: 'info',
  sent: 'info',
  awaiting_reply: 'info',
  action_required: 'warn',
  confirmed: 'accent',
  completed: 'ok',
  rejected: 'danger',
  no_data: 'ok',
  // Ni succès ni échec de l'utilisateur: c'est la société qui ne publie rien.
  unreachable: 'neutral',
  failed: 'danger',
  skipped: 'neutral',
};

export const CATEGORY_LABELS: Record<BrokerCategory, string> = {
  'people-search': 'Recherche de personnes',
  'phone-directory': 'Annuaire téléphonique',
  'background-check': 'Enquête et antécédents',
  b2b: 'Prospection B2B',
  'business-search': 'Données d\'entreprise',
  marketing: 'Marketing et publicité',
  location: 'Localisation et publicité mobile',
  'credit-risk': 'Crédit et risque',
  health: 'Santé',
  other: 'Autre',
};

/**
 * Sens attribué à une réponse de courtier.
 *
 * L'interface affichait la clé technique telle quelle: « form_required »,
 * « no_data ». Ces mots ne veulent rien dire pour la personne qui lit sa propre
 * correspondance, alors que c'est exactement ce qu'elle a besoin de vérifier.
 */
export const CLASSIFICATION_LABELS: Record<string, string> = {
  success: 'Suppression confirmée',
  no_data: 'Aucune donnée détenue',
  rejected: 'Demande refusée',
  bounced: 'Adresse invalide',
  confirmation_required: 'Confirmation à donner',
  form_required: 'Formulaire obligatoire',
  id_required: "Pièce d'identité demandée",
  address_changed: 'Adresse hors service',
  pending: 'Accusé de réception',
  unknown: 'Sens indéterminé',
};

export const METHOD_LABELS: Record<string, string> = {
  email: 'Email',
  recipe: 'Formulaire automatisé',
  form: 'Formulaire manuel',
  manual: 'Manuel',
};

export const REGION_LABELS: Record<string, string> = {
  fr: 'France',
  eu: 'Union européenne',
  uk: 'Royaume-Uni',
  intl: 'International',
  us: 'Société américaine soumise au RGPD',
};

export function formatDate(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Les demandes sont étalées dans le temps: une date peut donc être à venir.
 * Afficher "il y a 2 h" pour un envoi prévu dans deux heures induit en erreur,
 * d'où les deux formulations.
 */
export function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const say = (value: string) => (future ? `dans ${value}` : `il y a ${value}`);

  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return say(`${minutes} min`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return say(`${hours} h`);
  const days = Math.round(hours / 24);
  if (days < 31) return say(`${days} j`);
  return formatDate(iso);
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm ?? `${singular}s` : singular}`;
}
