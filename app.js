// Numero di video mostrati nei risultati
const NUM_RISULTATI = 4;
const KEY_STORAGE = 'yt_api_key';

// Chiave API di YouTube condivisa: incollala tra gli apici, es. 'AIza...'.
// Una chiave inserita in ⚙️ sul telefono ha la precedenza su questa.
const CHIAVE_PREDEFINITA = 'AIzaSyBw5xRFHaI4rOFhDdMMcF8ZM6WMEksPCR0';

const $ = (id) => document.getElementById(id);
const views = { home: $('home'), player: $('player'), settings: $('settings') };

function show(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}

function getKey() {
  let personale = '';
  try { personale = localStorage.getItem(KEY_STORAGE) || ''; } catch {}
  return personale || CHIAVE_PREDEFINITA;
}

function setStatus(text) { $('status').textContent = text; }

// ---------- Riconoscimento vocale ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

if (SpeechRec) {
  rec = new SpeechRec();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => { $('btn-mic').classList.add('listening'); setStatus('Ti ascolto…'); };
  rec.onend = () => $('btn-mic').classList.remove('listening');
  rec.onerror = (e) => {
    $('btn-mic').classList.remove('listening');
    if (e.error === 'not-allowed') setStatus('Permesso microfono negato. Abilitalo nelle impostazioni del browser.');
    else if (e.error === 'no-speech') setStatus('Non ho sentito nulla, riprova.');
    else setStatus('Errore microfono: ' + e.error);
  };
  rec.onresult = (e) => {
    const res = e.results[e.results.length - 1];
    const testo = res[0].transcript;
    setStatus('«' + testo + '»');
    if (res.isFinal) cerca(testo);
  };
} else {
  setStatus('Riconoscimento vocale non supportato: usa Chrome. Puoi scrivere la ricerca qui sotto.');
}

$('btn-mic').addEventListener('click', () => {
  if (!rec) return;
  if (!getKey()) { show('settings'); return; }
  try { rec.start(); } catch { /* già in ascolto */ }
});

$('text-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('text-query').value.trim();
  if (q) cerca(q);
});

// ---------- Elenco di video (usato da Cerca e da Novità) ----------
// L'API restituisce entità HTML (es. &#39;): le decodifico senza eseguire HTML
function testo(s) {
  return new DOMParser().parseFromString(s || '', 'text/html').body.textContent;
}

function formatData(iso) {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

// items: [{ id, title, channel, thumb, date?, isNew? }]
function mostraVideo(ul, items) {
  ul.innerHTML = '';
  for (const v of items) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = v.thumb || '';
    img.alt = '';
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (v.isNew) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'NUOVO';
      meta.append(b);
    }
    const t = document.createElement('p');
    t.className = 'title';
    t.textContent = v.title;
    const c = document.createElement('p');
    c.className = 'channel';
    c.textContent = v.channel + (v.date ? ' · ' + formatData(v.date) : '');
    meta.append(t, c);
    li.append(img, meta);
    li.addEventListener('click', () => apriVideo(v.id, v.title));
    ul.append(li);
  }
}

// Barra "◀ Precedenti · pagina · Altri 4 ▶"
function aggiornaPager(el, etichetta, puoiPrima, puoiDopo, visibile) {
  el.classList.toggle('hidden', !visibile);
  el.querySelector('.prev').disabled = !puoiPrima;
  el.querySelector('.next').disabled = !puoiDopo;
  el.querySelector('.num').textContent = etichetta;
}

// ---------- Ricerca YouTube ----------
// token[i] = codice di YouTube per chiedere la pagina i (la prima non ne ha bisogno)
const ricerca = { query: '', pagine: [], token: [], idx: 0 };

async function cerca(query) {
  if (!getKey()) { show('settings'); return; }
  Object.assign(ricerca, { query, pagine: [], token: [undefined], idx: 0 });
  $('results').innerHTML = '';
  $('pager-cerca').classList.add('hidden');
  setStatus('Cerco «' + query + '»…');
  if (await caricaPaginaRicerca(0)) mostraPaginaRicerca();
}

async function caricaPaginaRicerca(i) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: String(NUM_RISULTATI),
    q: ricerca.query,
    relevanceLanguage: 'it',
    key: getKey(),
    ...(ricerca.token[i] && { pageToken: ricerca.token[i] }),
  });

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || r.status);
    ricerca.pagine[i] = (data.items || []).map((it) => ({
      id: it.id.videoId,
      title: testo(it.snippet.title),
      channel: testo(it.snippet.channelTitle),
      thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
    }));
    ricerca.token[i + 1] = data.nextPageToken;
    return true;
  } catch (err) {
    setStatus('Errore nella ricerca: ' + err.message);
    return false;
  }
}

function mostraPaginaRicerca() {
  const items = ricerca.pagine[ricerca.idx];
  mostraVideo($('results'), items);
  setStatus(items.length ? 'Risultati per «' + ricerca.query + '»' : 'Nessun video trovato.');
  const altre = ricerca.idx + 1 < ricerca.pagine.length || !!ricerca.token[ricerca.idx + 1];
  aggiornaPager($('pager-cerca'), 'Pagina ' + (ricerca.idx + 1), ricerca.idx > 0, altre, items.length > 0);
}

$('pager-cerca').querySelector('.next').addEventListener('click', async (e) => {
  const i = ricerca.idx + 1;
  if (!ricerca.pagine[i]) {
    e.currentTarget.disabled = true;
    setStatus('Carico altri video…');
    if (!(await caricaPaginaRicerca(i))) { e.currentTarget.disabled = false; return; }
  }
  ricerca.idx = i;
  mostraPaginaRicerca();
});

$('pager-cerca').querySelector('.prev').addEventListener('click', () => {
  if (ricerca.idx === 0) return;
  ricerca.idx--;
  mostraPaginaRicerca();
});

// ---------- Player ----------
function apriVideo(id, titolo) {
  $('player-title').textContent = titolo;
  $('yt-frame').src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0';
  $('open-yt').href = 'https://www.youtube.com/watch?v=' + id;
  show('player');
  history.pushState({ v: 'player' }, '');
}

function chiudiVideo() {
  $('yt-frame').src = 'about:blank';
  show('home');
}

$('btn-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => {
  if (!views.player.classList.contains('hidden')) chiudiVideo();
  else if (!views.settings.classList.contains('hidden')) show('home');
});

// ---------- Impostazioni ----------
$('btn-settings').addEventListener('click', () => {
  let personale = '';
  try { personale = localStorage.getItem(KEY_STORAGE) || ''; } catch {}
  $('api-key').value = personale;
  show('settings');
});
$('btn-settings-back').addEventListener('click', () => show('home'));
$('btn-save-key').addEventListener('click', () => {
  try { localStorage.setItem(KEY_STORAGE, $('api-key').value.trim()); } catch {}
  show('home');
  setStatus(getKey() ? 'Chiave salvata. Tocca il microfono e parla' : 'Inserisci la chiave API nelle impostazioni ⚙️');
});

if (!getKey()) setStatus('Prima volta? Inserisci la chiave API nelle impostazioni ⚙️');

// ---------- Installabilità (PWA) ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
