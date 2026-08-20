import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Check, Copy, Download, ExternalLink, Gavel, PenLine, RotateCw, Search, SkipForward,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge, Button, Card, Divider, Dot, EmptyState, Input, Modal, Segmented, Spinner, useToast,
} from '../components/ui';
import { PageHeader } from '../components/Layout';
import {
  CLASSIFICATION_LABELS, METHOD_LABELS, STATUS_LABELS, STATUS_TONES,
  formatDate, formatDateTime, plural, relativeTime,
} from '../lib/format';
import type { RequestDetail, RequestRow, RequestStatus } from '../lib/types';

/**
 * Historique des demandes.
 *
 * Chaque demande est une petite procédure juridique: date d'envoi, délai légal,
 * échanges, preuves. La vue détaillée doit permettre de tout exporter en cas de
 * plainte a l'autorité de contrôle.
 */

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Toutes' },
  { value: 'action_required', label: 'Action requise' },
  { value: 'sent,awaiting_reply,confirmed,in_progress,queued', label: 'En cours' },
  { value: 'completed,no_data', label: 'Terminées' },
  { value: 'rejected,failed', label: 'Problèmes' },
  // Séparées des actions: rien à y faire, mais elles restent consultables et
  // exportables, le défaut de contact étant lui-même opposable à la CNIL.
  { value: 'unreachable', label: 'Injoignables' },
];

export function Requests() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const fromUrl = searchParams.get('status');
    if (fromUrl) setStatus(fromUrl);
  }, [searchParams]);

  const { data, isFetching } = useQuery({
    queryKey: ['requests', { status, search, page }],
    queryFn: () => api.requests({ status, search, limit: 50, offset: page * 50 }),
    placeholderData: (previous) => previous,
  });

  const stats = data?.stats;

  return (
    <>
      <PageHeader
        title="Demandes"
        description={stats ? `${stats.done} terminées, ${stats.inFlight} en cours, ${stats.actionRequired} en attente de vous.` : undefined}
        action={
          <a href="/api/export" className="btn btn-secondary btn-sm" download>
            <Download size={15} /> Exporter le dossier
          </a>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented value={status} onChange={(value) => { setStatus(value); setPage(0); }} options={FILTERS} />
          <div className="relative sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Filtrer par courtier"
              className="pl-9"
              aria-label="Filtrer par courtier"
            />
          </div>
        </div>

        <Divider />

        {isFetching && !data ? (
          <div className="flex justify-center py-12"><Spinner size={20} /></div>
        ) : data?.rows.length ? (
          <ul>
            {data.rows.map((request, index) => (
              <li key={request.id}>
                {index > 0 && <Divider />}
                <RequestRowItem request={request} onOpen={() => navigate(`/demandes/${request.id}`)} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Aucune demande" description="Lancez une campagne depuis la page Courtiers." />
        )}

        {(data?.total ?? 0) > 50 && (
          <>
            <Divider />
            <div className="flex items-center justify-between px-4 py-2.5">
              <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
              <span className="tnum text-[0.82rem] text-[var(--color-ink-faint)]">
                {page * 50 + 1} a {Math.min(data!.total, (page + 1) * 50)} sur {data!.total}
              </span>
              <Button size="sm" disabled={(page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
            </div>
          </>
        )}
      </Card>

      {id && <RequestDetailModal id={id} onClose={() => navigate('/demandes')} />}
    </>
  );
}

function RequestRowItem({ request, onOpen }: { request: RequestRow; onOpen: () => void }) {
  // Un délai légal n'a de sens que si la demande est partie. Une société
  // injoignable n'a jamais reçu de courrier: annoncer « délai dépassé »
  // laisserait croire à un silence coupable qui n'existe pas.
  const overdue = request.deadline_at
    && new Date(request.deadline_at) < new Date()
    && !['completed', 'no_data', 'rejected', 'skipped', 'unreachable'].includes(request.status);

  return (
    <button type="button" onClick={onOpen} className="row-hover flex w-full items-center gap-3 px-4 py-3 text-left">
      <Dot tone={STATUS_TONES[request.status]} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.9rem] font-medium">{request.broker_name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8rem] text-[var(--color-ink-faint)]">
          <span>{METHOD_LABELS[request.method]}</span>
          <span aria-hidden>·</span>
          <span>{request.sent_at ? `Envoyée ${relativeTime(request.sent_at)}` : 'Pas encore envoyée'}</span>
          {overdue && (
            <>
              <span aria-hidden>·</span>
              <span className="text-[var(--color-warn)]">Délai légal dépassé</span>
            </>
          )}
        </div>
      </div>
      <Badge tone={STATUS_TONES[request.status]}>{STATUS_LABELS[request.status]}</Badge>
    </button>
  );
}

function RequestDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [complaint, setComplaint] = useState<{ text: string; authority: { name: string; url: string } } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['request', id], queryFn: () => api.request(id) });

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast.push('success', message);
      await queryClient.invalidateQueries({ queryKey: ['request', id] });
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      await queryClient.invalidateQueries({ queryKey: ['state'] });
    } catch (err) {
      toast.push('error', String((err as Error).message));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={data?.request.broker_name ?? 'Demande'}
      footer={
        data && (
          <>
            <Button size="sm" icon={<SkipForward size={14} />} onClick={() => act(() => api.resolveRequest(id, 'skipped'), 'Demande ignorée.')}>
              Ignorer
            </Button>
            <Button size="sm" icon={<RotateCw size={14} />} onClick={() => act(() => api.retryRequest(id), 'Nouvelle tentative programmée.')}>
              Reessayer
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Check size={14} />}
              onClick={() => act(() => api.resolveRequest(id, 'completed', 'Marquée comme traitée manuellement.'), 'Demande marquée comme traitée.')}
            >
              Marquer comme traitee
            </Button>
          </>
        )
      }
    >
      {isLoading || !data ? (
        <div className="flex justify-center py-10"><Spinner size={20} /></div>
      ) : (
        <RequestBody data={data} complaint={complaint} onComplaint={async () => {
          try {
            setComplaint(await api.complaint(id));
          } catch (err) {
            toast.push('error', String((err as Error).message));
          }
        }} />
      )}
    </Modal>
  );
}

