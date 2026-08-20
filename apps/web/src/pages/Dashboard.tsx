import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Inbox, Pause, Play, RefreshCw, Send, ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, CardHeader, Divider, Dot, EmptyState, Modal, Progress, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { STATUS_LABELS, STATUS_TONES, formatDate, plural, relativeTime } from '../lib/format';
import type { AppState, RequestRow } from '../lib/types';

/**
 * Tableau de bord.
 *
 * Une seule question doit trouver sa réponse en un coup d'oeil: ou en est la
 * suppression de mes données. Le reste est secondaire et se lit plus bas.
 */

export function Dashboard({ state }: { state: AppState }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const stats = state.requests;
  const catalog = state.catalog;
  const paused = state.queue?.paused ?? false;

  const { data: recent } = useQuery({
    queryKey: ['requests', 'recent'],
    queryFn: () => api.requests({ limit: 8 }),
  });

  const { data: actions } = useQuery({
    queryKey: ['requests', 'actions'],
    queryFn: () => api.requests({ status: 'action_required', limit: 5 }),
  });

  // Volontairement ce qui reste à partir, et non le total ni les demandes en
  // vol: une demande
  // qui attend une action de l'utilisateur n'est pas programmée, et la compter
  // ici laissait croire qu'un formulaire allait partir tout seul.
  const waiting = stats?.pendingSend ?? 0;
  const contacted = stats?.total ?? 0;
  const sent = stats?.sent ?? 0;
  // « Supprimées » ne compte que les suppressions confirmées. Les réponses
  // « nous ne détenons rien sur vous » closent la demande sans qu'aucune donnée
  // n'ait été effacée: les additionner annonçait des suppressions qui n'ont pas
  // eu lieu, ce qui est exactement ce que cet outil doit éviter.
  const removed = stats?.byStatus.completed ?? 0;
  const noData = stats?.byStatus.no_data ?? 0;
  const closed = removed + noData;
  const needsYou = stats?.actionRequired ?? 0;
  const unreachable = stats?.byStatus.unreachable ?? 0;
  const mailReady = state.settings?.smtp.verified ?? false;

  async function toggleQueue() {
    if (paused) await api.resumeQueue();
    else await api.pauseQueue();
    await queryClient.invalidateQueries({ queryKey: ['state'] });
  }

  async function checkInbox() {
    try {
      const result = await api.pollInbox();
      toast.push('info', result.matched > 0
        ? `${plural(result.matched, 'réponse')} rattachée${result.matched > 1 ? 's' : ''} sur ${result.scanned} message${result.scanned > 1 ? 's' : ''} lus.`
        : `Aucune nouvelle réponse (${result.scanned} message${result.scanned > 1 ? 's' : ''} examinés).`);
      await queryClient.invalidateQueries({ queryKey: ['state'] });
    } catch (err) {
      toast.push('error', String((err as Error).message));
    }
  }

  return (
    <>
      <PageHeader
        title={`Bonjour ${state.profile?.firstName ?? ''}`.trim()}
        description="État de la suppression de vos données personnelles."
        action={
          <div className="flex gap-2">
            <Button onClick={checkInbox} icon={<Inbox size={15} />} size="sm">Relever les réponses</Button>
            <Button onClick={toggleQueue} icon={paused ? <Play size={15} /> : <Pause size={15} />} size="sm">
              {paused ? 'Reprendre' : 'Suspendre'}
            </Button>
          </div>
        }
      />

      {/* Sur mobile le bouton passe sous le texte: garder les deux sur une même
          ligne écraserait le message en colonne de deux mots. */}
      {!mailReady && (
        <div className="card mb-5 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[0.89rem] font-medium">Votre messagerie n'est pas encore connectée</p>
              <p className="text-[0.84rem] text-[var(--color-ink-soft)]">
                Les demandes sont préparées mais ne peuvent pas partir tant qu'aucun serveur d'envoi n'est configuré.
              </p>
            </div>
          </div>
          <Link to="/parametres" className="btn btn-primary btn-sm shrink-0">Connecter la messagerie</Link>
        </div>
      )}

      {contacted === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck size={26} />}
            title="Aucune demande envoyée pour le moment"
            description={`${(catalog?.reachable ?? 0).toLocaleString('fr-FR')} courtiers peuvent être contactés dès maintenant, dont ${catalog?.franceReachable ?? 0} en France. Lancez une campagne pour commencer la suppression.`}
            action={<Link to="/courtiers" className="btn btn-primary">Choisir les courtiers</Link>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="px-5 pb-5 pt-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[0.82rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Progression</p>
                <p className="tnum mt-1 text-[2.4rem] font-semibold leading-none tracking-tight">{stats?.progress ?? 0}%</p>
                <p className="mt-2 max-w-md text-[0.88rem] text-[var(--color-ink-soft)]">
                  {closed > 0
                    ? [
                      removed > 0 ? `${plural(removed, 'courtier')} ont confirmé la suppression` : '',
                      noData > 0 ? `${plural(noData, 'courtier')} ne détenaient rien sur vous` : '',
                    ].filter(Boolean).join(', ') + '.'
                    : 'Les premières réponses arrivent généralement sous 48 heures.'}
                </p>
                <p className="mt-1 text-[0.82rem] text-[var(--color-ink-faint)]">
                  {plural(contacted, 'demande')} au total.
                </p>
                {/* Dit une fois, sans rien demander: ces sociétés ne publient
                    aucun contact, l'application a cherché, et il n'y a pas
                    d'action à proposer. Les ranger parmi les actions requises
                    en présentait des centaines d'impossibles à traiter. */}
                {unreachable > 0 && (
                  <p className="mt-1 text-[0.82rem] text-[var(--color-ink-faint)]">
                    <Link to="/demandes?status=unreachable" className="underline underline-offset-2">
                      {plural(unreachable, 'société')}
                    </Link>{' '}
                    ne {unreachable > 1 ? 'publient' : 'publie'} aucun moyen de contact. Rien à faire de votre côté.
                  </p>
                )}
              </div>
              {paused && <Badge tone="warn">Envois suspendus</Badge>}
            </div>
            <Progress value={stats?.progress ?? 0} tone="ok" className="mt-5" />
          </div>

          <Divider />

          <dl className="grid grid-cols-2 md:grid-cols-5">
            <Metric icon={Clock} label="En attente d'envoi" value={waiting} />
            <Metric icon={Send} label="Envoyées" value={sent} />
            <Metric icon={CheckCircle2} label="Suppressions confirmées" value={removed} tone="ok" />
            <Metric icon={ShieldCheck} label="Sans donnée sur vous" value={noData} />
            <Metric icon={AlertTriangle} label="Action requise" value={needsYou} tone={needsYou > 0 ? 'warn' : 'neutral'} last />
          </dl>
        </Card>
      )}

      {needsYou > 0 && (
        <Card className="mt-5">
          <CardHeader
            title="Ces demandes attendent votre intervention"
            description="Un courtier exige une étape que la loi ne permet pas d'automatiser: un captcha, une pièce d'identité ou son propre formulaire."
            action={<Link to="/demandes?status=action_required" className="btn btn-secondary btn-sm">Tout voir</Link>}
          />
          <Divider />
          <ul>
            {(actions?.rows ?? []).map((request, index) => (
              <li key={request.id}>
                {index > 0 && <Divider />}
                <RequestLine request={request} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Activité récente"
            action={<Link to="/demandes" className="btn btn-ghost btn-sm">Historique complet<ArrowRight size={14} /></Link>}
          />
          <Divider />
          {recent?.rows.length ? (
            <ul>
              {recent.rows.map((request, index) => (
                <li key={request.id}>
                  {index > 0 && <Divider />}
                  <RequestLine request={request} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Rien à afficher" description="Les demandes apparaîtront ici dès le premier envoi." />
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Catalogue" description="Sociétés françaises et européennes soumises au RGPD, mis à jour chaque semaine." />
            <Divider />
            <div className="px-5 py-4">
              {/* Le nombre utile est celui des courtiers à qui une demande peut
                  effectivement partir, pas le total répertorié. */}
              <p className="tnum text-[1.7rem] font-semibold leading-none tracking-tight">
                {(catalog?.reachable ?? 0).toLocaleString('fr-FR')}
              </p>
              <p className="mt-1 text-[0.85rem] text-[var(--color-ink-soft)]">courtiers joignables</p>

              <dl className="mt-4 flex flex-col gap-2 text-[0.85rem]">
                <Row label="Par email" value={(catalog?.withEmail ?? 0).toLocaleString('fr-FR')} />
                <Row label="Par formulaire" value={(catalog?.withForm ?? 0).toLocaleString('fr-FR')} />
                <Row label="Sociétés françaises" value={(catalog?.franceReachable ?? 0).toLocaleString('fr-FR')} />
                <Row label="Contact encore à trouver" value={(catalog?.needsDiscovery ?? 0).toLocaleString('fr-FR')} />
                <Row label="Dernière vérification" value={catalog?.checkedAt ? formatDate(catalog.checkedAt) : 'jamais'} />
                {/* L'empreinte publiée avec le catalogue est comparée au fichier
                    reçu. Le dire permet de constater que le contrôle a bien eu
                    lieu, au lieu de devoir croire la documentation sur parole. */}
                {catalog?.checkedAt && (
                  <Row
                    label="Empreinte SHA256"
                    value={catalog.verified ? 'vérifiée' : 'non publiée'}
                  />
                )}
              </dl>

              <FullCampaignButton />

              <Button
                className="mt-2 w-full"
                icon={<RefreshCw size={15} />}
                onClick={async () => {
                  const result = await api.updateCatalog();
                  toast.push(result.updated ? 'success' : 'warn', result.message);
                  await queryClient.invalidateQueries({ queryKey: ['state'] });
                }}
              >
                Vérifier les nouveaux courtiers
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Confidentialité" />
            <Divider />
            <ul className="flex flex-col gap-2.5 px-5 py-4 text-[0.85rem] text-[var(--color-ink-soft)]">
              <li className="flex items-start gap-2"><Dot tone="ok" /><span className="-mt-0.5">Profil et emails chiffrés sur cet ordinateur</span></li>
              <li className="flex items-start gap-2"><Dot tone="ok" /><span className="-mt-0.5">Aucune donnée envoyée à un serveur tiers</span></li>
              <li className="flex items-start gap-2"><Dot tone="ok" /><span className="-mt-0.5">Aucune mesure d'audience, aucun compte</span></li>
              <li className="flex items-start gap-2">
                <Dot tone={state.browser?.available ? 'ok' : 'neutral'} />
                <span className="-mt-0.5">
                  Automatisation des formulaires : {state.browser?.available ? state.browser.source : 'navigateur non détecté'}
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Metric({ icon: Icon, label, value, tone = 'neutral', last }: {
  icon: typeof Send;
  label: string;
  value: number;
  tone?: 'neutral' | 'ok' | 'warn';
  last?: boolean;
}) {
  const color = tone === 'ok' ? 'var(--color-ok)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-ink)';
  return (
    <div className={`px-5 py-4 ${last ? '' : 'border-r border-[var(--color-line)]'} border-b border-[var(--color-line)] last:border-b-0 md:border-b-0`}>
      <div className="flex items-center gap-1.5 text-[0.8rem] text-[var(--color-ink-faint)]">
        <Icon size={13} />
        {label}
      </div>
      <p className="tnum mt-1 text-[1.5rem] font-semibold leading-none tracking-tight" style={{ color }}>
        {value.toLocaleString('fr-FR')}
      </p>
    </div>
  );
}

/**
 * Lance une campagne sur l'ensemble du catalogue.
 *
 * Nécessaire parce que le choix fait au premier lancement était définitif: qui
 * avait commencé par une sélection restreinte n'avait plus aucun moyen d'écrire
 * à tous les courtiers. Le nombre exact est annoncé avant confirmation, car
 * l'opération engage plusieurs jours d'envois.
 */
function FullCampaignButton() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState<{ total: number; estimatedDays: number } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        variant="primary"
        className="mt-4 w-full"
        icon={<Send size={15} />}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setPreview(await api.previewCampaign({ scope: 'all' }));
          } catch (err) {
            toast.push('error', String((err as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        Écrire à tous les courtiers
      </Button>

      <Modal
        open={preview != null}
        onClose={() => setPreview(null)}
        title="Écrire à tous les courtiers"
        footer={
          <>
            <Button size="sm" onClick={() => setPreview(null)}>Annuler</Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await api.createCampaign({ scope: 'all' });
                  toast.push('success', `${result.total.toLocaleString('fr-FR')} nouvelles demandes programmées.`);
                  setPreview(null);
                  await queryClient.invalidateQueries({ queryKey: ['state'] });
                  await queryClient.invalidateQueries({ queryKey: ['requests'] });
                } catch (err) {
                  toast.push('error', String((err as Error).message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Lancer la campagne
            </Button>
          </>
        }
      >
        <p className="text-[0.88rem] leading-relaxed text-[var(--color-ink-soft)]">
          {preview?.total.toLocaleString('fr-FR')} demandes seront créées, étalées sur environ{' '}
          {preview && preview.estimatedDays > 1 ? `${preview.estimatedDays} jours` : 'une journée'} pour ne pas faire
          suspendre votre boîte email.
        </p>
        <p className="mt-2 text-[0.85rem] text-[var(--color-ink-soft)]">
          Les courtiers déjà contactés sont ignorés: seules les sociétés qui n&apos;ont pas encore reçu de demande
          seront ajoutées. Vous pouvez suspendre les envois à tout moment.
        </p>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}

export function RequestLine({ request }: { request: RequestRow }) {
  return (
    <Link to={`/demandes/${request.id}`} className="row-hover flex items-center gap-3 px-5 py-2.5">
      <Dot tone={STATUS_TONES[request.status]} />
      <span className="min-w-0 flex-1 truncate text-[0.89rem] font-medium">{request.broker_name}</span>
      <Badge tone={STATUS_TONES[request.status]}>{STATUS_LABELS[request.status]}</Badge>
      <span className="hidden w-24 shrink-0 text-right text-[0.8rem] text-[var(--color-ink-faint)] sm:block">
        {relativeTime(request.updated_at)}
      </span>
    </Link>
  );
}
