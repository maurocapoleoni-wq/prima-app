// ---------- Novità e Feed dai canali a cui sei iscritto ----------
// Novità: parole chiave cercate nei video recenti di TUTTI i tuoi canali.
// Feed:   TUTTI i video recenti dei soli canali scelti, senza parole chiave.

// ID client OAuth di Google (Google Cloud → Credenziali → ID client OAuth 2.0, tipo "Applicazione web").
// Non è segreto: può stare nel codice pubblico.
const GOOGLE_CLIENT_ID = '65288816095-2tr0llic4k7p6c7if7mq3mlhchff98bd.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const REDIRECT = new URL('./', location.href).href; // es. https://maurocapoleoni-wq.github.io/prima-app/
const CANALI_IN_PARALLELO = 6;
const K = {
  token: 'nov_token', tab: 'tab', state: 'oauth_state',
  dopo: 'dopo_accesso', // cosa fare al ritorno da Google: 'novita' | 'feed' | 'feed-canali'
  novParole: 'nov_parole', novGiorni: 'nov_giorni', novVisti: 'nov_visti',
  feedGiorni: 'feed_giorni', feedVisti: 'feed_visti',
  feedListe: 'feed_liste', feedAttiva: 'feed_lista_attiva', // feedListe: [{id, nome, canali: [{id, nome}]}]
  feedCanali: 'feed_canali', // vecchia lista unica: letta solo per creare la "Lista 1"
  salvati: 'salvati_video', // "Mi piace": { idListaFeed: [video] } (vedi salvati.js)
  salvatiNomi: 'salvati_nomi', // nomi delle liste eliminate dal Feed che restano in "Mi piace": { id: nome }
};

function leggi(k, def) {
  try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; }
}
function scrivi(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

// Testo senza accenti e in minuscolo, per confronti "àèìòù" = "aeiou"
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const parolaIntera = (k) => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

// ---------- Schede Cerca / Novità / Feed ----------
const SCHEDE = ['cerca', 'novita', 'feed', 'salvati'];
function mostraTab(nome) {
  for (const t of SCHEDE) {
    $('tab-' + t).classList.toggle('hidden', t !== nome);
    $('btn-tab-' + t).setAttribute('aria-selected', String(t === nome));
  }
  scrivi(K.tab, nome);
  // mostraSalvati è in salvati.js, caricato dopo: all'avvio ci pensa salvati.js stesso
  if (nome === 'salvati' && typeof mostraSalvati === 'function') mostraSalvati();
}
for (const t of SCHEDE) $('btn-tab-' + t).addEventListener('click', () => mostraTab(t));

// ---------- Accesso con Google ----------
// Flusso OAuth "implicit": Google rimanda all'app con il token dopo il # dell'indirizzo.
function tokenValido() {
  const t = leggi(K.token, null);
  return t && t.scade > Date.now() + 60_000 ? t.valore : null;
}

// dopo = cosa riprendere al ritorno da Google
function accedi(dopo, status) {
  if (!GOOGLE_CLIENT_ID) {
    status("Funzione non ancora configurata: manca l'ID client di Google.");
    return;
  }
  const state = crypto.randomUUID();
  scrivi(K.state, state);
  scrivi(K.dopo, dopo);
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

// Ritorno da Google: restituisce null (nessuna risposta), oppure { ok, dopo, errore }
function leggiRispostaGoogle() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const atteso = leggi(K.state, null);
  const dopo = leggi(K.dopo, 'novita');
  scrivi(K.state, null);
  scrivi(K.dopo, null);
  if (h.has('error')) return { ok: false, dopo, errore: 'Accesso annullato.' };
  if (!atteso || h.get('state') !== atteso) return { ok: false, dopo, errore: 'Accesso non valido, riprova.' };
  scrivi(K.token, {
    valore: h.get('access_token'),
    scade: Date.now() + Number(h.get('expires_in') || 3600) * 1000,
  });
  return { ok: true, dopo };
}

function aggiornaAccount() {
  $('btn-esci').classList.toggle('hidden', !tokenValido());
}
$('btn-esci').addEventListener('click', () => {
  scrivi(K.token, null);
  aggiornaAccount();
});

// ---------- Chiamate a YouTube con l'account dell'utente ----------
async function yt(percorso, params, token) {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + percorso);
  url.search = new URLSearchParams(params);
  contaQuota(1); // subscriptions e playlistItems costano 1 unità
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(erroreYouTube(data, r.status));
    e.status = r.status;
    throw e;
  }
  return data;
}

