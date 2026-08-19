import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, EyeOff, ExternalLink, Globe, Mail, Play, Plus, Search, Send, Wand2, X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge, Button, Card, Divider, Dot, EmptyState, Field, Input, Modal, Select, Spinner, Segmented, useToast,
} from '../components/ui';
import { PageHeader } from '../components/Layout';
import { CATEGORY_LABELS, METHOD_LABELS, REGION_LABELS, STATUS_LABELS, STATUS_TONES, formatDate, plural } from '../lib/format';
import type { AppState, Broker } from '../lib/types';

/**
 * Liste des courtiers.
 *
 * Le catalogue dépassé le millier d'entrées: la recherche et les filtres sont
 * donc prioritaires sur l'affichage. La sélection multiple permet de lancer une
 * campagne ciblée sans quitter la page.
 */

const PAGE_SIZE = 50;

export function Brokers({ state }: { state: AppState }) {
  const autoForms = state.settings?.automation.autoSubmitForms ?? false;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Broker | null>(null);
  const [adding, setAdding] = useState(false);
  const [launching, setLaunching] = useState(false);
  // Vrai quand la derniere tentative n a rien cree parce que les demandes
  // etaient deja ouvertes: le seul cas ou un renvoi force a du sens.
  const [resendable, setResendable] = useState(false);

  const params = useMemo(() => ({
    search, categories: category, methods: method,
    // "eu" est un filtre de pertinence, pas une zone géographique: il retient
    // les courtiers qui détiennent des données de personnes résidant en Europe,
    // y compris des sociétés américaines soumises au RGPD.
    ...(region === 'eu-relevant' ? { eu: 'true' } : { regions: region }),
    limit: PAGE_SIZE, offset: page * PAGE_SIZE,
  }), [search, category, region, method, page]);

  const { data, isFetching } = useQuery({
    queryKey: ['brokers', params],
    queryFn: () => api.brokers(params),
    placeholderData: (previous) => previous,
  });

  const brokers = data?.brokers ?? [];
  const total = data?.total ?? 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function launchSelection(force = false) {
    setLaunching(true);
    try {
      const result = await api.createCampaign({ scope: 'selection', brokerIds: [...selected], force });
      const { alreadyOpen, noContact } = result.skippedReasons;

      // Dire ce qui part seul et ce qui attend l'utilisateur: un courtier sans
      // adresse email ni recette d'automatisation reste à faire à la main, et
      // rien d'autre dans l'interface ne le signale au moment du lancement.
      const parts = [
        result.byMethod.email && `${result.byMethod.email} par email`,
        result.byMethod.recipe && `${result.byMethod.recipe} par formulaire automatisé`,
        // Le libellé suit le réglage: avec la soumission automatique, ces
        // demandes ne reviennent à l'utilisateur qu'en cas de blocage.
        result.byMethod.form && (autoForms
          ? `${result.byMethod.form} par formulaire, soumis automatiquement`
          : `${result.byMethod.form} à remplir vous-même`),
        // Sans contact connu, l'application lit d'abord la politique de
        // confidentialité de la société. Le dire évite de laisser croire à un
        // envoi immédiat qui n'aura pas lieu.
        result.byMethod.discovery && `${result.byMethod.discovery} après recherche du contact`,
      ].filter(Boolean).join(', ');

      // Les deux causes d'écart appellent des suites opposées: une demande déjà
      // ouverte se consulte, un courtier sans contact ne pourra jamais rien
      // recevoir. Les annoncer ensemble laissait l'utilisateur sans réponse.
      const details = [
        alreadyOpen && `${plural(alreadyOpen, 'courtier')} ${alreadyOpen > 1 ? 'ont' : 'a'} déjà une demande en cours`,
        noContact && `${plural(noContact, 'courtier')} ne publie${noContact > 1 ? 'nt' : ''} aucun moyen de contact`,
      ].filter(Boolean).join(', ');

      if (result.total === 0) {
        toast.push('info', `Aucune nouvelle demande: ${details}.`);
        // La sélection est conservée: le bouton de renvoi porte dessus.
        setResendable(alreadyOpen > 0 && noContact === 0);
      } else {
        toast.push(
          result.byMethod.form || result.skipped ? 'info' : 'success',
          `${plural(result.total, 'demande')} programmée${result.total > 1 ? 's' : ''}${parts ? ` : ${parts}` : ''}.${details ? ` ${details}.` : ''}`,
        );
        setSelected(new Set());
        setResendable(false);
      }

      await queryClient.invalidateQueries({ queryKey: ['state'] });
      await queryClient.invalidateQueries({ queryKey: ['brokers'] });
    } catch (err) {
      toast.push('error', String((err as Error).message));
    } finally {
      setLaunching(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Courtiers en données"
        description={`${(state.catalog?.total ?? 0).toLocaleString('fr-FR')} sociétés répertoriées, dont ${(state.catalog?.withEmail ?? 0).toLocaleString('fr-FR')} contactables par email.`}
        action={<Button icon={<Plus size={15} />} onClick={() => setAdding(true)}>Ajouter un courtier</Button>}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Rechercher un courtier"
              className="pl-9"
              aria-label="Rechercher un courtier"
            />
          </div>
          <div className="flex gap-2">
            <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} className="w-auto" aria-label="Catégorie">
              <option value="">Toutes catégories</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Select value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }} className="w-auto" aria-label="Région">
              <option value="">Toutes zones</option>
              <option value="eu-relevant">Concerne l'Europe</option>
              {Object.entries(REGION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>
        </div>

        <Divider />

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <Segmented
            value={method}
            onChange={(value) => { setMethod(value); setPage(0); }}
            options={[
              { value: '', label: 'Tous' },
              { value: 'email', label: 'Email' },
              { value: 'recipe', label: 'Formulaire automatisé' },
              { value: 'form', label: 'Formulaire manuel' },
            ]}
          />
          <span className="tnum text-[0.82rem] text-[var(--color-ink-faint)]">
            {isFetching ? <Spinner size={13} /> : `${total.toLocaleString('fr-FR')} résultats`}
          </span>
        </div>

        <Divider />

        {brokers.length === 0 ? (
          <EmptyState title="Aucun courtier ne correspond" description="Modifiez la recherche ou les filtres." />
        ) : (
          <ul>
            {brokers.map((broker, index) => (
              <li key={broker.id}>
                {index > 0 && <Divider />}
                <BrokerRow
                  broker={broker}
                  selected={selected.has(broker.id)}
                  onToggle={() => toggle(broker.id)}
                  onOpen={() => setDetail(broker)}
                />
              </li>
            ))}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <>
            <Divider />
            <div className="flex items-center justify-between px-4 py-2.5">
              <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
              <span className="tnum text-[0.82rem] text-[var(--color-ink-faint)]">
                {page * PAGE_SIZE + 1} a {Math.min(total, (page + 1) * PAGE_SIZE)} sur {total.toLocaleString('fr-FR')}
              </span>
              <Button size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
            </div>
          </>
        )}
      </Card>

      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 md:bottom-6">
          <div className="card animate-in flex items-center gap-3 px-3 py-2 shadow-lg">
            <span className="tnum text-[0.87rem] font-medium">{plural(selected.size, 'courtier')} selectionne{selected.size > 1 ? 's' : ''}</span>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => { setSelected(new Set()); setResendable(false); }}>Annuler</Button>
            <Button size="sm" variant="primary" icon={<Play size={14} />} loading={launching} onClick={() => launchSelection(resendable)}>
              {resendable ? 'Renvoyer quand même' : 'Envoyer les demandes'}
            </Button>
          </div>
        </div>
      )}

      <BrokerDetail broker={detail} onClose={() => setDetail(null)} />
      <AddBrokerModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function BrokerRow({ broker, selected, onToggle, onOpen }: {
  broker: Broker;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const status = broker.request?.status;
  return (
    <div className="row-hover flex items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        aria-label={`Sélectionner ${broker.name}`}
      />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.9rem] font-medium">{broker.name}</span>
            {broker.custom && <Badge tone="accent">Ajouté</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[0.8rem] text-[var(--color-ink-faint)]">
            <span className="truncate">{broker.domain ?? '-'}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{CATEGORY_LABELS[broker.category]}</span>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {broker.methods.includes('recipe') && <Badge tone="accent"><Wand2 size={11} /> Auto</Badge>}
          {broker.methods.includes('email') && !broker.methods.includes('recipe') && <Badge><Mail size={11} /> Email</Badge>}
          {!broker.email && !broker.methods.includes('recipe') && <Badge><Globe size={11} /> Formulaire</Badge>}
        </div>
        <div className="w-32 shrink-0 text-right">
          {status ? (
            <span className="inline-flex items-center gap-1.5">
              <Dot tone={STATUS_TONES[status]} />
              <span className="text-[0.8rem] text-[var(--color-ink-soft)]">{STATUS_LABELS[status]}</span>
            </span>
          ) : (
            <span className="text-[0.8rem] text-[var(--color-ink-faint)]">Non contacté</span>
          )}
        </div>
      </button>
    </div>
  );
}

function BrokerDetail({ broker, onClose }: { broker: Broker | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState<{
    subject: string;
    text: string;
    to?: string;
    via: 'email' | 'recipe' | 'form' | 'discovery';
  } | null>(null);

  const { data } = useQuery({
    queryKey: ['broker', broker?.id],
    queryFn: () => api.broker(broker!.id),
    enabled: Boolean(broker),
  });

  if (!broker) return null;

  return (
    <Modal
      open
      onClose={() => { setPreview(null); onClose(); }}
      title={broker.name}
      wide
      footer={
        <>
          <Button
            icon={<EyeOff size={15} />}
            onClick={async () => {
              await api.setBrokerState(broker.id, { hidden: true });
              toast.push('info', `${broker.name} ne sera plus contacté.`);
              await queryClient.invalidateQueries({ queryKey: ['brokers'] });
              onClose();
            }}
          >
            Ignorer ce courtier
          </Button>
          <Button
            variant="primary"
            icon={<Send size={15} />}
            onClick={async () => {
              try {
                const result = await api.createCampaign({ scope: 'selection', brokerIds: [broker.id], force: true });
                toast.push('success', result.total ? 'Demande programmée.' : 'Aucune demande à envoyer pour ce courtier.');
                await queryClient.invalidateQueries({ queryKey: ['state'] });
                onClose();
              } catch (err) {
                toast.push('error', String((err as Error).message));
              }
            }}
          >
            Envoyer la demande
          </Button>
        </>
      }
    >
      {broker.description && <p className="text-[0.88rem] leading-relaxed text-[var(--color-ink-soft)]">{broker.description}</p>}

      <dl className="mt-4 grid gap-x-6 gap-y-2.5 text-[0.87rem] sm:grid-cols-2">
        <Info label="Catégorie" value={CATEGORY_LABELS[broker.category]} />
        <Info label="Régions" value={broker.regions.map((r) => REGION_LABELS[r] ?? r).join(', ')} />
        <Info label="Méthodes" value={broker.methods.map((m) => METHOD_LABELS[m]).join(', ')} />
        <Info label="Contact" value={broker.email ?? 'aucune adresse connue'} />
        <Info label="Ajouté au catalogue" value={formatDate(broker.firstSeen)} />
        <Info label="Sources" value={broker.sources.join(', ')} />
        {broker.aliases?.length ? (
          <div className="sm:col-span-2">
            <Info label="Exploite aussi" value={broker.aliases.join(', ')} />
          </div>
        ) : null}
      </dl>

      {broker.registeredCA && (
        <p className="mt-4 rounded-lg bg-[var(--color-ok-soft)] px-3 py-2 text-[0.84rem] text-[var(--color-ok)]">
          Inscrit au registre officiel des courtiers en donnees de Californie: repondre a votre demande est une obligation legale.
        </p>
      )}
      {broker.requiresId && (
        <p className="mt-3 rounded-lg bg-[var(--color-warn-soft)] px-3 py-2 text-[0.84rem] text-[var(--color-warn)]">
          Ce courtier demande generalement une piece d'identite. Vous serez averti au moment ou il la reclame.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {broker.website && (
          <a href={broker.website} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            <Globe size={14} /> Site du courtier <ExternalLink size={12} />
          </a>
        )}
        {broker.optOutUrl && (
          <a href={broker.optOutUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Page d'opt-out <ExternalLink size={12} />
          </a>
        )}
        {broker.guideUrl && (
          <a href={broker.guideUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            <BookOpen size={14} /> Guide pas à pas <ExternalLink size={12} />
          </a>
        )}
        {broker.email && (
          <Button
            size="sm"
            icon={<Mail size={14} />}
            onClick={async () => {
              try {
                setPreview(await api.previewMail(broker.id));
              } catch (err) {
                toast.push('error', String((err as Error).message));
              }
            }}
          >
            Voir le message envoye
          </Button>
        )}
      </div>

      {preview && (
        <div className="mt-4">
          <Divider />
          <p className="mt-3 text-[0.8rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Aperçu du message</p>
          {/* Sans adresse, afficher « A : » suivi du vide laisserait croire a un
              envoi. Le texte reste utile: c'est ce qui sera porte au formulaire. */}
          <p className="mt-1.5 text-[0.85rem]">
            <span className="text-[var(--color-ink-faint)]">A :</span>{' '}
            {preview.to ?? (preview.via === 'discovery'
              ? 'adresse à rechercher sur le site du courtier'
              : 'formulaire en ligne du courtier, ce texte y sera repris')}
          </p>
          <p className="text-[0.85rem]"><span className="text-[var(--color-ink-faint)]">Objet :</span> {preview.subject}</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-sunk)] p-3 font-mono text-[0.78rem] leading-relaxed">
            {preview.text}
          </pre>
        </div>
      )}

      {data?.requests?.length ? (
        <div className="mt-4">
          <Divider />
          <p className="mt-3 text-[0.8rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Demandes</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {data.requests.map((request) => (
              <li key={request.id} className="flex items-center gap-2 text-[0.85rem]">
                <Dot tone={STATUS_TONES[request.status]} />
                {STATUS_LABELS[request.status]}
                <span className="text-[var(--color-ink-faint)]">· {formatDate(request.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.78rem] text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function AddBrokerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', website: '', email: '', optOutUrl: '', category: 'other', notes: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.addBroker({
        name: form.name,
        website: form.website || undefined,
        domain: form.website ? form.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : undefined,
        email: form.email || undefined,
        optOutUrl: form.optOutUrl || undefined,
        category: form.category,
        notes: form.notes || undefined,
      });
      toast.push('success', 'Courtier ajoute au catalogue local.');
      await queryClient.invalidateQueries({ queryKey: ['brokers'] });
      setForm({ name: '', website: '', email: '', optOutUrl: '', category: 'other', notes: '' });
      onClose();
    } catch (err) {
      toast.push('error', String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter un courtier"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!form.name}>Ajouter</Button>
        </>
      }
    >
      <p className="mb-4 text-[0.86rem] text-[var(--color-ink-soft)]">
        Ajoutez une societe absente du catalogue. Elle reste sur cet ordinateur. Pour qu'elle profite a tout le monde,
        proposez-la aussi au depot public via une contribution.
      </p>
      <div className="flex flex-col gap-4">
        <Field label="Nom" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Exemple Data SAS" />
        </Field>
        <Field label="Site web">
          <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://exemple.fr" />
        </Field>
        <Field label="Adresse email de contact" hint="Sans adresse, la demande ne pourra pas être envoyée automatiquement.">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="dpo@exemple.fr" />
        </Field>
        <Field label="Page d'opt-out">
          <Input value={form.optOutUrl} onChange={(e) => setForm({ ...form, optOutUrl: e.target.value })} placeholder="https://exemple.fr/vos-droits" />
        </Field>
        <Field label="Catégorie">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
