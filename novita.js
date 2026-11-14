// ---------- Novità dai canali a cui sei iscritto ----------
// ID client OAuth di Google (Google Cloud → Credenziali → ID client OAuth 2.0, tipo "Applicazione web").
// Non è segreto: può stare nel codice pubblico.
const GOOGLE_CLIENT_ID = '65288816095-2tr0llic4k7p6c7if7mq3mlhchff98bd.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const REDIRECT = new URL('./', location.href).href; // es. https://maurocapoleoni-wq.github.io/prima-app/
const NOV = { parole: 'nov_parole', giorni: 'nov_giorni', visti: 'nov_visti', token: 'nov_token', tab: 'tab' };
const CANALI_IN_PARALLELO = 6;

function leggi(k, def) {
  try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; }
}
function scrivi(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

const statusNov = (t) => { $('status-novita').textContent = t; };
const novita = { items: [], idx: 0 };

// Testo senza accenti e in minuscolo, per confronti "àèìòù" = "aeiou"
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const parolaIntera = (k) => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

// ---------- Schede Cerca / Novità ----------
function mostraTab(nome) {
  for (const t of ['cerca', 'novita']) {
    $('tab-' + t).classList.toggle('hidden', t !== nome);
    $('btn-tab-' + t).setAttribute('aria-selected', String(t === nome));
  }
  scrivi(NOV.tab, nome);
}
$('btn-tab-cerca').addEventListener('click', () => mostraTab('cerca'));
$('btn-tab-novita').addEventListener('click', () => mostraTab('novita'));

// ---------- Accesso con Google ----------
// Flusso OAuth "implicit": Google rimanda all'app con il token dopo il # dell'indirizzo.
function tokenValido() {
  const t = leggi(NOV.token, null);
  return t && t.scade > Date.now() + 60_000 ? t.valore : null;
}

function accedi() {
  if (!GOOGLE_CLIENT_ID) {
    statusNov("Funzione non ancora configurata: manca l'ID client di Google.");
    return;
  }
  const state = crypto.randomUUID();
  scrivi('oauth_state', state);
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

function esci() {
  scrivi(NOV.token, null);
  aggiornaAccount();
  statusNov('Sei uscito dal tuo account Google.');
}

// Ritorno da Google: true se l'indirizzo conteneva una risposta di accesso
function leggiRispostaGoogle() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const atteso = leggi('oauth_state', null);
  scrivi('oauth_state', null);
  if (h.has('error')) { statusNov('Accesso annullato.'); return true; }
  if (!atteso || h.get('state') !== atteso) { statusNov('Accesso non valido, riprova.'); return true; }
  scrivi(NOV.token, {
    valore: h.get('access_token'),
    scade: Date.now() + Number(h.get('expires_in') || 3600) * 1000,
  });
  return true;
}

function aggiornaAccount() {
  $('btn-esci').classList.toggle('hidden', !tokenValido());
}
$('btn-esci').addEventListener('click', esci);

// ---------- Chiamate a YouTube con l'account dell'utente ----------
async function yt(percorso, params, token) {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + percorso);
  url.search = new URLSearchParams(params);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(data.error?.message || r.status);
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
async function ultimiVideo(canale, token) {
  try {
    const d = await yt('playlistItems', {
      part: 'snippet,contentDetails', playlistId: 'UU' + canale.id.slice(2), maxResults: '15',
    }, token);
    return d.items || [];
  } catch (err) {
    if (err.status === 401) throw err;
    return []; // canale senza video pubblici
  }
}

// ---------- Ricerca delle novità ----------
async function cercaNovita() {
  const parole = leggi(NOV.parole, []);
  if (!parole.length) { statusNov('Aggiungi almeno una parola chiave.'); return; }
  const token = tokenValido();
  if (!token) { accedi(); return; }

  const giorni = Number($('nov-giorni').value);
  const limite = Date.now() - giorni * 864e5;
  const regole = parole.map((p) => parolaIntera(norm(p)));
  const btn = $('btn-novita');
  btn.disabled = true;

  try {
    statusNov('Leggo i tuoi canali…');
    const canali = await iscrizioni(token);
    if (!canali.length) { statusNov('Non risulti iscritto a nessun canale.'); return; }

    const trovati = [];
    for (let i = 0; i < canali.length; i += CANALI_IN_PARALLELO) {
      const gruppo = canali.slice(i, i + CANALI_IN_PARALLELO);
      const risposte = await Promise.all(gruppo.map((c) => ultimiVideo(c, token)));
      risposte.forEach((items, j) => {
        for (const it of items) {
          const s = it.snippet;
          const data = it.contentDetails?.videoPublishedAt || s.publishedAt;
          if (!data || Date.parse(data) < limite) continue;
          if (s.title === 'Private video' || s.title === 'Deleted video') continue;
          const contenuto = norm(testo(s.title) + ' ' + testo(s.description));
          if (!regole.some((r) => r.test(contenuto))) continue;
          trovati.push({
            id: s.resourceId.videoId,
            title: testo(s.title),
            channel: gruppo[j].nome,
            thumb: s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
            date: data,
          });
        }
      });
      statusNov(`Controllo i canali… ${Math.min(i + CANALI_IN_PARALLELO, canali.length)} di ${canali.length}`);
    }

    trovati.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const visti = new Set(leggi(NOV.visti, []));
    for (const v of trovati) v.isNew = !visti.has(v.id);
    scrivi(NOV.visti, [...new Set([...trovati.map((v) => v.id), ...visti])].slice(0, 1000));

    Object.assign(novita, { items: trovati, idx: 0 });
    mostraPaginaNovita();
    const nuovi = trovati.filter((v) => v.isNew).length;
    statusNov(trovati.length
      ? `${trovati.length} video negli ultimi ${giorni} giorni, di cui ${nuovi} nuovi`
      : `Nessun video con queste parole negli ultimi ${giorni} giorni.`);
  } catch (err) {
    if (err.status === 401) { scrivi(NOV.token, null); accedi(); return; }
    statusNov('Errore: ' + err.message);
  } finally {
    btn.disabled = false;
    aggiornaAccount();
  }
}
$('btn-novita').addEventListener('click', cercaNovita);

function mostraPaginaNovita() {
  const totale = Math.ceil(novita.items.length / NUM_RISULTATI);
  const da = novita.idx * NUM_RISULTATI;
  mostraVideo($('results-novita'), novita.items.slice(da, da + NUM_RISULTATI));
  aggiornaPager($('pager-novita'), `${novita.idx + 1} di ${totale}`, novita.idx > 0, novita.idx + 1 < totale, totale > 0);
}
$('pager-novita').querySelector('.next').addEventListener('click', () => { novita.idx++; mostraPaginaNovita(); });
$('pager-novita').querySelector('.prev').addEventListener('click', () => { novita.idx--; mostraPaginaNovita(); });

// ---------- Parole chiave e periodo ----------
function mostraParole() {
  const box = $('nov-parole');
  box.innerHTML = '';
  for (const p of leggi(NOV.parole, [])) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = p + ' ✕';
    chip.setAttribute('aria-label', 'Rimuovi ' + p);
    chip.addEventListener('click', () => {
      scrivi(NOV.parole, leggi(NOV.parole, []).filter((x) => x !== p));
      mostraParole();
    });
    box.append(chip);
  }
}

$('nov-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = $('nov-parola').value.trim();
  if (!p) return;
  const lista = leggi(NOV.parole, []);
  if (!lista.some((x) => norm(x) === norm(p))) lista.push(p);
  scrivi(NOV.parole, lista);
  $('nov-parola').value = '';
  mostraParole();
});

$('nov-giorni').value = String(leggi(NOV.giorni, 14));
$('nov-giorni').addEventListener('change', () => scrivi(NOV.giorni, Number($('nov-giorni').value)));

// ---------- Avvio ----------
mostraParole();
if (leggiRispostaGoogle()) {
  mostraTab('novita');
  if (tokenValido()) cercaNovita();
} else {
  mostraTab(leggi(NOV.tab, 'cerca'));
}
aggiornaAccount();