async function iscrizioni(token) {
  const canali = [];
  let pageToken;
  do {
    const d = await yt('subscriptions', {
      part: 'snippet', mine: 'true', maxResults: '50', ...(pageToken && { pageToken }),
    }, token);
    for (const s of d.items || []) canali.push({ id: s.snippet.resourceId.channelId, nome: testo(s.snippet.title) });
    pageToken = d.nextPageToken;
  } while (pageToken);
  return canali;
}

// Ultimi video di un canale: la sua playlist "caricamenti" ha l'ID del canale con UU al posto di UC
// (su periodi lunghi chiede più video: il costo resta 1 unità)
async function ultimiVideo(canale, token, giorni) {
  try {
    const d = await yt('playlistItems', {
      part: 'snippet,contentDetails', playlistId: 'UU' + canale.id.slice(2), maxResults: giorni > 7 ? '50' : '15',
    }, token);
    return d.items || [];
  } catch (err) {
    if (err.status === 401) throw err;
    return []; // canale senza video pubblici
  }
}

// Video degli ultimi `giorni` giorni dei canali indicati; con `regole` tiene solo quelli che le contengono
async function raccogliVideo(canali, giorni, regole, token, status) {
  const limite = Date.now() - giorni * 864e5;
  const trovati = [];
  for (let i = 0; i < canali.length; i += CANALI_IN_PARALLELO) {
    const gruppo = canali.slice(i, i + CANALI_IN_PARALLELO);
    const risposte = await Promise.all(gruppo.map((c) => ultimiVideo(c, token, giorni)));
    risposte.forEach((items, j) => {
      for (const it of items) {
        const s = it.snippet;
        const data = it.contentDetails?.videoPublishedAt || s.publishedAt;
        if (!data || Date.parse(data) < limite) continue;
        if (s.title === 'Private video' || s.title === 'Deleted video') continue;
        if (regole.length) {
          const contenuto = norm(testo(s.title) + ' ' + testo(s.description));
          if (!regole.some((r) => r.test(contenuto))) continue;
        }
        trovati.push({
          id: s.resourceId.videoId,
          title: testo(s.title),
          channel: gruppo[j].nome,
          thumb: s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
          date: data,
        });
      }
    });
    status(`Controllo i canali… ${Math.min(i + CANALI_IN_PARALLELO, canali.length)} di ${canali.length}`);
  }
  return trovati.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// Segna NUOVO i video mai mostrati prima in questa sezione
function segnaNuovi(video, chiaveVisti) {
  const visti = new Set(leggi(chiaveVisti, []));
  for (const v of video) v.isNew = !visti.has(v.id);
  scrivi(chiaveVisti, [...new Set([...video.map((v) => v.id), ...visti])].slice(0, 1000));
  return video.filter((v) => v.isNew).length;
}

const riepilogo = (n, giorni, nuovi) =>
  `${n} video ${periodo(giorni)}, di cui ${nuovi} ${nuovi === 1 ? 'nuovo' : 'nuovi'}`;

// Elenco a pagine di 4 già tutto in memoria
function creaElenco(ulId, pagerId) {
  const st = { items: [], idx: 0 };
  const pager = $(pagerId);
  const mostra = () => {
    const totale = Math.ceil(st.items.length / NUM_RISULTATI);
    const da = st.idx * NUM_RISULTATI;
    mostraVideo($(ulId), st.items.slice(da, da + NUM_RISULTATI));
    aggiornaPager(pager, `${st.idx + 1} di ${totale}`, st.idx > 0, st.idx + 1 < totale, totale > 0);
  };
  pager.querySelector('.next').addEventListener('click', () => { st.idx++; mostra(); });
  pager.querySelector('.prev').addEventListener('click', () => { st.idx--; mostra(); });
  return { imposta(items) { Object.assign(st, { items, idx: 0 }); mostra(); } };
}

function collegaPeriodo(selectId, chiave, predefinito) {
  const sel = $(selectId);
  sel.value = String(leggi(chiave, predefinito));
  if (!sel.value) sel.value = String(predefinito); // valore salvato non più tra le scelte
  sel.addEventListener('change', () => scrivi(chiave, Number(sel.value)));
}

// "negli ultimi 3 giorni" / "nell'ultimo giorno"
const periodo = (giorni) => (giorni === 1 ? "nell'ultimo giorno" : `negli ultimi ${giorni} giorni`);

// ======================= NOVITÀ (parole chiave) =======================
const statusNov = (t) => { $('status-novita').textContent = t; };
const elencoNovita = creaElenco('results-novita', 'pager-novita');
collegaPeriodo('nov-giorni', K.novGiorni, 14);

async function cercaNovita() {
  const parole = leggi(K.novParole, []);
  if (!parole.length) { statusNov('Aggiungi almeno una parola chiave.'); return; }
  const token = tokenValido();
  if (!token) { accedi('novita', statusNov); return; }

  const giorni = Number($('nov-giorni').value);
  const btn = $('btn-novita');
  btn.disabled = true;
  try {
    statusNov('Leggo i tuoi canali…');
    const canali = await iscrizioni(token);
    if (!canali.length) { statusNov('Non risulti iscritto a nessun canale.'); return; }
    const regole = parole.map((p) => parolaIntera(norm(p)));
    const video = await raccogliVideo(canali, giorni, regole, token, statusNov);
    const nuovi = segnaNuovi(video, K.novVisti);
    elencoNovita.imposta(video);
    statusNov(video.length
      ? riepilogo(video.length, giorni, nuovi)
      : `Nessun video con queste parole ${periodo(giorni)}.`);
  } catch (err) {
    if (err.status === 401) { scrivi(K.token, null); accedi('novita', statusNov); return; }
    statusNov('Errore: ' + err.message);
  } finally {
    btn.disabled = false;
    aggiornaAccount();
  }
}
$('btn-novita').addEventListener('click', cercaNovita);

function mostraParole() {
  const box = $('nov-parole');
  box.innerHTML = '';
  for (const p of leggi(K.novParole, [])) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = p + ' ✕';
    chip.setAttribute('aria-label', 'Rimuovi ' + p);
    chip.addEventListener('click', () => {
      scrivi(K.novParole, leggi(K.novParole, []).filter((x) => x !== p));
      mostraParole();
    });
    box.append(chip);
  }
}

