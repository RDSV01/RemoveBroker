import type { Broker, Profile } from '../types.js';
import { legalBasisFor, templateVariables } from '../core/profile.js';

/**
 * Gabarits de demande de suppression.
 *
 * Un email efficace tient en trois blocs: le fondement juridique invoqué, les
 * identifiants permettant de retrouver la fiche, et le délai légal rappelé.
 * Les courtiers traitent des milliers de demandes: plus le message est court
 * et structure, plus il est traite vite.
 *
 * Le jeton de suivi (RB-xxxxxxxx) apparaît en pied de message. Il sert à relier
 * une réponse à la demande d'origine quand le courtier ne conserve pas les
 * en-têtes de discussion.
 */

export type LegalBasis = 'gdpr' | 'ukgdpr' | 'generic';
export type MailKind = 'initial' | 'followup' | 'escalation';

export interface RenderedMail {
  subject: string;
  text: string;
  legalBasis: LegalBasis;
}

const DEADLINE_DAYS: Record<LegalBasis, number> = { gdpr: 30, ukgdpr: 30, generic: 30 };

const LAW_LABEL: Record<LegalBasis, { fr: string; en: string }> = {
  gdpr: { fr: "l'article 17 du Règlement général sur la protection des données (RGPD)", en: 'Article 17 of the General Data Protection Regulation (GDPR)' },
  ukgdpr: { fr: "l'article 17 du UK GDPR et du Data Protection Act 2018", en: 'Article 17 of the UK GDPR and the Data Protection Act 2018' },
  generic: { fr: "les lois applicables en matière de protection des données personnelles", en: 'applicable data protection law' },
};

/** Bloc d'identification: sans lui, le courtier répond "compte introuvable". */
function identityBlock(profile: Profile, lang: 'fr' | 'en'): string {
  const v = templateVariables(profile);
  const L = lang === 'fr'
    ? {
      name: 'Nom complet', prev: 'Anciens noms', email: 'Adresses email',
      phone: 'Téléphones', addr: 'Adresse postale', dob: 'Date de naissance',
      maid: 'Identifiants publicitaires mobiles (IDFA / AAID)',
    }
    : {
      name: 'Full name', prev: 'Previous names', email: 'Email addresses',
      phone: 'Phone numbers', addr: 'Postal address', dob: 'Date of birth',
      maid: 'Mobile advertising identifiers (IDFA / AAID)',
    };

  const rows: [string, string][] = [
    [L.name, v.fullName],
    [L.prev, v.previousNames],
    [L.email, v.allEmails],
    [L.phone, v.allPhones],
    [L.addr, v.fullAddress],
    [L.dob, v.dob],
    // Volontairement en dernier: seuls les courtiers publicitaires s'en
    // servent, mais pour eux c'est la seule clé exploitable.
    [L.maid, v.allAdvertisingIds],
  ];
  return rows.filter(([, value]) => value).map(([label, value]) => `- ${label} : ${value}`).join('\n');
}

/**
 * Chez un courtier publicitaire, la demande générique ne suffit pas: leurs
 * bases sont indexées par identifiant technique, pas par état civil. On leur
 * demande donc explicitement de traiter l'identifiant fourni, les segments
 * d'audience construits autour, et les traces de localisation associées.
 */
function adtechRequests(category: string, hasAdvertisingId: boolean, lang: 'fr' | 'en'): string[] {
  if (!['location', 'marketing'].includes(category)) return [];
  if (lang === 'fr') {
    const lines = [
      "Supprimer les segments d'audience, profils comportementaux et scores construits à partir de mes données.",
    ];
    if (category === 'location') {
      lines.push("Supprimer l'historique de localisation et les traces de déplacement rattachés à mes appareils.");
    }
    if (hasAdvertisingId) {
      lines.push("Rattacher cette demande aux identifiants publicitaires mobiles indiqués ci-dessus, ainsi qu'à tout identifiant probabiliste ou déterministe qui leur est associé dans votre graphe d'identité.");
    }
    return lines;
  }
  const lines = [
    'Delete the audience segments, behavioural profiles and scores derived from my data.',
  ];
  if (category === 'location') {
    lines.push('Delete the location history and movement traces associated with my devices.');
  }
  if (hasAdvertisingId) {
    lines.push('Apply this request to the mobile advertising identifiers listed above, and to any probabilistic or deterministic identifier linked to them in your identity graph.');
  }
  return lines;
}

