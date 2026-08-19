import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, Download, ExternalLink, HardDriveDownload, KeyRound, Save, Trash2,
} from 'lucide-react';
import { api, installBrowser } from '../lib/api';
import {
  Badge, Button, Card, CardHeader, Divider, Field, Input, Modal, Segmented, Select, Toggle, useToast,
} from '../components/ui';
import { PageHeader } from '../components/Layout';
import type { AppState, Profile, Settings } from '../lib/types';

/** Paramètres, regroupés par intention plutôt que par table technique. */

type Section = 'profile' | 'mail' | 'automation' | 'privacy' | 'data';

export function SettingsPage({ state }: { state: AppState }) {
  const [section, setSection] = useState<Section>('profile');
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, initialData: state.settings });

  return (
    <>
      <PageHeader title="Paramètres" />
      <div className="mb-4">
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'profile', label: 'Profil' },
            { value: 'mail', label: 'Messagerie' },
            { value: 'automation', label: 'Automatisation' },
            { value: 'privacy', label: 'Confidentialité' },
            { value: 'data', label: 'Mes données' },
          ]}
        />
      </div>

      {section === 'profile' && <ProfileSection profile={state.profile ?? null} />}
      {section === 'mail' && settings && <MailSection settings={settings} />}
      {section === 'automation' && settings && <AutomationSection settings={settings} state={state} />}
      {section === 'privacy' && settings && <PrivacySection settings={settings} state={state} />}
      {section === 'data' && <DataSection />}
    </>
  );
}

// ---------------------------------------------------------------------------

