import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Check, ExternalLink, Info, Loader2, Mail, MapPin, Plus, Shield, Trash2, UserRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, Divider, Field, Input, Select, useToast } from '../components/ui';
import { plural } from '../lib/format';
import type { AppState, Profile } from '../lib/types';

/**
 * Configuration initiale.
 *
 * Cinq écrans, une décision par écran. L'objectif est qu'une personne sans
 * connaissance technique arrive au bout: on explique pourquoi chaque
 * information est demandée, et le seul obstacle réel (le mot de passe
 * d'application) est accompagné d'un lien direct.
 */

const STEPS = ['Bienvenue', 'Votre identité', 'Votre pays', 'Votre messagerie', 'Lancement'];

const EMPTY_PROFILE: Profile = {
  firstName: '',
  lastName: '',
  emails: [''],
  phones: [],
  addresses: [{ line1: '', city: '', zip: '', country: 'France', state: '' }],
  previousNames: [],
  jurisdiction: 'eu',
  language: 'fr',
};

export function Onboarding({ state }: { state: AppState }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>(state.profile ?? EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const patch = (values: Partial<Profile>) => setProfile((p) => ({ ...p, ...values }));

  const identityValid = profile.firstName.trim().length > 1
    && profile.lastName.trim().length > 1
    && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(profile.emails[0] ?? '');

  async function saveProfile() {
    setSaving(true);
    try {
      await api.saveProfile({
        ...profile,
        emails: profile.emails.map((e) => e.trim()).filter(Boolean),
        phones: (profile.phones ?? []).filter(Boolean),
        previousNames: (profile.previousNames ?? []).filter(Boolean),
      });
      setStep((s) => s + 1);
    } catch (err) {
      toast.push('error', String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col justify-center px-4 py-8 sm:py-12">
      <header className="mb-7 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white">
          <Shield size={18} />
        </span>
        <div>
          <div className="font-semibold tracking-tight">RemoveBroker</div>
          <div className="text-[0.78rem] text-[var(--color-ink-faint)]">Configuration en {STEPS.length} étapes</div>
        </div>
      </header>

      <StepIndicator step={step} />

      <Card className="animate-in mt-5 overflow-hidden">
        {step === 0 && <WelcomeStep state={state} onNext={() => setStep(1)} />}
        {step === 1 && (
          <IdentityStep
            profile={profile}
            patch={patch}
            valid={identityValid}
            saving={saving}
            onBack={() => setStep(0)}
            onNext={saveProfile}
          />
        )}
        {step === 2 && (
          <CountryStep profile={profile} patch={patch} onBack={() => setStep(1)} onNext={saveProfile} saving={saving} />
        )}
        {step === 3 && (
          <MailStep
            defaultEmail={profile.emails[0] ?? ''}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <LaunchStep
            state={state}
            onBack={() => setStep(3)}
            onDone={async () => {
              await queryClient.invalidateQueries({ queryKey: ['state'] });
            }}
          />
        )}
      </Card>
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, index) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className="h-1 flex-1 rounded-full transition-colors duration-300"
            style={{ background: index <= step ? 'var(--color-accent)' : 'var(--color-line)' }}
          />
        </li>
      ))}
    </ol>
  );
}

function StepShell({ title, description, children, footer }: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <>
      <div className="px-6 pt-6">
        <h1 className="text-[1.3rem] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-[var(--color-ink-soft)]">{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
      <Divider />
      <div className="flex items-center justify-between gap-3 px-6 py-3.5">{footer}</div>
    </>
  );
}

// ---------------------------------------------------------------------------