function requestList(basis: LegalBasis, lang: 'fr' | 'en', extra: string[] = []): string {
  if (lang === 'fr') {
    const base = [
      'Effacer toutes les données personnelles me concernant de vos bases de données et de vos sauvegardes actives.',
      'Cesser toute vente, tout partage et toute communication de ces données à des tiers.',
      ...extra,
      'Transmettre cette demande à tous les destinataires auxquels ces données ont été communiquées.',
      'Me confirmer par écrit la suppression effective, ainsi que les catégories de données concernées et leur source.',
    ];
    return base.map((line, i) => `${i + 1}. ${line}`).join('\n');
  }
  const base = [
    'Erase all personal data concerning me from your databases and active backups.',
    'Stop selling, sharing or otherwise disclosing this data to third parties.',
    ...extra,
    'Forward this request to every recipient this data has been disclosed to.',
    'Confirm the deletion in writing, including the categories of data held and their source.',
  ];
  return base.map((line, i) => `${i + 1}. ${line}`).join('\n');
}

export function renderMail(options: {
  broker: Broker;
  profile: Profile;
  token: string;
  kind?: MailKind;
  /** Nombre de jours écoulés depuis la demande initiale, pour les relances. */
  daysElapsed?: number;
}): RenderedMail {
  const { broker, profile, token, kind = 'initial', daysElapsed = 0 } = options;
  const basis = legalBasisFor(profile);
  const lang = profile.language;
  const v = templateVariables(profile);
  const law = LAW_LABEL[basis][lang];
  const adtech = adtechRequests(broker.category, Boolean(v.allAdvertisingIds), lang);
  const deadline = DEADLINE_DAYS[basis];
  const ref = `RB-${token.toUpperCase()}`;

  if (lang === 'fr') {
    const subjects: Record<MailKind, string> = {
      initial: `Demande d'effacement de données personnelles - ${v.fullName}`,
      followup: `Relance : demande d'effacement de données personnelles - ${v.fullName}`,
      escalation: `Mise en demeure avant saisine de l'autorité de contrôle - ${v.fullName}`,
    };

    const intros: Record<MailKind, string> = {
      initial: `Madame, Monsieur,\n\nJe vous écris pour exercer mon droit à l'effacement de mes données personnelles auprès de ${broker.name}, sur le fondement de ${law}.`,
      followup: `Madame, Monsieur,\n\nJe fais suite à ma demande d'effacement de données personnelles adressée à ${broker.name} il y a ${daysElapsed} jours, restée sans réponse à ce jour.\n\nJe réitère cette demande sur le fondement de ${law}.`,
      escalation: `Madame, Monsieur,\n\nMalgré ma demande initiale et ma relance, ${broker.name} n'a pas donné suite à ma demande d'effacement dans le délai légal de ${deadline} jours prévu par ${law}.\n\nCe courriel constitue une dernière mise en demeure avant saisine de l'autorité de contrôle compétente.`,
    };

    const outro = kind === 'escalation'
      ? `À défaut de réponse sous 8 jours, je saisirai l'autorité de contrôle compétente et joindrai à ma plainte l'intégralité de cette correspondance.`
      : `Conformément à ${law}, vous disposez d'un délai de ${deadline} jours pour répondre à cette demande.\n\nSi vous avez besoin d'un élément supplémentaire pour vérifier mon identité ou retrouver ma fiche, indiquez précisément lequel : je fournirai le strict nécessaire. Je m'oppose à la communication de toute pièce excédant ce qui est nécessaire à la vérification.`;

    return {
      subject: subjects[kind],
      legalBasis: basis,
      text: [
        intros[kind],
        '',
        'IDENTIFICATION',
        identityBlock(profile, 'fr'),
        '',
        'DEMANDE',
        requestList(basis, 'fr', adtech),
        '',
        outro,
        '',
        'Cette demande est adressée par voie électronique et fait foi de la date de réception.',
        '',
        v.fullName,
        `Le ${v.date}`,
        '',
        `Référence de la demande : ${ref}`,
      ].join('\n'),
    };
  }

  const subjects: Record<MailKind, string> = {
    initial: `Data deletion request - ${v.fullName}`,
    followup: `Follow-up: data deletion request - ${v.fullName}`,
    escalation: `Final notice before regulatory complaint - ${v.fullName}`,
  };

  const intros: Record<MailKind, string> = {
    initial: `To whom it may concern at ${broker.name},\n\nI am writing to exercise my right to erasure of my personal data under ${law}.`,
    followup: `To whom it may concern at ${broker.name},\n\nI am following up on my data deletion request sent ${daysElapsed} days ago, which remains unanswered.\n\nI hereby reiterate that request under ${law}.`,
    escalation: `To whom it may concern at ${broker.name},\n\nDespite my initial request and follow-up, ${broker.name} has not responded within the ${deadline}-day statutory deadline set by ${law}.\n\nThis message is a final notice before I file a complaint with the competent supervisory authority.`,
  };

  const outro = kind === 'escalation'
    ? 'Absent a response within 8 days, I will file a complaint with the competent supervisory authority and attach this entire correspondence.'
    : `Under ${law}, you must respond to this request within ${deadline} days.\n\nIf you need additional information to verify my identity or locate my record, state precisely what is required and I will provide the strict minimum. I object to providing any document beyond what is necessary for verification.`;

  return {
    subject: subjects[kind],
    legalBasis: basis,
    text: [
      intros[kind],
      '',
      'IDENTIFICATION',
      identityBlock(profile, 'en'),
      '',
      'REQUEST',
      requestList(basis, 'en', adtech),
      '',
      outro,
      '',
      'This request is sent electronically and the date of receipt applies.',
      '',
      v.fullName,
      v.date,
      '',
      `Request reference: ${ref}`,
    ].join('\n'),
  };
}