function RequestBody({ data, complaint, onComplaint }: {
  data: RequestDetail;
  complaint: { text: string; authority: { name: string; url: string } } | null;
  onComplaint: () => void;
}) {
  const toast = useToast();
  const { request, broker, events, messages, artifacts } = data;
  // Le délai légal court à partir de la réception par le courtier. Sans envoi,
  // il n'a pas commencé: proposer une plainte pour non-réponse serait faux.
  const deadlinePassed = Boolean(request.deadline_at)
    && new Date(request.deadline_at!) < new Date()
    && request.status !== 'unreachable';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONES[request.status as RequestStatus]}>{STATUS_LABELS[request.status as RequestStatus]}</Badge>
        <Badge>{METHOD_LABELS[request.method]}</Badge>
        {request.legal_basis && <Badge>{request.legal_basis.toUpperCase()}</Badge>}
        <span className="text-[0.8rem] text-[var(--color-ink-faint)]">Reference RB-{request.token.toUpperCase()}</span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-[0.86rem] sm:grid-cols-3">
        <Info label="Envoyée le" value={formatDate(request.sent_at)} />
        <Info label="Délai légal" value={request.deadline_at ? formatDate(request.deadline_at) : '-'} tone={deadlinePassed ? 'warn' : undefined} />
        <Info label="Prochaine action" value={request.next_action_at ? formatDate(request.next_action_at) : 'aucune'} />
      </dl>

      {request.last_error && (
        <p className="mt-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-[0.84rem] text-[var(--color-danger)]">
          {request.last_error}
        </p>
      )}

      {deadlinePassed && !['completed', 'no_data'].includes(request.status) && (
        <div className="mt-3 rounded-lg bg-[var(--color-warn-soft)] px-3 py-2.5 text-[0.84rem] text-[var(--color-warn)]">
          <p className="font-medium">Le délai légal est dépassé.</p>
          <p className="mt-0.5">Vous pouvez saisir l'autorité de contrôle. RemoveBroker prépare le texte de la plainte.</p>
          <Button size="sm" className="mt-2" icon={<Gavel size={14} />} onClick={onComplaint}>Préparer la plainte</Button>
        </div>
      )}

      {complaint && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.8rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Plainte à déposer</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={<Copy size={13} />}
                onClick={() => {
                  void navigator.clipboard.writeText(complaint.text);
                  toast.push('success', 'Texte copie.');
                }}
              >
                Copier
              </Button>
              <a href={complaint.authority.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                {complaint.authority.name} <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-sunk)] p-3 font-mono text-[0.78rem] leading-relaxed">
            {complaint.text}
          </pre>
        </div>
      )}

      <Divider className="my-4" />

      <p className="text-[0.8rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Chronologie</p>
      <ol className="mt-2.5 flex flex-col gap-3">
        {events.map((event) => {
          const detail = parseDetail(event.detail);
          return (
            <li key={event.id} className="flex gap-3">
              <span className="mt-1.5"><Dot tone={toneForEvent(event.type)} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.87rem]">{event.summary}</p>
                <p className="mt-0.5 text-[0.78rem] text-[var(--color-ink-faint)]">{formatDateTime(event.at)}</p>
                {detail?.url && (
                  <a href={detail.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[0.8rem] font-medium text-[var(--color-accent)]">
                    Ouvrir la page <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {messages.length > 0 && (
        <>
          <Divider className="my-4" />
          <p className="text-[0.8rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Échanges</p>
          <ul className="mt-2.5 flex flex-col gap-3">
            {messages.map((message) => (
              <li key={message.id}>
                <div className="flex flex-wrap items-center gap-2 text-[0.82rem]">
                  <Badge tone={message.direction === 'out' ? 'info' : 'accent'}>
                    {message.direction === 'out' ? 'Envoye' : 'Recu'}
                  </Badge>
                  <span className="font-medium">{message.subject || '(sans objet)'}</span>
                  <span className="text-[var(--color-ink-faint)]">{formatDateTime(message.at)}</span>
                  {message.classification && (
                    <Badge>
                      {CLASSIFICATION_LABELS[message.classification] ?? message.classification}
                      {/* La confiance dit à quel point l'application s'engage:
                          une lecture certaine et une lecture hésitante ne
                          doivent pas s'afficher de la même façon. */}
                      {message.confidence != null && ` · ${Math.round(message.confidence * 100)} %`}
                    </Badge>
                  )}
                </div>
                {message.body && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[0.8rem] text-[var(--color-ink-soft)]">Voir le contenu</summary>
                    <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-sunk)] p-3 font-mono text-[0.76rem] leading-relaxed">
                      {message.body}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {artifacts.length > 0 && (
        <>
          <Divider className="my-4" />
          <p className="text-[0.8rem] uppercase tracking-wide text-[var(--color-ink-faint)]">Preuves</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {artifacts.map((artifact) => (
              <a key={artifact.id} href={`/api/evidence/${artifact.file}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-[var(--color-line)]">
                <img src={`/api/evidence/${artifact.file}`} alt={`Capture du ${formatDate(artifact.at)}`} className="aspect-video w-full object-cover object-top" loading="lazy" />
              </a>
            ))}
          </div>
        </>
      )}

      {broker?.optOutUrl ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <AssistButton requestId={data.request.id} />
          <a href={broker.optOutUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Ouvrir sans remplir <ExternalLink size={12} />
          </a>
        </div>
      ) : broker?.privacyUrl ? (
        // Ce courtier ne publie pas de formulaire connu. Plutôt qu'un bouton qui
        // ouvrirait une page sans rien à remplir, on dit ce qu'il en est.
        <div className="mt-4">
          <p className="text-[0.85rem] text-[var(--color-ink-soft)]">
            Aucun formulaire d&apos;opt-out connu chez ce courtier. Sa politique de confidentialité indique en général
            l&apos;adresse ou la procédure à suivre.
          </p>
          <a href={broker.privacyUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm mt-2">
            Politique de confidentialité <ExternalLink size={12} />
          </a>
        </div>
      ) : null}
    </>
  );
}

/**
 * Ouvre le formulaire du courtier dans une fenêtre pilotée, déjà remplie.
 *
 * L'envoi n'est jamais automatique: la personne relit, traite le captcha s'il y
 * en a un, puis clique elle-même. C'est ce qui distingue une aide à la saisie
 * d'une soumission faite en son nom sans qu'elle l'ait vue.
 */
function AssistButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  return (
    <Button
      size="sm"
      variant="primary"
      loading={busy}
      icon={<PenLine size={14} />}
      onClick={async () => {
        setBusy(true);
        try {
          const report = await api.assistRequest(requestId);
          if (!report.formDetected) {
            // Beaucoup de courtiers ne publient qu'une politique de
            // confidentialité. Annoncer un formulaire rempli sur une telle page
            // serait faux, et l'utilisateur croirait sa demande partie.
            toast.push(
              'info',
              "Cette page ne contient aucun formulaire d'exercice de droits. "
              + 'La fenêtre reste ouverte: cherchez la procédure indiquée, ou écrivez à une adresse du site.',
            );
          } else {
            toast.push(
              report.captcha ? 'info' : 'success',
              `${plural(report.filled.length, 'champ')} rempli${report.filled.length > 1 ? 's' : ''}. `
              + `${report.captcha ? 'Un captcha vous attend, ' : ''}relisez puis validez dans la fenêtre ouverte.`,
            );
          }
        } catch (err) {
          toast.push('error', String((err as Error).message));
        } finally {
          setBusy(false);
        }
      }}
    >
      Remplir le formulaire pour moi
    </Button>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div>
      <dt className="text-[0.78rem] text-[var(--color-ink-faint)]">{label}</dt>
      <dd style={tone === 'warn' ? { color: 'var(--color-warn)' } : undefined}>{value}</dd>
    </div>
  );
}

function parseDetail(detail: string | null): { url?: string; reason?: string } | null {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

function toneForEvent(type: string) {
  if (['completed', 'confirmed', 'no_data'].includes(type)) return 'ok' as const;
  if (['action_required', 'throttled', 'followup', 'escalation'].includes(type)) return 'warn' as const;
  if (['failed', 'error', 'rejected'].includes(type)) return 'danger' as const;
  if (['sent', 'submitted', 'reply'].includes(type)) return 'info' as const;
  return 'neutral' as const;
}