function WelcomeStep({ state, onNext }: { state: AppState; onNext: () => void }) {
  const total = state.catalog?.total ?? 0;
  const points = [
    {
      icon: UserRound,
      title: 'Vous renseignez votre identité une seule fois',
      text: "Elle reste chiffrée sur votre ordinateur. Aucun serveur, aucun compte, aucune société intermédiaire.",
    },
    {
      icon: Mail,
      title: `RemoveBroker écrit aux ${total.toLocaleString('fr-FR')} courtiers connus`,
      text: "Les demandes partent depuis votre propre boîte email, avec le fondement juridique adapté à votre pays.",
    },
    {
      icon: Check,
      title: 'Les réponses sont traitées automatiquement',
      text: "Liens de confirmation ouverts, relances envoyées, suivi tenu à jour. Vous n'intervenez que si un courtier l'exige.",
    },
  ];

  return (
    <StepShell
      title="Reprenez le contrôle de vos données"
      description="Des centaines de sociétés revendent votre nom, votre adresse et votre numéro de téléphone. La loi vous permet d'exiger leur effacement. Cet outil le fait pour vous."
      footer={
        <>
          <span className="text-[0.82rem] text-[var(--color-ink-faint)]">Environ 5 minutes</span>
          <Button variant="primary" onClick={onNext} icon={<ArrowRight size={16} />}>Commencer</Button>
        </>
      }
    >
      <ul className="flex flex-col gap-4">
        {points.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
              <Icon size={15} />
            </span>
            <div>
              <p className="text-[0.9rem] font-medium">{title}</p>
              <p className="mt-0.5 text-[0.86rem] leading-snug text-[var(--color-ink-soft)]">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------

function IdentityStep({ profile, patch, valid, saving, onBack, onNext }: {
  profile: Profile;
  patch: (values: Partial<Profile>) => void;
  valid: boolean;
  saving: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const setEmail = (index: number, value: string) => {
    const emails = [...profile.emails];
    emails[index] = value;
    patch({ emails });
  };

  return (
    <StepShell
      title="Votre identité"
      description="Ces informations servent uniquement a permettre aux courtiers de retrouver votre fiche. Plus elles sont complètes, plus la suppression est fiable."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={16} />}>Retour</Button>
          <Button variant="primary" onClick={onNext} disabled={!valid} loading={saving} icon={<ArrowRight size={16} />}>Continuer</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" required>
          <Input value={profile.firstName} onChange={(e) => patch({ firstName: e.target.value })} autoComplete="given-name" placeholder="Marie" />
        </Field>
        <Field label="Nom" required>
          <Input value={profile.lastName} onChange={(e) => patch({ lastName: e.target.value })} autoComplete="family-name" placeholder="Dupont" />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Adresse email principale" required hint="C'est l'adresse que les courtiers ont probablement dans leurs bases, et celle qui recevra leurs réponses.">
          <Input type="email" value={profile.emails[0] ?? ''} onChange={(e) => setEmail(0, e.target.value)} autoComplete="email" placeholder="marie.dupont@exemple.fr" />
        </Field>
      </div>

      {profile.emails.slice(1).map((email, index) => (
        <div key={index} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label={`Autre adresse email ${index + 1}`}>
              <Input type="email" value={email} onChange={(e) => setEmail(index + 1, e.target.value)} placeholder="ancienne.adresse@exemple.fr" />
            </Field>
          </div>
          <Button
            variant="ghost"
            className="mb-0.5"
            onClick={() => patch({ emails: profile.emails.filter((_, i) => i !== index + 1) })}
            icon={<Trash2 size={15} />}
            aria-label="Supprimer cette adresse"
          />
        </div>
      ))}

      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-[var(--color-accent)]"
        onClick={() => patch({ emails: [...profile.emails, ''] })}
      >
        <Plus size={14} /> Ajouter une autre adresse email
      </button>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Téléphone" hint="Souvent la clé utilisée par les annuaires inverses.">
          <Input
            value={profile.phones?.[0] ?? ''}
            onChange={(e) => patch({ phones: [e.target.value] })}
            autoComplete="tel"
            placeholder="06 12 34 56 78"
          />
        </Field>
        <Field label="Date de naissance" hint="Facultatif. Certains courtiers la demandent pour identifier la bonne personne.">
          <Input type="date" value={profile.dateOfBirth ?? ''} onChange={(e) => patch({ dateOfBirth: e.target.value })} />
        </Field>
      </div>

      <div className="mt-5 grid gap-4">
        <Field label="Adresse postale">
          <Input
            value={profile.addresses[0]?.line1 ?? ''}
            onChange={(e) => patch({ addresses: [{ ...profile.addresses[0], line1: e.target.value }] })}
            autoComplete="street-address"
            placeholder="12 rue des Lilas"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code postal">
            <Input
              value={profile.addresses[0]?.zip ?? ''}
              onChange={(e) => patch({ addresses: [{ ...profile.addresses[0], zip: e.target.value }] })}
              autoComplete="postal-code"
              placeholder="75011"
            />
          </Field>
          <Field label="Ville">
            <Input
              value={profile.addresses[0]?.city ?? ''}
              onChange={(e) => patch({ addresses: [{ ...profile.addresses[0], city: e.target.value }] })}
              autoComplete="address-level2"
              placeholder="Paris"
            />
          </Field>
          <Field label="Pays">
            <Input
              value={profile.addresses[0]?.country ?? ''}
              onChange={(e) => patch({ addresses: [{ ...profile.addresses[0], country: e.target.value }] })}
              autoComplete="country-name"
              placeholder="France"
            />
          </Field>
        </div>
      </div>

      <AdvertisingIdField profile={profile} patch={patch} />
    </StepShell>
  );
}

/**
 * Identifiant publicitaire du téléphone.
 *
 * Replié par défaut: la majorité des courtiers n'en ont pas besoin, et le
 * demander d'emblée ferait abandonner la configuration. Mais pour les courtiers
 * de localisation, c'est la seule information qui permette de retrouver quoi
 * que ce soit, donc l'explication doit être là au moment où on la déplie.
 */
function AdvertisingIdField({ profile, patch }: {
  profile: Profile;
  patch: (values: Partial<Profile>) => void;
}) {
  const [open, setOpen] = useState((profile.advertisingIds?.length ?? 0) > 0);

  if (!open) {
    return (
      <button
        type="button"
        className="mt-5 inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-[var(--color-accent)]"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} /> Ajouter l&apos;identifiant publicitaire de mon téléphone
      </button>
    );
  }

  return (
    <div className="mt-5">
      <Field
        label="Identifiant publicitaire mobile"
        hint="Facultatif. Les courtiers qui revendent vos déplacements ne connaissent ni votre nom ni votre adresse: ils vous identifient uniquement par ce code."
      >
        <Input
          value={profile.advertisingIds?.[0] ?? ''}
          onChange={(e) => patch({ advertisingIds: [e.target.value] })}
          placeholder="38400000-8cf0-11bd-b23e-10b96e40000d"
          spellCheck={false}
        />
      </Field>
      <div className="mt-2.5 text-[0.83rem] leading-relaxed text-[var(--color-ink-soft)]">
        <p><strong className="font-medium">Android</strong> : Paramètres, Google, Tous les services, Annonces. Le code est affiché, copiez-le puis choisissez « Supprimer l&apos;identifiant publicitaire ».</p>
        <p className="mt-1"><strong className="font-medium">iPhone</strong> : Apple ne l&apos;affiche pas. Allez dans Réglages, Confidentialité et sécurité, Suivi, et désactivez l&apos;autorisation: votre identifiant devient nul et aucune nouvelle donnée ne peut plus y être rattachée.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const JURISDICTIONS = [
  { value: 'eu', label: 'France ou Union européenne', law: 'RGPD, article 17', detail: 'Réponse obligatoire sous 1 mois.' },
  { value: 'uk', label: 'Royaume-Uni', law: 'UK GDPR', detail: 'Réponse obligatoire sous 1 mois.' },
  { value: 'other', label: 'Autre pays européen', law: 'Demande fondée sur le RGPD', detail: "Suisse, Norvège, Islande: le RGPD reste opposable aux sociétés de l'Union." },
] as const;

function CountryStep({ profile, patch, onBack, onNext, saving }: {
  profile: Profile;
  patch: (values: Partial<Profile>) => void;
  onBack: () => void;
  onNext: () => void;
  saving: boolean;
}) {
  return (
    <StepShell
      title="Où résidez-vous ?"
      description="Votre lieu de résidence détermine la loi invoquée dans les demandes, et donc le délai que les courtiers sont tenus de respecter."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={16} />}>Retour</Button>
          <Button variant="primary" onClick={onNext} loading={saving} icon={<ArrowRight size={16} />}>Continuer</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {JURISDICTIONS.map((option) => {
          const active = profile.jurisdiction === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => patch({ jurisdiction: option.value })}
              className="flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors"
              style={{
                borderColor: active ? 'var(--color-accent)' : 'var(--color-line)',
                background: active ? 'var(--color-accent-soft)' : 'transparent',
              }}
            >
              <MapPin size={16} className={active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]'} />
              <div className="flex-1">
                <div className="text-[0.9rem] font-medium">{option.label}</div>
                <div className="text-[0.82rem] text-[var(--color-ink-soft)]">{option.law} · {option.detail}</div>
              </div>
              {active && <Check size={16} className="text-[var(--color-accent)]" />}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <Field label="Langue des demandes" hint="Le français fonctionne avec les courtiers européens. L'anglais est préférable pour les sociétés américaines, majoritaires dans le catalogue.">
          <Select value={profile.language} onChange={(e) => patch({ language: e.target.value as 'fr' | 'en' })}>
            <option value="en">Anglais (recommandé)</option>
            <option value="fr">Français</option>
          </Select>
        </Field>
      </div>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------

function MailStep({ defaultEmail, onBack, onNext }: { defaultEmail: string; onBack: () => void; onNext: () => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [testing, setTesting] = useState(false);
  const [smtpOk, setSmtpOk] = useState(false);
  const [imapOk, setImapOk] = useState(false);
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null);
  const [provider, setProvider] = useState<{ label: string; appPassword?: { url: string; help: string }; note?: string } | null>(null);
  const toast = useToast();

  // Détection du fournisseur dès que l'adresse est complète: l'utilisateur ne
  // saisit jamais un nom de serveur si on peut le deviner.
  useEffect(() => {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return;
    let cancelled = false;
    void api.providers(email).then((res) => {
      if (cancelled) return;
      const suggestion = res.suggestion;
      if (suggestion) {
        setHost(suggestion.smtp.host);
        setPort(suggestion.smtp.port);
        setSecure(suggestion.smtp.secure);
        setImapHost(suggestion.imap.host);
        setImapPort(suggestion.imap.port);
      }
      setProvider(res.detected ? { label: res.detected.label, appPassword: res.detected.appPassword, note: res.detected.note } : null);
      setAdvanced(!res.detected);
    });
    return () => { cancelled = true; };
  }, [email]);

  const canTest = Boolean(email && password && host);

  async function test() {
    setTesting(true);
    setError(null);
    try {
      const smtp = await api.testSmtp({
        host, port, secure, user: email, password,
        fromEmail: email, fromName: '', preset: provider?.label ?? 'custom',
      });
      if (!smtp.ok) {
        setError({ error: smtp.error ?? 'Échec', hint: smtp.hint });
        setSmtpOk(false);
        return;
      }
      setSmtpOk(true);

      // La lecture de la boîte est ce qui permet le suivi automatique: on la
      // tente avec les mêmes identifiants, sans étape supplémentaire.
      const imap = await api.testImap({ host: imapHost, port: imapPort, secure: true, user: email, password, mailbox: 'INBOX' });
      setImapOk(imap.ok);
      if (imap.ok) toast.push('success', 'Envoi et lecture des réponses configurés.');
      else toast.push('warn', "Envoi configuré. La lecture automatique des réponses n'a pas pu être activée.");
    } catch (err) {
      setError({ error: String((err as Error).message) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <StepShell
      title="Connecter votre messagerie"
      description="Les demandes partent de votre propre adresse: c'est ce qui les rend recevables. RemoveBroker lit aussi les réponses pour valider les confirmations à votre place."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={16} />}>Retour</Button>
          <div className="flex gap-2">
            {!smtpOk && <Button variant="ghost" onClick={onNext}>Plus tard</Button>}
            <Button variant="primary" onClick={smtpOk ? onNext : test} disabled={!canTest && !smtpOk} loading={testing} icon={smtpOk ? <ArrowRight size={16} /> : undefined}>
              {smtpOk ? 'Continuer' : 'Vérifier la connexion'}
            </Button>
          </div>
        </>
      }
    >
      <Field label="Votre adresse email" required>
        <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSmtpOk(false); }} placeholder="marie.dupont@gmail.com" />
      </Field>

      {provider && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-[var(--color-info-soft)] px-3 py-2.5 text-[0.85rem] text-[var(--color-info)]">
          <Info size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{provider.label} detecte</p>
            {provider.appPassword && <p className="mt-0.5 leading-snug">{provider.appPassword.help}</p>}
            {provider.note && <p className="mt-0.5 leading-snug">{provider.note}</p>}
            {provider.appPassword && (
              <a href={provider.appPassword.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-medium underline">
                Creer le mot de passe d'application <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Field
          label={provider?.appPassword ? "Mot de passe d'application" : 'Mot de passe'}
          required
          hint={provider?.appPassword ? 'Les 16 caractères fournis par votre messagerie, pas votre mot de passe habituel.' : undefined}
        >
          <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setSmtpOk(false); }} autoComplete="off" placeholder="••••••••••••••••" />
        </Field>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2.5 text-[0.85rem] text-[var(--color-danger)]">
          <p className="font-medium">Connexion refusée</p>
          {error.hint && <p className="mt-0.5 leading-snug">{error.hint}</p>}
          <p className="mt-1 font-mono text-[0.75rem] opacity-80">{error.error}</p>
        </div>
      )}

      {smtpOk && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-ok-soft)] px-3 py-2.5 text-[0.85rem] text-[var(--color-ok)]">
          <Check size={15} />
          <span className="font-medium">Envoi opérationnel.</span>
          {imapOk
            ? <Badge tone="ok">Lecture des réponses activée</Badge>
            : <Badge tone="warn">Lecture des réponses indisponible</Badge>}
        </div>
      )}

      <button type="button" className="mt-4 text-[0.83rem] font-medium text-[var(--color-ink-soft)] underline" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? 'Masquer les réglages serveur' : 'Régler les serveurs manuellement'}
      </button>

      {advanced && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Serveur d'envoi (SMTP)">
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.exemple.fr" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port">
              <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </Field>
            <Field label="Chiffrement">
              <Select value={secure ? 'ssl' : 'starttls'} onChange={(e) => setSecure(e.target.value === 'ssl')}>
                <option value="starttls">STARTTLS (587)</option>
                <option value="ssl">SSL (465)</option>
              </Select>
            </Field>
          </div>
          <Field label="Serveur de réception (IMAP)">
            <Input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.exemple.fr" />
          </Field>
          <Field label="Port IMAP">
            <Input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
          </Field>
        </div>
      )}
    </StepShell>
  );
}

// ---------------------------------------------------------------------------

function LaunchStep({ state, onBack, onDone }: { state: AppState; onBack: () => void; onDone: () => Promise<void> }) {
  const european = state.profile?.jurisdiction === 'eu' || state.profile?.jurisdiction === 'uk';
  // Pour un résident européen, commencer par les courtiers qui détiennent
  // réellement des données européennes évite des centaines de réponses
  // "aucune donnée vous concernant" venant d'annuaires américains.
  const [scope, setScope] = useState<'all' | 'recommended'>(european ? 'recommended' : 'all');
  const [preview, setPreview] = useState<{ total: number; byMethod: { email: number; recipe: number; form: number; discovery: number }; estimatedDays: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void api.previewCampaign({ scope }).then(setPreview).catch(() => setPreview(null));
  }, [scope]);

  const options = useMemo(() => ([
    european
      ? {
        value: 'recommended' as const,
        title: 'Ceux qui détiennent des données européennes',
        detail: 'Régies publicitaires, bases de prospection et bureaux de crédit soumis au RGPD. Le meilleur taux de suppression depuis la France.',
      }
      : {
        value: 'recommended' as const,
        title: "Les plus exposants d'abord",
        detail: 'Sites de recherche de personnes et annuaires, là où vos données sont publiques.',
      },
    {
      value: 'all' as const,
      title: 'Tous les courtiers connus',
      detail: `${(state.catalog?.total ?? 0).toLocaleString('fr-FR')} sociétés du catalogue, y compris les annuaires américains.`,
    },
  ]), [state.catalog?.total, european]);

  async function launch(start: boolean) {
    setLaunching(true);
    try {
      const result = await api.completeOnboarding(start, scope);
      if (result.campaign) toast.push('success', `${plural(result.campaign.total, 'demande')} programmée${result.campaign.total > 1 ? 's' : ''}.`);
      await onDone();
    } catch (err) {
      toast.push('error', String((err as Error).message));
    } finally {
      setLaunching(false);
    }
  }

  return (
    <StepShell
      title="Tout est pret"
      description="Les demandes sont étalées dans le temps pour ne pas faire suspendre votre boîte email. Vous pouvez fermer l'application: elle reprend ou elle s'est arrêtée."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={16} />}>Retour</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => launch(false)} disabled={launching}>Ne rien envoyer pour l'instant</Button>
            <Button variant="primary" onClick={() => launch(true)} loading={launching} icon={<Shield size={16} />}>Lancer la protection</Button>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const active = scope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setScope(option.value)}
              className="rounded-xl border px-3.5 py-3 text-left transition-colors"
              style={{
                borderColor: active ? 'var(--color-accent)' : 'var(--color-line)',
                background: active ? 'var(--color-accent-soft)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[0.9rem] font-medium">{option.title}</span>
                {active && <Check size={15} className="text-[var(--color-accent)]" />}
              </div>
              <p className="mt-0.5 text-[0.84rem] text-[var(--color-ink-soft)]">{option.detail}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {preview ? (
          <dl className="grid grid-cols-3 gap-4">
            <Stat label="Demandes" value={preview.total.toLocaleString('fr-FR')} />
            <Stat label="Par email" value={preview.byMethod.email.toLocaleString('fr-FR')} />
            <Stat label="Durée estimée" value={preview.estimatedDays <= 1 ? '1 jour' : `${preview.estimatedDays} jours`} />
          </dl>
        ) : (
          <div className="flex items-center gap-2 text-[0.85rem] text-[var(--color-ink-faint)]">
            <Loader2 size={14} className="animate-spin" /> Calcul en cours
          </div>
        )}
      </div>
    </StepShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.78rem] uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="tnum mt-0.5 text-[1.4rem] font-semibold tracking-tight">{value}</dd>
    </div>
  );
}