$('nov-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = $('nov-parola').value.trim();
  if (!p) return;
  const lista = leggi(K.novParole, []);
  if (!lista.some((x) => norm(x) === norm(p))) lista.push(p);
  scrivi(K.novParole, lista);
  $('nov-parola').value = '';
  mostraParole();
});

// ======================= FEED (fino a 8 liste di canali scelti) =======================
const MAX_LISTE = 8;
const GIORNI_MESE = 30;
const statusFeed = (t) => { $('status-feed').textContent = t; };
const elencoFeed = creaElenco('results-feed', 'pager-feed');
collegaPeriodo('feed-giorni', K.feedGiorni, 3);
const risultatiFeed = {}; // id lista → video caricati finché l'app resta aperta

// Liste salvate: [{ id, nome, canali: [{id, nome}] }]
function leggiListe() {
  let liste = leggi(K.feedListe, null);
  if (!Array.isArray(liste) || !liste.length) {
    // prima volta: i canali scelti con la versione a lista unica diventano la "Lista 1"
    liste = [{ id: crypto.randomUUID(), nome: 'Lista 1', canali: leggi(K.feedCanali, []) }];
    scrivi(K.feedListe, liste);
  }
  return liste;
}

function listaAttiva() {
  const liste = leggiListe();
  return liste.find((l) => l.id === leggi(K.feedAttiva, null)) || liste[0];
}

function modificaLista(id, modifica) {
  const liste = leggiListe();
  const l = liste.find((x) => x.id === id);
  if (l) { modifica(l); scrivi(K.feedListe, liste); }
}