/** Autorité de contrôle a saisir selon la juridiction déclarée. */
export function supervisoryAuthority(profile: Profile): { name: string; url: string } {
  const country = (profile.addresses[0]?.country ?? '').toLowerCase();
  if (profile.jurisdiction === 'uk') return { name: "Information Commissioner's Office (ICO)", url: 'https://ico.org.uk/make-a-complaint/' };
  if (/belg/.test(country)) return { name: 'Autorité de protection des données (APD)', url: 'https://www.autoriteprotectiondonnees.be/' };
  if (/suisse|switzerland/.test(country)) return { name: 'PFPDT', url: 'https://www.edoeb.admin.ch/' };
  if (/luxem/.test(country)) return { name: 'CNPD', url: 'https://cnpd.public.lu/' };
  if (/allemagne|deutschland|germany/.test(country)) return { name: 'BfDI', url: 'https://www.bfdi.bund.de/' };
  if (/espagne|spain|españa/.test(country)) return { name: 'AEPD', url: 'https://www.aepd.es/' };
  if (/italie|italy|italia/.test(country)) return { name: 'Garante per la protezione dei dati personali', url: 'https://www.garanteprivacy.it/' };
  if (/pays-bas|netherlands|nederland/.test(country)) return { name: 'Autoriteit Persoonsgegevens', url: 'https://autoriteitpersoonsgegevens.nl/' };
  if (/portugal/.test(country)) return { name: 'CNPD Portugal', url: 'https://www.cnpd.pt/' };
  return { name: 'CNIL', url: 'https://www.cnil.fr/fr/plaintes' };
}

/** Brouillon de plainte, pret à copier dans le formulaire de l'autorité. */
export function renderComplaint(options: { broker: Broker; profile: Profile; sentAt: string; token: string }): string {
  const { broker, profile, sentAt, token } = options;
  const v = templateVariables(profile);
  const authority = supervisoryAuthority(profile);
  const days = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);

  if (profile.language === 'fr') {
    return [
      `Plainte contre ${broker.name}${broker.legalName ? ` (${broker.legalName})` : ''}`,
      `Autorité compétente : ${authority.name} - ${authority.url}`,
      '',
      `Le ${new Date(sentAt).toLocaleDateString('fr-FR')}, j'ai adressé à ${broker.name} une demande d'effacement de mes données personnelles fondée sur l'article 17 du RGPD, par courrier électronique à l'adresse ${broker.email ?? 'indiquée sur son site'}.`,
      '',
      `À ce jour, soit ${days} jours plus tard, cette demande n'a fait l'objet d'aucune réponse, en violation de l'article 12.3 du RGPD qui impose un délai d'un mois.`,
      '',
      'Éléments à joindre :',
      `- copie de la demande initiale (référence RB-${token.toUpperCase()}), exportable depuis l'historique,`,
      '- copie des relances,',
      "- capture de la fiche publiée me concernant, le cas échéant.",
      '',
      `Demandeur : ${v.fullName}, ${v.fullAddress}`,
      `Contact : ${v.email}`,
    ].join('\n');
  }

  return [
    `Complaint against ${broker.name}${broker.legalName ? ` (${broker.legalName})` : ''}`,
    `Competent authority: ${authority.name} - ${authority.url}`,
    '',
    `On ${new Date(sentAt).toLocaleDateString('en-GB')} I sent ${broker.name} a request for erasure of my personal data under Article 17 GDPR, by email to ${broker.email ?? 'the address published on their website'}.`,
    '',
    `As of today, ${days} days later, the request remains unanswered, in breach of Article 12(3) GDPR which sets a one-month deadline.`,
    '',
    'Attachments:',
    `- copy of the initial request (reference RB-${token.toUpperCase()}), exportable from the history,`,
    '- copies of the follow-ups,',
    '- screenshot of the published listing about me, if any.',
    '',
    `Data subject: ${v.fullName}, ${v.fullAddress}`,
    `Contact: ${v.email}`,
  ].join('\n');
}
