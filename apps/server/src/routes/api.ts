import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { getDb, nowIso } from '../db/index.js';
import { paths } from '../config/paths.js';
import {
  allBrokers, catalogMeta, catalogStats, deleteCustomBroker, getBroker, loadCatalog,
  updateCatalog, upsertCustomBroker,
} from '../core/catalog.js';
import { getProfile, saveProfile } from '../core/profile.js';
import { autoStartState, setAutoStart } from '../core/autostart.js';
import { getRedactedSettings, getSetting, patchSecret, setSetting } from '../core/settings.js';
import { exportKey, keyringStatus, lock, rotateKey, setMode, unlock } from '../crypto/keyring.js';
import {
  closeFinishedCampaigns, createCampaign, listCampaigns, recoverStuckRequests, relevanceScore, selectBrokers,
} from '../engine/campaign.js';
import { startEngine } from '../engine/lifecycle.js';
import { bus } from '../engine/bus.js';
import { enqueue, pauseQueue, queueStatus, resumeQueue, setConcurrency } from '../engine/queue.js';
import {
  addEvent, hasOpenRequest, listArtifacts, listEvents, listMessages, listRequests,
  requestStats, setStatus, updateRequest,
} from '../engine/store.js';
import { processInbox, sweepNewBrokers } from '../engine/scheduler.js';
import { verifySmtp, resetTransporter } from '../mail/smtp.js';
import { verifyImap } from '../mail/imap.js';
import { detectProvider, guessSettings, PROVIDERS } from '../mail/providers.js';
import { renderComplaint, renderMail, supervisoryAuthority } from '../mail/templates.js';
import { browserStatus, installBrowser } from '../web/browser.js';
import { openAssisted } from '../web/assist.js';
import { clearLogFile } from '../util/logger.js';
import type { Broker, Profile, RequestRow } from '../types.js';

/** API interne consommée par l'interface. Rien n'est expose à l'extérieur. */

/**
 * Version affichée dans l'interface. Lue depuis le paquet plutôt que recopiée,
 * pour qu'une publication ne laisse pas un numéro périmé à l'écran.
 */