function mostraListe() {
  const liste = leggiListe();
  const attiva = listaAttiva();
  const box = $('feed-liste');
  box.innerHTML = '';
  for (const l of liste) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (l.id === attiva.id ? ' attiva' : '');
    b.setAttribute('aria-pressed', String(l.id === attiva.id));
    b.textContent = l.nome;
    b.addEventListener('click', () => selezionaLista(l.id));
    box.append(b);
  }
  if (liste.length < MAX_LISTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip nuova';
    b.textContent = '+ Nuova lista';
    b.addEventListener('click', nuovaLista);
    box.append(b);
  }
  $('btn-feed-elimina').disabled = liste.length === 1;
  // "Ultimo mese" vale solo per la lista selezionata
  $('feed-mese').checked = !!attiva.mese;
  $('feed-giorni').disabled = !!attiva.mese;
  const n = attiva.canali.length;
  $('feed-canali-info').textContent = n
    ? `${n} ${n === 1 ? 'canale scelto' : 'canali scelti'}`
    : 'Nessun canale scelto';
}

function selezionaLista(id) {
  scrivi(K.feedAttiva, id);
  $('feed-scelta').classList.add('hidden');
  mostraListe();
  const giaCaricati = risultatiFeed[id];
  elencoFeed.imposta(giaCaricati || []);
  statusFeed(giaCaricati ? '' : 'Tocca "Aggiorna il feed" per vedere i video di questa lista.');
}

function nuovaLista() {
  const liste = leggiListe();
  if (liste.length >= MAX_LISTE) return;
  const nome = (prompt('Nome della nuova lista (es. Cucina, Viaggi):', 'Lista ' + (liste.length + 1)) || '').trim();
  if (!nome) return;
  const l = { id: crypto.randomUUID(), nome: nome.slice(0, 30), canali: [] };
  scrivi(K.feedListe, [...liste, l]);
  selezionaLista(l.id);
  statusFeed(`Lista "${l.nome}" creata: tocca Scegli per aggiungere i canali.`);
}

$('feed-mese').addEventListener('change', () => {
  const attiva = listaAttiva();
  modificaLista(attiva.id, (l) => { l.mese = $('feed-mese').checked; });
  delete risultatiFeed[attiva.id];
  mostraListe();
  statusFeed(`Lista "${attiva.nome}": ${$('feed-mese').checked ? "guardo l'ultimo mese" : 'uso il periodo scelto sopra'}. Tocca "Aggiorna il feed".`);
});

$('btn-feed-rinomina').addEventListener('click', () => {
  const attiva = listaAttiva();
  const nome = (prompt('Nuovo nome della lista:', attiva.nome) || '').trim();
  if (!nome) return;
  modificaLista(attiva.id, (l) => { l.nome = nome.slice(0, 30); });
  mostraListe();
});

$('btn-feed-elimina').addEventListener('click', () => {
  const liste = leggiListe();
  if (liste.length === 1) return;
  const attiva = listaAttiva();
  // I video salvati in "Mi piace" non vengono toccati: la lista resta lì con il suo nome
  const nSalvati = (leggi(K.salvati, {})[attiva.id] || []).length;
  const avviso = nSalvati === 0 ? ''
    : nSalvati === 1 ? ' Il suo video salvato resta in "Mi piace".'
    : ` I suoi ${nSalvati} video salvati restano in "Mi piace".`;
  if (!confirm(`Eliminare la lista "${attiva.nome}" dal Feed?${avviso} Le tue iscrizioni su YouTube non cambiano.`)) return;
  if (nSalvati) {
    const nomi = leggi(K.salvatiNomi, {});
    nomi[attiva.id] = attiva.nome;
    scrivi(K.salvatiNomi, nomi);
  }
  scrivi(K.feedListe, liste.filter((l) => l.id !== attiva.id));
  delete risultatiFeed[attiva.id];
  selezionaLista(leggiListe()[0].id);
  statusFeed(`Lista "${attiva.nome}" eliminata.`);
});

