// Numero di video mostrati nei risultati
const NUM_RISULTATI = 4;
const KEY_STORAGE = 'yt_api_key';

const $ = (id) => document.getElementById(id);
const views = { home: $('home'), player: $('player'), settings: $('settings') };

function show(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}

function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
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

// ---------- Ricerca YouTube ----------
async function cerca(query) {
  const key = getKey();
  if (!key) { show('settings'); return; }

  setStatus('Cerco «' + query + '»…');
  $('results').innerHTML = '';

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: String(NUM_RISULTATI),
    q: query,
    relevanceLanguage: 'it',
    key,
  });

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || r.status);
    mostraRisultati(data.items || []);
    setStatus(data.items?.length ? 'Risultati per «' + query + '»' : 'Nessun video trovato.');
  } catch (err) {
    setStatus('Errore nella ricerca: ' + err.message);
  }
}

function mostraRisultati(items) {
  const ul = $('results');
  ul.innerHTML = '';
  for (const it of items) {
    const id = it.id.videoId;
    const s = it.snippet;
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = s.thumbnails?.medium?.url || s.thumbnails?.default?.url;
    img.alt = '';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('p');
    t.className = 'title';
    // l'API restituisce entità HTML (es. &#39;): le decodifico senza eseguire HTML
    t.textContent = new DOMParser().parseFromString(s.title, 'text/html').body.textContent;
    const c = document.createElement('p');
    c.className = 'channel';
    c.textContent = s.channelTitle;
    meta.append(t, c);
    li.append(img, meta);
    li.addEventListener('click', () => apriVideo(id, t.textContent));
    ul.append(li);
  }
}

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
  $('api-key').value = getKey();
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