const APP_VERSION: string = (() => {
  try {
    const pkg = new URL('../../package.json', import.meta.url);
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
})();

const profileSchema = z.object({
  firstName: z.string().min(1, 'Le prénom est obligatoire.'),
  lastName: z.string().min(1, 'Le nom est obligatoire.'),
  middleName: z.string().optional(),
  previousNames: z.array(z.string()).optional(),
  emails: z.array(z.string().email("Adresse email invalide.")).min(1, 'Au moins une adresse email est nécessaire.'),
  phones: z.array(z.string()).optional(),
  addresses: z.array(z.object({
    line1: z.string().default(''),
    line2: z.string().optional(),
    city: z.string().default(''),
    state: z.string().optional(),
    zip: z.string().default(''),
    country: z.string().default(''),
  })).default([]),
  dateOfBirth: z.string().optional(),
  // Format libre volontairement: iOS et Android utilisent tous deux un UUID,
  // mais un utilisateur peut coller la valeur avec des espaces ou en minuscules.
  advertisingIds: z.array(z.string().max(80)).max(6).optional(),
  jurisdiction: z.enum(['eu', 'uk', 'other']),
  language: z.enum(['fr', 'en']),
});

const campaignSchema = z.object({
  scope: z.enum(['all', 'recommended', 'selection']),
  brokerIds: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  useEmail: z.boolean().optional(),
  useWeb: z.boolean().optional(),
  force: z.boolean().optional(),
});

function fail(reply: FastifyReply, err: unknown, code = 400) {
  const message = err instanceof z.ZodError
    ? err.errors.map((e) => e.message).join(' ')
    : String((err as Error)?.message ?? err);
  return reply.code(code).send({ error: message });
}

/** État par courtier: masquage, note, dernière demande. */
function brokerStateMap(): Map<string, { hidden: boolean; note?: string; status?: string; updatedAt?: string }> {
  const rows = getDb().prepare('SELECT broker_id, hidden, note, last_status, updated_at FROM broker_state').all() as {
    broker_id: string; hidden: number; note: string | null; last_status: string | null; updated_at: string;
  }[];
  return new Map(rows.map((r) => [r.broker_id, { hidden: Boolean(r.hidden), note: r.note ?? undefined, status: r.last_status ?? undefined, updatedAt: r.updated_at }]));
}

/**
 * Dernier statut connu par courtier, calculé depuis les demandes.
 *
 * Une sous-requête corrélée relançait un tri par courtier pour chacune des deux
 * mille demandes, à chaque affichage de la page Courtiers. Une seule passe
 * groupée suffit: `max(updated_at)` choisit la ligne, et SQLite rapporte les
 * colonnes de cette ligne-là.
 */
function latestStatusByBroker(): Map<string, { status: string; requestId: string; updatedAt: string }> {
  const rows = getDb().prepare(`
    SELECT broker_id, status, id, max(updated_at) AS updated_at
    FROM request GROUP BY broker_id
  `).all() as { broker_id: string; status: string; id: string; updated_at: string }[];
  return new Map(rows.map((r) => [r.broker_id, { status: r.status, requestId: r.id, updatedAt: r.updated_at }]));
}

export function registerApi(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // État global
  // -------------------------------------------------------------------------
  // Sonde de vie, sans aucune donnée personnelle: elle sert au conteneur et à
  // l'enveloppe de bureau pour savoir si le serveur répond.
  app.get('/api/health', async () => ({ ok: true, version: APP_VERSION }));

  app.get('/api/state', async () => {
    const keyring = keyringStatus();
    if (!keyring.unlocked) return { locked: true, keyring };

    const profile = getProfile();
    return {
      locked: false,
      keyring,
      onboarding: getSetting('onboarding'),
      hasProfile: profile != null,
      profile,
      // autoStart n'est pas un réglage stocké mais un état du système: il
      // accompagne les autres pour que l'interface n'ait qu'une seule source.
      settings: { ...getRedactedSettings(), autoStart: autoStartState() },
      catalog: { ...catalogStats(), ...catalogMeta() },
      requests: requestStats(),
      queue: queueStatus(),
      browser: browserStatus(),
      authority: profile ? supervisoryAuthority(profile) : null,
      version: APP_VERSION,
    };
  });

  app.post('/api/unlock', async (req, reply) => {
    const body = z.object({ passphrase: z.string().optional() }).parse(req.body ?? {});
    try {
      const ok = unlock(body.passphrase);
      if (!ok) return reply.code(401).send({ error: 'Phrase secrète requise.' });
      startEngine();
      return { ok: true };
    } catch (err) {
      return fail(reply, err, 401);
    }
  });

  app.post('/api/lock', async () => {
    lock();
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Configuration initiale
  // -------------------------------------------------------------------------
  app.get('/api/providers', async (req) => {
    const email = (req.query as { email?: string }).email;
    return {
      providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, appPassword: p.appPassword, note: p.note })),
      detected: email ? detectProvider(email) ?? null : null,
      suggestion: email ? guessSettings(email) : null,
    };
  });

  app.put('/api/profile', async (req, reply) => {
    try {
      const profile = profileSchema.parse(req.body) as Profile;
      return { profile: saveProfile(profile) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/settings/smtp/test', async (req, reply) => {
    try {
      const current = getSetting('smtp');
      const incoming = req.body as Partial<typeof current>;
      const merged = { ...current, ...patchSecret(current, incoming, ['password']) };
      const result = await verifySmtp(merged);
      if (result.ok) {
        setSetting('smtp', { ...merged, verified: true });
        resetTransporter();
      }
      return result;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/settings/imap/test', async (req, reply) => {
    try {
      const current = getSetting('imap');
      const incoming = req.body as Partial<typeof current>;
      const merged = { ...current, ...patchSecret(current, incoming, ['password']) };
      const result = await verifyImap(merged);
      if (result.ok) setSetting('imap', { ...merged, enabled: true, verified: true });
      return result;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/onboarding/complete', async (req, reply) => {
    try {
      const body = z.object({ startCampaign: z.boolean().default(true), scope: z.enum(['all', 'recommended']).default('all') }).parse(req.body ?? {});
      setSetting('onboarding', { completed: true, step: 99 });
      if (!body.startCampaign) return { ok: true, campaign: null };
      const campaign = createCampaign({ scope: body.scope });
      return { ok: true, campaign };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // -------------------------------------------------------------------------
  // Réglages
  // -------------------------------------------------------------------------
  app.get('/api/settings', async () => ({ ...getRedactedSettings(), autoStart: autoStartState() }));

  // Inscrire l'application au demarrage releve du systeme, pas du serveur:
  // l'enveloppe de bureau fournit l'implementation, et l'option disparait de
  // l'interface quand elle n'est pas disponible.
  app.put('/api/settings/auto-start', async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error('Valeur attendue: enabled.'));
    try {
      return { autoStart: setAutoStart(body.data.enabled) };
    } catch (err) {
      return fail(reply, err as Error);
    }
  });

  app.put('/api/settings/:section', async (req, reply) => {
    const section = (req.params as { section: string }).section as keyof ReturnType<typeof getRedactedSettings>;
    const allowed = ['smtp', 'imap', 'automation', 'schedule', 'privacy', 'onboarding'];
    if (!allowed.includes(section)) return fail(reply, new Error('section inconnue'));
    try {
      const current = getSetting(section as never) as Record<string, unknown>;
      const body = req.body as Record<string, unknown>;
      const secretKeys = section === 'smtp' || section === 'imap' ? ['password'] : section === 'automation' ? ['captchaKey'] : [];
      const patched = patchSecret(current as never, body as never, secretKeys as never);
      const saved = setSetting(section as never, patched as never);
      if (section === 'smtp') resetTransporter();
      if (section === 'automation') setConcurrency((saved as { concurrency: number }).concurrency);
      return getRedactedSettings();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/security/mode', async (req, reply) => {
    try {
      const body = z.object({ mode: z.enum(['plain', 'os', 'passphrase']), passphrase: z.string().optional() }).parse(req.body);
      setMode(body.mode, body.passphrase);
      return { ok: true, keyring: keyringStatus() };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Volontairement en POST, pas en GET: une page web ouverte dans le même
  // navigateur ne peut pas déclencher un POST vers cette API sans en-tête
  // d'origine, alors qu'une simple balise image suffirait à atteindre un GET.
  app.post('/api/security/key', async () => ({ key: exportKey() }));

  // -------------------------------------------------------------------------
  // Courtiers
  // -------------------------------------------------------------------------
  app.get('/api/brokers', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const state = brokerStateMap();
    const latest = latestStatusByBroker();
    const search = (q.search ?? '').toLowerCase().trim();
    const categories = q.categories?.split(',').filter(Boolean) ?? [];
    const regions = q.regions?.split(',').filter(Boolean) ?? [];
    const methods = q.methods?.split(',').filter(Boolean) ?? [];
    const status = q.status ?? '';
    const limit = Math.min(500, Number(q.limit ?? 60));
    const offset = Number(q.offset ?? 0);

    let list: (Broker & { state?: unknown; request?: unknown })[] = allBrokers();
    // La recherche couvre aussi les marques secondaires: une même société opère
    // souvent une dizaine de sites, et l'utilisateur connaît celui qu'il a vu.
    if (search) {
      list = list.filter((b) => b.name.toLowerCase().includes(search)
        || (b.domain ?? '').includes(search)
        || b.aliases?.some((a) => a.toLowerCase().includes(search)));
    }
    if (categories.length) list = list.filter((b) => categories.includes(b.category));
    if (regions.length) list = list.filter((b) => b.regions.some((r) => regions.includes(r)));
    if (methods.length) list = list.filter((b) => b.methods.some((m) => methods.includes(m)));
    if (status) list = list.filter((b) => (latest.get(b.id)?.status ?? 'none') === status);
    if (q.eu === 'true') list = list.filter((b) => b.euRelevant);
    if (q.hidden !== 'true') list = list.filter((b) => !state.get(b.id)?.hidden);

    // Même ordre que les campagnes: un résident français voit d'abord les
    // sociétés qui détiennent vraiment des données le concernant.
    const jurisdiction = getProfile()?.jurisdiction ?? 'eu';
    list = [...list].sort((a, b) => relevanceScore(b, jurisdiction) - relevanceScore(a, jurisdiction));

    const total = list.length;
    const page = list.slice(offset, offset + limit).map((b) => ({
      ...b,
      state: state.get(b.id) ?? null,
      request: latest.get(b.id) ?? null,
    }));

    return { total, brokers: page, stats: catalogStats() };
  });

  app.get('/api/brokers/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const broker = getBroker(id);
    if (!broker) return reply.code(404).send({ error: 'Courtier inconnu.' });
    const requests = listRequests({ brokerId: id, limit: 20 }).rows;
    return { broker, requests, state: brokerStateMap().get(id) ?? null };
  });

  app.post('/api/brokers', async (req, reply) => {
    try {
      const body = z.object({
        name: z.string().min(1),
        website: z.string().optional(),
        domain: z.string().optional(),
        email: z.string().email().optional(),
        optOutUrl: z.string().url().optional(),
        category: z.string().optional(),
        regions: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }).parse(req.body);
      return { broker: upsertCustomBroker(body as never) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/brokers/:id', async (req) => {
    deleteCustomBroker((req.params as { id: string }).id);
    return { ok: true };
  });

  app.post('/api/brokers/:id/state', async (req) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as { hidden?: boolean; note?: string };
    getDb().prepare(`
      INSERT INTO broker_state (broker_id, hidden, note, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(broker_id) DO UPDATE SET
        hidden = COALESCE(excluded.hidden, broker_state.hidden),
        note = COALESCE(excluded.note, broker_state.note),
        updated_at = excluded.updated_at
    `).run(id, body.hidden === undefined ? null : Number(body.hidden), body.note ?? null, nowIso());
    return { ok: true };
  });

  /** Aperçu du message qui sera envoyé: rassure avant de lancer une campagne. */
  app.get('/api/brokers/:id/preview', async (req, reply) => {
    const broker = getBroker((req.params as { id: string }).id);
    const profile = getProfile();
    if (!broker || !profile) return reply.code(404).send({ error: 'Courtier ou profil introuvable.' });
    const mail = renderMail({ broker, profile, token: 'apercu00' });
    // Sans adresse, rien ne partira par email: le dire évite d'afficher un
    // destinataire vide sous un message que le courtier ne recevra jamais.
    const via = broker.email ? 'email' : broker.recipe ? 'recipe' : broker.optOutUrl ? 'form' : 'discovery';
    return { to: broker.email, via, optOutUrl: broker.optOutUrl, subject: mail.subject, text: mail.text, legalBasis: mail.legalBasis };
  });

  // -------------------------------------------------------------------------
  // Campagnes et demandes
  // -------------------------------------------------------------------------
  app.post('/api/campaigns/preview', async (req, reply) => {
    try {
      const options = campaignSchema.parse(req.body);
      const automation = getSetting('automation');

      // Les courtiers déjà en cours de traitement ne recevront rien: les
      // compter ici annoncerait un nombre que la campagne ne tiendra pas.
      const brokers = selectBrokers(options)
        .filter((b) => options.force || !hasOpenRequest(b.id));

      const byMethod = { email: 0, recipe: 0, form: 0, discovery: 0 };
      for (const b of brokers) {
        if ((options.useWeb ?? automation.webEnabled) && b.recipe) byMethod.recipe++;
        else if ((options.useEmail ?? automation.emailEnabled) && b.email) byMethod.email++;
        else if (b.optOutUrl) byMethod.form++;
        // Ni adresse ni formulaire: l'application ira lire la politique de
        // confidentialité pour trouver un contact. La demande existe, mais
        // l'annoncer comme « formulaire » serait faux, il n'y en a pas.
        else if (b.website) byMethod.discovery++;
      }
      const days = Math.ceil(byMethod.email / Math.max(1, automation.dailyEmailLimit));
      return { total: brokers.length, byMethod, estimatedDays: days };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/campaigns', async (req, reply) => {
    try {
      const options = campaignSchema.parse(req.body);
      return createCampaign(options);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/campaigns', async () => ({ campaigns: listCampaigns() }));

  app.get('/api/requests', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const result = listRequests({
      status: q.status?.split(',').filter(Boolean),
      campaignId: q.campaignId,
      brokerId: q.brokerId,
      search: q.search,
      limit: Number(q.limit ?? 50),
      offset: Number(q.offset ?? 0),
    });
    return { ...result, stats: requestStats() };
  });

  app.get('/api/requests/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = getDb().prepare('SELECT * FROM request WHERE id = ?').get(id) as RequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Demande inconnue.' });
    return {
      request: row,
      broker: getBroker(row.broker_id) ?? null,
      events: listEvents(id),
      messages: listMessages(id),
      artifacts: listArtifacts(id).map((a) => ({ ...a, file: a.file.split(/[\\/]/).pop() })),
    };
  });

  app.post('/api/requests/:id/retry', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = getDb().prepare('SELECT * FROM request WHERE id = ?').get(id) as RequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Demande inconnue.' });
    updateRequest(id, { status: 'queued', last_error: null });

    // Une demande créée avant que la recherche de contact n'existe n'a ni
    // adresse ni formulaire: la relancer telle quelle échouerait de la même
    // façon. On refait d'abord la recherche, qui peut la transformer en envoi.
    const broker = getBroker(row.broker_id);
    const sansContact = broker && !broker.email && !broker.optOutUrl && !broker.recipe;
    const kind = sansContact && broker?.website && browserStatus().available
      ? 'discover_contact'
      : row.method === 'recipe' ? 'run_recipe' : 'send_email';

    enqueue(kind, { requestId: id }, { priority: 5 });
    addEvent(id, 'retry', kind === 'discover_contact'
      ? 'Nouvelle recherche du contact sur le site du courtier.'
      : 'Nouvelle tentative demandée.');
    return { ok: true };
  });

  /**
   * Ouvre le formulaire du courtier, pré-rempli, dans une fenêtre visible.
   * L'envoi reste à la charge de l'utilisateur: c'est lui qui relit, résout un
   * éventuel captcha et clique. Rien n'est soumis en son nom sans son geste.
   */
  app.post('/api/requests/:id/assist', async (req, reply) => {
    try {
      const id = (req.params as { id: string }).id;
      const row = getDb().prepare('SELECT * FROM request WHERE id = ?').get(id) as RequestRow | undefined;
      if (!row) return reply.code(404).send({ error: 'Demande inconnue.' });

      const broker = getBroker(row.broker_id);
      const profile = getProfile();
      if (!broker || !profile) return reply.code(400).send({ error: 'Courtier ou profil introuvable.' });

      // La page indiquée par la réponse du courtier prime sur celle du
      // catalogue: c'est celle qu'il demande explicitement d'utiliser.
      const fromReply = listEvents(id)
        .map((e) => { try { return JSON.parse(e.detail ?? '{}').url as string | undefined; } catch { return undefined; } })
        .filter(Boolean)
        .pop();
      const url = fromReply ?? broker.optOutUrl ?? broker.website;
      if (!url) return reply.code(400).send({ error: "Ce courtier ne publie aucune page d'opt-out." });

      const report = await openAssisted({ broker, profile, url });
      addEvent(
        id,
        'assisted',
        report.formDetected
          ? `Formulaire ouvert et pré-rempli (${report.filled.length} champs).`
          : "Page ouverte, mais aucun formulaire d'exercice de droits n'y a été trouvé.",
        JSON.stringify({ url }),
      );
      return report;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/requests/:id/resolve', async (req) => {
    const id = (req.params as { id: string }).id;
    const body = z.object({ status: z.enum(['completed', 'rejected', 'no_data', 'skipped']), note: z.string().optional() }).parse(req.body);
    setStatus(id, body.status, body.note ?? 'Statut mis à jour manuellement.');
    return { ok: true };
  });

  app.get('/api/requests/:id/complaint', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = getDb().prepare('SELECT * FROM request WHERE id = ?').get(id) as RequestRow | undefined;
    const profile = getProfile();
    const broker = row ? getBroker(row.broker_id) : undefined;
    if (!row || !broker || !profile) return reply.code(404).send({ error: 'Élément introuvable.' });
    return {
      text: renderComplaint({ broker, profile, sentAt: row.sent_at ?? row.created_at, token: row.token }),
      authority: supervisoryAuthority(profile),
    };
  });

  // -------------------------------------------------------------------------
  // Moteur
  // -------------------------------------------------------------------------
  app.post('/api/queue/pause', async () => { pauseQueue(); return queueStatus(); });

  // Reprendre remet aussi en file les demandes qu'aucun travail ne porte plus.
  // C'est le geste que fait naturellement quelqu'un qui trouve ses envois à
  // l'arrêt: il doit suffire, sans redémarrage ni ligne de commande.
  app.post('/api/queue/resume', async () => {
    resumeQueue();
    const recovered = recoverStuckRequests();
    closeFinishedCampaigns();
    return { ...queueStatus(), recovered };
  });

  app.post('/api/inbox/poll', async (_req, reply) => {
    try {
      return await processInbox();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/catalog/update', async () => updateCatalog(true));
  app.post('/api/catalog/sweep', async () => ({ created: sweepNewBrokers() }));

  app.get('/api/browser/status', async () => browserStatus());

  app.post('/api/browser/install', async (_req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      await installBrowser((line) => send({ line }));
      send({ done: true, status: browserStatus() });
    } catch (err) {
      send({ error: String((err as Error).message) });
    }
    reply.raw.end();
  });

  // -------------------------------------------------------------------------
  // Preuves, export, effacement
  // -------------------------------------------------------------------------
  app.get('/api/evidence/:file', async (req, reply) => {
    const name = (req.params as { file: string }).file.replace(/[\\/]/g, '');
    const full = `${paths.evidenceDir}/${name}`;
    if (!fs.existsSync(full)) return reply.code(404).send({ error: 'Introuvable.' });
    return reply.type(name.endsWith('.png') ? 'image/png' : 'application/octet-stream').send(fs.createReadStream(full));
  });

  /** Export complet, lisible sans l'application: utile pour une plainte. */
  app.get('/api/export', async (_req, reply) => {
    const requests = listRequests({ limit: 10_000 }).rows.map((r) => ({
      ...r,
      broker: getBroker(r.broker_id)?.name ?? r.broker_name,
      events: listEvents(r.id),
      messages: listMessages(r.id).map((m) => ({ ...m, body: m.body.slice(0, 20_000) })),
    }));
    reply.header('content-disposition', `attachment; filename="removebroker-export-${nowIso().slice(0, 10)}.json"`);
    return {
      exportedAt: nowIso(),
      profile: getProfile(),
      catalog: catalogMeta(),
      stats: requestStats(),
      requests,
    };
  });

  app.post('/api/wipe', async (req, reply) => {
    const body = z.object({ confirm: z.literal('SUPPRIMER') }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Confirmation manquante."));
    const db = getDb();
    db.exec(`
      DELETE FROM request_event; DELETE FROM message; DELETE FROM artifact;
      DELETE FROM request; DELETE FROM campaign; DELETE FROM job;
      DELETE FROM broker_state; DELETE FROM custom_broker;
      DELETE FROM broker_contact;
      DELETE FROM profile; DELETE FROM settings;
    `);
    // Les contacts découverts vivaient aussi en mémoire: sans ce rechargement,
    // l'application effacée continuait de connaître les adresses trouvées lors
    // de la session précédente.
    loadCatalog();
    for (const file of fs.readdirSync(paths.evidenceDir)) {
      fs.rmSync(`${paths.evidenceDir}/${file}`, { force: true });
    }
    clearLogFile();
    // La clé de l'installation effacée ne doit pas survivre à l'effacement:
    // sinon une sauvegarde antérieure de la base resterait déchiffrable.
    rotateKey();
    return { ok: true };
  });

  app.post('/api/logs/clear', async () => { clearLogFile(); return { ok: true }; });

  // -------------------------------------------------------------------------
  // Flux temps réel
  // -------------------------------------------------------------------------
  app.get('/api/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connecté\n\n');

    const forward = (channel: string) => (payload: unknown) => {
      reply.raw.write(`event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const channels = ['request', 'event', 'job', 'campaign', 'notice'];
    const listeners = channels.map((c) => {
      const fn = forward(c);
      bus.on(c, fn);
      return { c, fn };
    });

    const keepAlive = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      for (const { c, fn } of listeners) bus.off(c, fn);
    });
  });
}