async function aggiornaFeed() {
  const lista = listaAttiva();
  if (!lista.canali.length) { statusFeed('Prima scegli i canali di questa lista con il pulsante Scegli.'); return; }
  const token = tokenValido();
  if (!token) { accedi('feed', statusFeed); return; }

  const giorni = lista.mese ? GIORNI_MESE : Number($('feed-giorni').value);
  const btn = $('btn-feed');
  btn.disabled = true;
  try {
    const video = await raccogliVideo(lista.canali, giorni, [], token, statusFeed);
    const nuovi = segnaNuovi(video, K.feedVisti);
    risultatiFeed[lista.id] = video;
    if (listaAttiva().id !== lista.id) return; // nel frattempo hai cambiato lista
    elencoFeed.imposta(video);
    statusFeed(video.length
      ? `${lista.nome}: ${riepilogo(video.length, giorni, nuovi)}`
      : `${lista.nome}: nessun video ${periodo(giorni)}.`);
  } catch (err) {
    if (err.status === 401) { scrivi(K.token, null); accedi('feed', statusFeed); return; }
    statusFeed('Errore: ' + err.message);
  } finally {
    btn.disabled = false;
    aggiornaAccount();
  }
}
$('btn-feed').addEventListener('click', aggiornaFeed);

// --- Scelta dei canali del feed ---
async function apriSceltaFeed() {
  const token = tokenValido();
  if (!token) { accedi('feed-canali', statusFeed); return; }

  const btn = $('btn-feed-scegli');
  btn.disabled = true;
  statusFeed('Carico i tuoi canali…');
  let canali;
  try {
    canali = (await iscrizioni(token)).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  } catch (err) {
    if (err.status === 401) { scrivi(K.token, null); accedi('feed-canali', statusFeed); return; }
    statusFeed('Errore: ' + err.message);
    return;
  } finally {
    btn.disabled = false;
    aggiornaAccount();
  }

  const scelti = new Set(listaAttiva().canali.map((c) => c.id));
  const ul = $('feed-lista-canali');
  ul.innerHTML = '';
  for (const c of canali) {
    const li = document.createElement('li');
    li.dataset.nome = norm(c.nome);
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c.id;
    cb.dataset.nome = c.nome;
    cb.checked = scelti.has(c.id);
    label.append(cb, document.createTextNode(c.nome));
    li.append(label);
    ul.append(li);
  }
  $('feed-filtro').value = '';
  $('feed-scelta').classList.remove('hidden');
  statusFeed(`Lista "${listaAttiva().nome}": spunta i canali da seguire e tocca Salva.`);
}

const caselleFeed = () => [...$('feed-lista-canali').querySelectorAll('input[type="checkbox"]')];
const caselleFeedVisibili = () => caselleFeed().filter((cb) => !cb.closest('li').hidden);

$('btn-feed-scegli').addEventListener('click', apriSceltaFeed);
$('feed-filtro').addEventListener('input', () => {
  const f = norm($('feed-filtro').value);
  for (const li of $('feed-lista-canali').children) li.hidden = !li.dataset.nome.includes(f);
});
$('btn-feed-tutti').addEventListener('click', () => caselleFeedVisibili().forEach((cb) => { cb.checked = true; }));
$('btn-feed-nessuno').addEventListener('click', () => caselleFeedVisibili().forEach((cb) => { cb.checked = false; }));
$('btn-feed-annulla').addEventListener('click', () => {
  $('feed-scelta').classList.add('hidden');
  statusFeed('');
});
$('btn-feed-salva').addEventListener('click', () => {
  const canali = caselleFeed().filter((cb) => cb.checked).map((cb) => ({ id: cb.value, nome: cb.dataset.nome }));
  const attiva = listaAttiva();
  modificaLista(attiva.id, (l) => { l.canali = canali; });
  delete risultatiFeed[attiva.id];
  $('feed-scelta').classList.add('hidden');
  mostraListe();
  statusFeed(canali.length ? 'Canali salvati. Tocca "Aggiorna il feed".' : 'Nessun canale scelto.');
});

// ---------- Avvio ----------
mostraParole();
mostraListe();
const ritorno = leggiRispostaGoogle();
if (ritorno) {
  const scheda = ritorno.dopo === 'novita' ? 'novita' : 'feed';
  mostraTab(scheda);
  if (!ritorno.ok) (scheda === 'novita' ? statusNov : statusFeed)(ritorno.errore);
  else if (ritorno.dopo === 'novita') cercaNovita();
  else if (ritorno.dopo === 'feed') aggiornaFeed();
  else apriSceltaFeed();
} else {
  mostraTab(SCHEDE.includes(leggi(K.tab, 'cerca')) ? leggi(K.tab, 'cerca') : 'cerca');
}
aggiornaAccount();