function ProfileSection({ profile }: { profile: Profile | null }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Profile>(profile ?? {
    firstName: '', lastName: '', emails: [''], addresses: [{ line1: '', city: '', zip: '', country: '' }],
    jurisdiction: 'eu', language: 'fr',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.saveProfile(form);
      toast.push('success', 'Profil enregistré.');
      await queryClient.invalidateQueries({ queryKey: ['state'] });
    } catch (err) {
      toast.push('error', String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  const address = form.addresses[0] ?? { line1: '', city: '', zip: '', country: '' };
  const setAddress = (patch: Partial<typeof address>) => setForm({ ...form, addresses: [{ ...address, ...patch }] });

  return (
    <Card>
      <CardHeader
        title="Identité communiquée aux courtiers"
        description="Ces informations sont chiffrées sur cet ordinateur et n'apparaissent que dans les demandes que vous envoyez."
      />
      <Divider />
      <div className="px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label="Nom"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
        </div>

        <div className="mt-4">
          <Field label="Adresses email" hint="Une par ligne. Toutes sont citées dans les demandes pour couvrir vos anciennes adresses.">
            <Input
              value={form.emails.join(', ')}
              onChange={(e) => setForm({ ...form, emails: e.target.value.split(',').map((s) => s.trim()) })}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Téléphones">
            <Input
              value={(form.phones ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, phones: e.target.value.split(',').map((s) => s.trim()) })}
            />
          </Field>
          <Field label="Date de naissance">
            <Input type="date" value={form.dateOfBirth ?? ''} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Adresse"><Input value={address.line1} onChange={(e) => setAddress({ line1: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Code postal"><Input value={address.zip} onChange={(e) => setAddress({ zip: e.target.value })} /></Field>
            <Field label="Ville"><Input value={address.city} onChange={(e) => setAddress({ city: e.target.value })} /></Field>
            <Field label="Pays"><Input value={address.country} onChange={(e) => setAddress({ country: e.target.value })} /></Field>
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          <Field
            label="Identifiants publicitaires mobiles"
            hint="Facultatif, un par ligne. Android: Paramètres, Google, Annonces. iPhone: non affiché par Apple, désactivez le suivi dans Réglages, Confidentialité et sécurité, Suivi. Sans ce code, les courtiers de localisation ne peuvent pas retrouver vos données."
          >
            <Input
              value={(form.advertisingIds ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, advertisingIds: e.target.value.split(',').map((s) => s.trim()) })}
              placeholder="38400000-8cf0-11bd-b23e-10b96e40000d"
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Anciens noms" hint="Nom de naissance, nom d'usage précédent. Utile pour les fiches anciennes.">
            <Input
              value={(form.previousNames ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, previousNames: e.target.value.split(',').map((s) => s.trim()) })}
            />
          </Field>
          <Field label="Loi invoquée">
            <Select value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value as Profile['jurisdiction'] })}>
              <option value="eu">RGPD (France et Union européenne)</option>
              <option value="uk">UK GDPR (Royaume-Uni)</option>
              <option value="other">Autre pays européen</option>
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Langue des demandes">
            <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'fr' | 'en' })}>
              <option value="en">Anglais</option>
              <option value="fr">Français</option>
            </Select>
          </Field>
        </div>
      </div>
      <Divider />
      <div className="flex justify-end px-5 py-3">
        <Button variant="primary" onClick={save} loading={saving} icon={<Save size={15} />}>Enregistrer</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MailSection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [smtp, setSmtp] = useState(settings.smtp);
  const [imap, setImap] = useState(settings.imap);
  const [testing, setTesting] = useState<'smtp' | 'imap' | null>(null);

  async function testSmtp() {
    setTesting('smtp');
    try {
      const result = await api.testSmtp(smtp as unknown as Record<string, unknown>);
      if (result.ok) toast.push('success', 'Connexion réussie, réglages enregistrés.');
      else toast.push('error', result.hint ?? result.error ?? 'Échec de la connexion.');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    } finally {
      setTesting(null);
    }
  }

  async function testImap() {
    setTesting('imap');
    try {
      const result = await api.testImap(imap as unknown as Record<string, unknown>);
      if (result.ok) toast.push('success', 'Lecture des réponses activée.');
      else toast.push('error', result.hint ?? result.error ?? 'Échec de la connexion.');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Envoi des demandes"
          description="Les demandes partent de votre adresse. Une demande envoyée par un tiers serait rejetée."
          action={settings.smtp.verified ? <Badge tone="ok"><Check size={11} /> Vérifié</Badge> : <Badge tone="warn">Non vérifié</Badge>}
        />
        <Divider />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Adresse email"><Input value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value, fromEmail: e.target.value })} /></Field>
          <Field label="Mot de passe d'application"><Input type="password" value={smtp.password} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} /></Field>
          <Field label="Serveur SMTP"><Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port"><Input type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} /></Field>
            <Field label="Chiffrement">
              <Select value={smtp.secure ? 'ssl' : 'starttls'} onChange={(e) => setSmtp({ ...smtp, secure: e.target.value === 'ssl' })}>
                <option value="starttls">STARTTLS</option>
                <option value="ssl">SSL</option>
              </Select>
            </Field>
          </div>
          <Field label="Nom affiche" hint="Apparaît comme expéditeur auprès des courtiers.">
            <Input value={smtp.fromName} onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })} />
          </Field>
        </div>
        <Divider />
        <div className="flex justify-end px-5 py-3">
          <Button variant="primary" onClick={testSmtp} loading={testing === 'smtp'}>Tester et enregistrer</Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Lecture des réponses"
          description="Sans cette connexion, les liens de confirmation ne peuvent pas être validés automatiquement et le suivi devient manuel."
          action={settings.imap.verified ? <Badge tone="ok"><Check size={11} /> Actif</Badge> : <Badge tone="warn">Inactif</Badge>}
        />
        <Divider />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Adresse email"><Input value={imap.user} onChange={(e) => setImap({ ...imap, user: e.target.value })} /></Field>
          <Field label="Mot de passe"><Input type="password" value={imap.password} onChange={(e) => setImap({ ...imap, password: e.target.value })} /></Field>
          <Field label="Serveur IMAP"><Input value={imap.host} onChange={(e) => setImap({ ...imap, host: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port"><Input type="number" value={imap.port} onChange={(e) => setImap({ ...imap, port: Number(e.target.value) })} /></Field>
            <Field label="Dossier"><Input value={imap.mailbox} onChange={(e) => setImap({ ...imap, mailbox: e.target.value })} /></Field>
          </div>
        </div>
        <Divider />
        <div className="flex justify-end px-5 py-3">
          <Button variant="primary" onClick={testImap} loading={testing === 'imap'}>Tester et activer</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AutomationSection({ settings, state }: { settings: Settings; state: AppState }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState(settings.automation);
  const [schedule, setSchedule] = useState(settings.schedule);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);

  async function save(section: 'automation' | 'schedule', patch: Record<string, unknown>) {
    await api.saveSettings(section, patch);
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
    await queryClient.invalidateQueries({ queryKey: ['state'] });
  }

  // Le système peut refuser l'inscription au démarrage: on affiche l'état
  // qu'il renvoie, pas celui qu'on a demandé.
  async function saveAutoStart(enabled: boolean) {
    try {
      await api.setAutoStart(enabled);
      await queryClient.invalidateQueries({ queryKey: ['state'] });
      toast.push('success', enabled ? 'RemoveBroker démarrera avec Windows.' : 'Démarrage automatique désactivé.');
    } catch (err) {
      toast.push('error', String((err as Error).message));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Ce que RemoveBroker fait sans vous" />
        <Divider />
        <div className="px-5">
          {/* Sans ce démarrage, rien n'avance quand l'application est fermée:
              les réponses ne sont pas relevées, les liens de confirmation
              expirent et les relances sortent en retard. L'option n'existait
              que dans le menu de l'icône de notification, où personne ne la
              cherche. Absente hors de l'application de bureau. */}
          {state.settings?.autoStart != null && (
            <>
              <Toggle
                label="Démarrer avec Windows"
                description="L'application se lance réduite dans la zone de notification. Sans elle, les réponses ne sont relevées que lorsque vous l'ouvrez."
                checked={state.settings.autoStart}
                onChange={(v) => void saveAutoStart(v)}
              />
              <Divider />
            </>
          )}
          <Toggle
            label="Envoyer les demandes par email"
            description="Le canal principal: il couvre la grande majorité du catalogue."
            checked={values.emailEnabled}
            onChange={(v) => { setValues({ ...values, emailEnabled: v }); void save('automation', { emailEnabled: v }); }}
          />
          <Divider />
          <Toggle
            label="Remplir les formulaires d'opt-out"
            description={state.browser?.available
              ? `Utilise ${state.browser.source}, déjà installé sur cet ordinateur.`
              : "Nécessite un navigateur. Aucun n'a été détecté."}
            checked={values.webEnabled}
            disabled={!state.browser?.available}
            onChange={(v) => { setValues({ ...values, webEnabled: v }); void save('automation', { webEnabled: v }); }}
          />
          <Divider />
          <Toggle
            label="Ouvrir les liens de confirmation reçus"
            description="Uniquement si le lien pointe vers le domaine du courtier concerné. Tout autre lien vous est signale sans être ouvert."
            checked={values.autoConfirmLinks}
            onChange={(v) => { setValues({ ...values, autoConfirmLinks: v }); void save('automation', { autoConfirmLinks: v }); }}
          />
          <Divider />
          <Toggle
            label="Soumettre les formulaires à ma place"
            description="Les courtiers sans adresse email voient leur formulaire rempli et envoyé sans intervention. La demande vous revient si un captcha protège la page, si le formulaire est introuvable, ou si trop peu de champs sont reconnus."
            checked={values.autoSubmitForms}
            onChange={(v) => { setValues({ ...values, autoSubmitForms: v }); void save('automation', { autoSubmitForms: v }); }}
          />
          <Divider />
          <Toggle
            label="Contacter automatiquement les nouveaux courtiers"
            description="Quand le catalogue s'enrichit, les demandes partent seules."
            checked={schedule.enabled}
            onChange={(v) => { setSchedule({ ...schedule, enabled: v }); void save('schedule', { enabled: v }); }}
          />
        </div>
        <Divider />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
          <Field label="Emails par jour" hint="Au-delà, les messageries grand public suspendent temporairement l'envoi.">
            <Input
              type="number"
              value={values.dailyEmailLimit}
              onChange={(e) => setValues({ ...values, dailyEmailLimit: Number(e.target.value) })}
              onBlur={() => void save('automation', { dailyEmailLimit: values.dailyEmailLimit })}
            />
          </Field>
          <Field label="Relance après (jours)">
            <Input
              type="number"
              value={schedule.followUpAfterDays}
              onChange={(e) => setSchedule({ ...schedule, followUpAfterDays: Number(e.target.value) })}
              onBlur={() => void save('schedule', { followUpAfterDays: schedule.followUpAfterDays })}
            />
          </Field>
          <Field label="Mise en demeure après (jours)">
            <Input
              type="number"
              value={schedule.escalateAfterDays}
              onChange={(e) => setSchedule({ ...schedule, escalateAfterDays: Number(e.target.value) })}
              onBlur={() => void save('schedule', { escalateAfterDays: schedule.escalateAfterDays })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Navigateur d'automatisation"
          description="Utilise pour remplir les formulaires et valider les confirmations qui exigent du JavaScript."
          action={<Badge tone={state.browser?.available ? 'ok' : 'neutral'}>{state.browser?.source ?? 'aucun'}</Badge>}
        />
        <Divider />
        <div className="px-5 py-4">
          <p className="text-[0.86rem] text-[var(--color-ink-soft)]">
            {state.browser?.available
              ? "Un navigateur déjà présent est utilise: rien à télécharger."
              : "Aucun navigateur compatible détecté. RemoveBroker peut en télécharger un (environ 150 Mo) dans son dossier de données."}
          </p>
          {!state.browser?.available && (
            <Button
              className="mt-3"
              icon={<HardDriveDownload size={15} />}
              loading={installing}
              onClick={() => {
                setInstalling(true);
                setInstallLog([]);
                installBrowser(
                  (line) => setInstallLog((prev) => [...prev.slice(-6), line]),
                  async (error) => {
                    setInstalling(false);
                    if (error) toast.push('error', error);
                    else {
                      toast.push('success', 'Navigateur installé.');
                      await queryClient.invalidateQueries({ queryKey: ['state'] });
                    }
                  },
                );
              }}
            >
              Telecharger le navigateur
            </Button>
          )}
          {installLog.length > 0 && (
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-[var(--color-surface-sunk)] p-3 font-mono text-[0.74rem]">
              {installLog.join('\n')}
            </pre>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PrivacySection({ settings, state }: { settings: Settings; state: AppState }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [privacy, setPrivacy] = useState(settings.privacy);
  const [passphrase, setPassphrase] = useState('');
  const [showKey, setShowKey] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setPrivacy({ ...privacy, ...patch } as typeof privacy);
    await api.saveSettings('privacy', patch);
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
  }

  const modeLabel = {
    plain: 'Fichier protégé par les permissions du système',
    os: 'Scellé par le système d\'exploitation',
    passphrase: 'Protégé par une phrase secrète',
  }[state.keyring.mode];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Traces conservées" />
        <Divider />
        <div className="px-5">
          <Toggle
            label="Conserver une copie des emails"
            description="Nécessaire pour constituer un dossier en cas de plainte. Les copies sont chiffrées."
            checked={privacy.keepEmailCopies}
            onChange={(v) => void save({ keepEmailCopies: v })}
          />
          <Divider />
          <Toggle
            label="Journaux techniques minimaux"
            description="Aucun nom, aucune adresse dans les journaux: uniquement des identifiants de courtiers et des codes d'erreur."
            checked={privacy.minimalLogs}
            onChange={(v) => void save({ minimalLogs: v })}
          />
          <Divider />
          <Toggle
            label="Mettre à jour le catalogue automatiquement"
            description="Une requête anonyme par jour vers un fichier statique. Aucun identifiant transmis."
            checked={privacy.catalogAutoUpdate}
            onChange={(v) => void save({ catalogAutoUpdate: v })}
          />
        </div>
        <Divider />
        <div className="px-5 py-4">
          <Field label="Source du catalogue" hint="Modifiable si vous préférez héberger votre propre copie.">
            <Input value={privacy.catalogUrl} onChange={(e) => setPrivacy({ ...privacy, catalogUrl: e.target.value })} onBlur={() => void save({ catalogUrl: privacy.catalogUrl })} />
          </Field>
          <Button className="mt-3" size="sm" onClick={async () => { await api.clearLogs(); toast.push('success', 'Journaux effacés.'); }}>
            Effacer les journaux
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Protection de la clé" description={modeLabel} />
        <Divider />
        <div className="px-5 py-4">
          <p className="text-[0.86rem] text-[var(--color-ink-soft)]">
            Le profil, les mots de passe et le contenu des emails sont chiffrés en AES-256. La clé qui les protège peut
            elle-même être scellée par le trousseau de votre système, ou par une phrase secrète demandée à chaque
            démarrage.
          </p>

          {/* Une installation créée en ligne de commande reste en mode fichier
              même une fois ouverte depuis l'application de bureau. Le scellement
              n'est pas activé en douce: il rendrait la même installation
              illisible en ligne de commande. On le propose donc explicitement. */}
          {state.keyring.mode === 'plain' && state.keyring.osAvailable && (
            <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-[var(--color-warn-soft)] px-3.5 py-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-[0.85rem] text-[var(--color-warn)]">
                Votre clé est posée en clair à côté de vos données. Le trousseau de votre système peut la sceller, sans
                mot de passe à retenir.
              </p>
              <Button
                size="sm"
                variant="primary"
                className="shrink-0"
                icon={<KeyRound size={15} />}
                onClick={async () => {
                  try {
                    await api.setSecurityMode('os');
                    toast.push('success', 'Clé scellée par le système.');
                    await queryClient.invalidateQueries({ queryKey: ['state'] });
                  } catch (err) {
                    toast.push('error', String((err as Error).message));
                  }
                }}
              >
                Sceller la clé
              </Button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {state.keyring.mode !== 'passphrase' ? (
              <div className="flex w-full flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <Field label="Nouvelle phrase secrète" hint="8 caractères minimum. Elle ne peut pas être récupérée si vous l'oubliez.">
                    <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  </Field>
                </div>
                <Button
                  icon={<KeyRound size={15} />}
                  disabled={passphrase.length < 8}
                  onClick={async () => {
                    try {
                      await api.setSecurityMode('passphrase', passphrase);
                      toast.push('success', 'Phrase secrète activée.');
                      setPassphrase('');
                      await queryClient.invalidateQueries({ queryKey: ['state'] });
                    } catch (err) {
                      toast.push('error', String((err as Error).message));
                    }
                  }}
                >
                  Activer
                </Button>
              </div>
            ) : (
              <Button
                onClick={async () => {
                  await api.setSecurityMode(state.keyring.osAvailable ? 'os' : 'plain');
                  toast.push('info', 'Phrase secrète désactivée.');
                  await queryClient.invalidateQueries({ queryKey: ['state'] });
                }}
              >
                Désactiver la phrase secrète
              </Button>
            )}
            <Button
              onClick={async () => {
                const { key } = await api.exportKey();
                setShowKey(key);
              }}
            >
              Afficher la clé de secours
            </Button>
          </div>
        </div>
      </Card>

      <Modal open={showKey != null} onClose={() => setShowKey(null)} title="Clé de secours">
        <p className="text-[0.86rem] text-[var(--color-ink-soft)]">
          Conservez cette clé hors ligne. Elle permet de rouvrir vos données si vous changez d'ordinateur ou si le
          scellement système devient inutilisable. Toute personne qui la détient peut lire vos données.
        </p>
        <pre className="mt-3 break-all rounded-lg bg-[var(--color-surface-sunk)] p-3 font-mono text-[0.8rem]">{showKey}</pre>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DataSection() {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Exporter" description="Un fichier lisible sans l'application, avec l'intégralité des demandes, des échanges et des dates." />
        <Divider />
        <div className="px-5 py-4">
          <a href="/api/export" download className="btn btn-secondary">
            <Download size={15} /> Télécharger le dossier complet
          </a>
          <p className="mt-2 text-[0.83rem] text-[var(--color-ink-soft)]">
            Ce fichier constitue votre preuve en cas de plainte auprès d'une autorité de protection des donnees.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Tout effacer" description="Supprime le profil, les demandes, les échanges et les preuves de cet ordinateur." />
        <Divider />
        <div className="px-5 py-4">
          <div className="flex items-start gap-2.5 text-[0.85rem] text-[var(--color-ink-soft)]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
            <p>
              Les demandes deja envoyees restent valables: les courtiers doivent y repondre. Vous perdrez simplement le
              suivi et les preuves conservees ici.
            </p>
          </div>
          <Button variant="danger" className="mt-3" icon={<Trash2 size={15} />} onClick={() => setConfirming(true)}>
            Effacer toutes mes donnees
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Contribuer" description="Le catalogue vit grace aux signalements: un courtier manquant, une adresse qui rebondit, un formulaire modifié." />
        <Divider />
        <div className="px-5 py-4">
          <a href="https://github.com/RDSV01/RemoveBroker" target="_blank" rel="noreferrer" className="btn btn-secondary">
            Ouvrir le depot public <ExternalLink size={13} />
          </a>
        </div>
      </Card>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Effacer toutes les données"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.wipe();
                toast.push('info', 'Toutes les données ont été effacées.');
                window.location.reload();
              }}
            >
              Effacer definitivement
            </Button>
          </>
        }
      >
        <p className="text-[0.88rem]">
          Cette action est irreversible. Le profil, l'historique des demandes, les copies d'emails et les captures
          d'ecran seront supprimes de cet ordinateur.
        </p>
      </Modal>
    </div>
  );
}
