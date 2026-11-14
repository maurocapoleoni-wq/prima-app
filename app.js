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
// Il simbolo dell'infinito ha due lati: rosso = cerca su YouTube, verde = cerca su Spotify
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let fonteVoce = 'youtube';
const pulsanteVoce = () => $(fonteVoce === 'spotify' ? 'btn-mic-sp' : 'btn-mic');
const nomeFonte = (f) => (f === 'spotify' ? 'Spotify' : 'YouTube');

if (SpeechRec) {
  rec = new SpeechRec();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => { pulsanteVoce().classList.add('listening'); setStatus(`Ti ascolto… (${nomeFonte(fonteVoce)})`); };
  rec.onend = () => document.querySelectorAll('.anello').forEach((b) => b.classList.remove('listening'));
  rec.onerror = (e) => {
    rec.onend();
    if (e.error === 'not-allowed') setStatus('Permesso microfono negato. Abilitalo nelle impostazioni del browser.');
    else if (e.error === 'no-speech') setStatus('Non ho sentito nulla, riprova.');
    else setStatus('Errore microfono: ' + e.error);
  };
  rec.onresult = (e) => {
    const res = e.results[e.results.length - 1];
    const testo = res[0].transcript;
    setStatus('«' + testo + '»');
    if (res.isFinal) cerca(testo, fonteVoce);
  };
} else {
  setStatus('Riconoscimento vocale non supportato: usa Chrome. Puoi scrivere la ricerca qui sotto.');
}

for (const [id, fonte] of [['btn-mic', 'youtube'], ['btn-mic-sp', 'spotify']]) {
  $(id).addEventListener('click', () => {
    if (!rec) return;
    if (fonte === 'youtube' && !getKey()) { show('settings'); return; }
    fonteVoce = fonte;
    try { rec.start(); } catch { /* già in ascolto */ }
  });
}

// Due pulsanti di invio: "YouTube" e "Spotify"
$('text-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('text-query').value.trim();
  if (q) cerca(q, e.submitter?.value === 'spotify' ? 'spotify' : 'youtube');
});

// ---------- Conteggio della quota YouTube (solo le richieste di questo telefono) ----------
// YouTube dà 10.000 unità al giorno: una ricerca costa 100, le altre richieste 1.
// La quota si azzera a mezzanotte ora del Pacifico (le 9 del mattino in Italia).
const QUOTA_GIORNO = 10000;
const COSTO_RICERCA = 100;
const giornoPacifico = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

function leggiQuota() {
  const oggi = { giorno: giornoPacifico(), unita: 0 };
  try {
    const q = JSON.parse(localStorage.getItem('quota_youtube') || 'null');
    return q && q.giorno === oggi.giorno ? q : oggi;
  } catch { return oggi; }
}

function contaQuota(unita) {
  const q = leggiQuota();
  q.unita += unita;
  try { localStorage.setItem('quota_youtube', JSON.stringify(q)); } catch {}
  aggiornaQuota();
}

function aggiornaQuota() {
  const u = leggiQuota().unita;
  const fmt = (n) => n.toLocaleString('it-IT');
  const ricerche = Math.round(u / COSTO_RICERCA);
  const testoQuota = `YouTube oggi, da questo telefono: ${fmt(u)} unità su ${fmt(QUOTA_GIORNO)} `
    + `(come ${fmt(ricerche)} ${ricerche === 1 ? 'ricerca' : 'ricerche'} su ${fmt(QUOTA_GIORNO / COSTO_RICERCA)})`;
  document.querySelectorAll('.quota').forEach((el) => {
    el.textContent = testoQuota;
    el.classList.toggle('quota-alta', u >= QUOTA_GIORNO * 0.8);
  });
}

// Messaggio d'errore di YouTube, con un testo chiaro quando la quota del giorno è finita
function erroreYouTube(data, status) {
  const motivo = data?.error?.errors?.[0]?.reason;
  if (motivo === 'quotaExceeded' || motivo === 'dailyLimitExceeded') {
    return 'Limite giornaliero di YouTube raggiunto: riprova dopo le 9 del mattino.';
  }
  return data?.error?.message || String(status);
}

// ---------- Elenco di video (usato da Cerca e da Novità) ----------
// L'API restituisce entità HTML (es. &#39;): le decodifico senza eseguire HTML
function testo(s) {
  return new DOMParser().parseFromString(s || '', 'text/html').body.textContent;
}

function formatData(iso) {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

// items: [{ id, title, channel, thumb, date?, isNew?, nota?, fonte? }] (nota: testo in più sotto il titolo)
// fonte: 'spotify' per gli episodi di podcast (bordo verde), altrimenti YouTube (bordo rosso)
// opzioni.onRimuovi(video): se presente, ogni video ha una ✕ per toglierlo dall'elenco
function mostraVideo(ul, items, opzioni = {}) {
  ul.innerHTML = '';
  for (const v of items) {
    const li = document.createElement('li');
    li.className = v.fonte === 'spotify' ? 'fonte-sp' : 'fonte-yt';
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
    c.textContent = (v.fonte === 'spotify' ? '🎧 ' : '') + v.channel
      + (v.date ? ' · ' + formatData(v.date) : '') + (v.nota ? ' · ' + v.nota : '');
    meta.append(t, c);
    li.append(img, meta);
    if (opzioni.onRimuovi) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'rimuovi';
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Rimuovi ' + v.title);
      x.addEventListener('click', (e) => {
        e.stopPropagation(); // non aprire il video
        opzioni.onRimuovi(v);
      });
      li.append(x);
    }
    li.addEventListener('click', () => apriVideo(v.id, v.title, v));
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

// ---------- Ricerca (YouTube o Spotify) ----------
// token[i] = come chiedere la pagina i (la prima non ne ha bisogno); undefined = non ci sono altre pagine
const ricerca = { query: '', fonte: 'youtube', pagine: [], token: [], idx: 0 };

async function cerca(query, fonte = 'youtube') {
  if (fonte === 'youtube' && !getKey()) { show('settings'); return; }
  Object.assign(ricerca, { query, fonte, pagine: [], token: [undefined], idx: 0 });
  $('results').innerHTML = '';
  $('pager-cerca').classList.add('hidden');
  setStatus(`Cerco «${query}» su ${nomeFonte(fonte)}…`);
  if (await caricaPaginaRicerca(0)) mostraPaginaRicerca();
}

// Spotify: caricaPaginaSpotify è in spotify.js
async function caricaPaginaRicerca(i) {
  if (ricerca.fonte === 'spotify') return caricaPaginaSpotify(i);
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
    contaQuota(COSTO_RICERCA);
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(erroreYouTube(data, r.status));
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
  const cosa = ricerca.fonte === 'spotify' ? 'Episodi su Spotify' : 'Video su YouTube';
  setStatus(items.length ? `${cosa} per «${ricerca.query}»`
    : (ricerca.fonte === 'spotify' ? 'Nessun episodio trovato.' : 'Nessun video trovato.'));
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
// Video in riproduzione: { id, title, channel?, thumb?, date? } (usato da "Mi piace")
let videoCorrente = null;
let tempoVideo = 0; // secondo attuale del video, comunicato dal player

// enablejsapi=1: l'app può parlare con il player (pausa, secondo attuale)
// hl=it / cc_lang_pref=it: menu e sottotitoli del player in italiano
// (YouTube non permette di scegliere la traccia audio nel player incorporato)
// seg: { inizio?, fine? } in secondi → il video parte e si ferma lì (parametri ufficiali start/end)
function urlPlayer(id, seg) {
  return 'https://www.youtube.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0&enablejsapi=1'
    + '&hl=it&cc_lang_pref=it'
    + (seg?.inizio > 0 ? '&start=' + seg.inizio : '')
    + (seg?.fine > 0 ? '&end=' + seg.fine : '')
    + '&origin=' + encodeURIComponent(location.origin);
}

// Comando ufficiale al player di YouTube, es. comandoPlayer('pauseVideo')
function comandoPlayer(func, args = []) {
  $('yt-frame').contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

// Il player, se glielo chiedi, comunica il secondo attuale con dei messaggi
$('yt-frame').addEventListener('load', () => {
  $('yt-frame').contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
});
window.addEventListener('message', (e) => {
  try {
    if (!/(^|\.)youtube\.com$/.test(new URL(e.origin).hostname)) return;
    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (typeof d?.info?.currentTime === 'number') tempoVideo = d.info.currentTime;
  } catch { /* messaggio non nostro */ }
});

// ---------- Segmento: inizio e fine segnati, usati quando apri il video da "Mi piace" ----------
// Salvati per video: { idVideo: { inizio?, fine? } } in secondi
function leggiSegmenti() {
  try { return JSON.parse(localStorage.getItem('segmenti_video') || '{}'); } catch { return {}; }
}

function scriviSegmento(id, seg) {
  const s = leggiSegmenti();
  if (seg && (seg.inizio != null || seg.fine != null)) s[id] = seg;
  else delete s[id];
  try { localStorage.setItem('segmenti_video', JSON.stringify(s)); } catch {}
}

// 75 → "1:15", 3725 → "1:02:05"
function formatTempo(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

function testoSegmento(seg) {
  return `${formatTempo(seg.inizio || 0)} → ${seg.fine != null ? formatTempo(seg.fine) : 'fine'}`;
}

function aggiornaSegmento(messaggio) {
  const seg = videoCorrente && leggiSegmenti()[videoCorrente.id];
  $('segmento-info').textContent = messaggio || (seg ? 'Segmento: ' + testoSegmento(seg) : 'Nessun segmento segnato');
  $('btn-seg-azzera').disabled = !seg;
}

$('btn-seg-inizio').addEventListener('click', () => {
  if (!videoCorrente) return;
  const seg = { ...leggiSegmenti()[videoCorrente.id], inizio: Math.floor(tempoVideo) };
  if (seg.fine != null && seg.fine <= seg.inizio) delete seg.fine; // la vecchia fine ora sarebbe prima
  scriviSegmento(videoCorrente.id, seg);
  aggiornaSegmento();
});

$('btn-seg-fine').addEventListener('click', () => {
  if (!videoCorrente) return;
  const fine = Math.ceil(tempoVideo);
  const seg = { ...leggiSegmenti()[videoCorrente.id] };
  if (seg.inizio != null && fine <= seg.inizio) {
    aggiornaSegmento(`La fine deve venire dopo l'inizio (${formatTempo(seg.inizio)}).`);
    return;
  }
  seg.fine = fine;
  scriviSegmento(videoCorrente.id, seg);
  aggiornaSegmento();
});

$('btn-seg-azzera').addEventListener('click', () => {
  if (!videoCorrente) return;
  scriviSegmento(videoCorrente.id, null);
  aggiornaSegmento();
});

// video.usaSegmento = true quando il video è aperto dalla scheda "Mi piace";
// video.segmento = { inizio, fine } quando arriva da un link condiviso
function apriVideo(id, titolo, video) {
  videoCorrente = video || { id, title: titolo };
  document.dispatchEvent(new CustomEvent('videoaperto'));
  $('player-title').textContent = titolo;
  // Episodio di un podcast: lettore di Spotify, senza i pulsanti solo per YouTube
  const spotify = video?.fonte === 'spotify';
  $('player').classList.toggle('player-spotify', spotify);
  if (spotify) {
    $('yt-frame').src = 'https://open.spotify.com/embed/episode/' + encodeURIComponent(id) + '?utm_source=generator';
    $('open-sp').href = 'https://open.spotify.com/episode/' + encodeURIComponent(id);
    const box = $('frame-wrap');
    box.style.aspectRatio = 'auto';
    box.style.width = '100%';
    show('player');
    history.pushState({ v: 'player' }, '');
    return;
  }
  const seg = video?.segmento || (video?.usaSegmento ? leggiSegmenti()[id] : null);
  tempoVideo = seg?.inizio || 0;
  $('yt-frame').src = urlPlayer(id, seg);
  aggiornaSegmento(seg ? 'Riproduco il segmento: ' + testoSegmento(seg) : '');
  $('open-yt').href = linkAppYouTube(id);
  // il link "intent" va aperto nella stessa finestra, altrimenti resterebbe una scheda vuota
  $('open-yt').target = /Android/i.test(navigator.userAgent) ? '_self' : '_blank';
  impostaFormato(16, 9);
  show('player');
  history.pushState({ v: 'player' }, '');
  formatoVideo(id);
}

// Riquadro del player con le proporzioni del video: largo quanto lo schermo,
// ma mai più alto dello spazio disponibile (così i video verticali si vedono grandi)
function impostaFormato(w, h) {
  const box = $('frame-wrap');
  box.style.aspectRatio = `${w} / ${h}`;
  box.style.width = `min(100%, calc((100dvh - 140px) * ${w / h}))`;
}

// Chiede a YouTube le proporzioni del video (1 unità di quota)
async function formatoVideo(id) {
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'player', id, maxHeight: '1280', key: getKey() });
    contaQuota(1);
    const d = await (await fetch(url)).json();
    const p = d.items?.[0]?.player;
    const ancoraAperto = $('yt-frame').src.includes(id);
    if (ancoraAperto && p?.embedWidth && p?.embedHeight) impostaFormato(Number(p.embedWidth), Number(p.embedHeight));
  } catch { /* resta 16:9 */ }
}

// ---------- Condividi (WhatsApp e altre app) ----------
// Apre il menu "Condividi" di Android; se non c'è, apre WhatsApp con il messaggio già scritto.
function condividi(titolo, testo) {
  if (navigator.share) {
    navigator.share({ title: titolo, text: testo }).catch(() => { /* annullato dall'utente */ });
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(testo), '_blank', 'noopener');
  }
}

// Link al video. Senza segmento: link normale di YouTube.
// Con un segmento: link a QUESTA app con video e segmento nell'indirizzo. Android passa all'app
// YouTube tutti i link youtube.com (che ignorerebbe la fine), ma non questo: si apre la nostra app,
// che fa partire e fermare il video nei punti giusti (vedi apriVideoDaLink).
function linkVideo(v, seg) {
  if (v.fonte === 'spotify') return 'https://open.spotify.com/episode/' + v.id;
  if (!seg) return 'https://www.youtube.com/watch?v=' + v.id;
  const p = new URLSearchParams({ v: v.id });
  if (seg.inizio > 0) p.set('start', seg.inizio);
  if (seg.fine > 0) p.set('end', seg.fine);
  p.set('titolo', (v.title || '').slice(0, 100));
  return new URL('./', location.href).href + '?' + p;
}

// Testo per un video: titolo, eventuale segmento e link (i segmenti valgono solo per YouTube)
function testoVideo(v, seg) {
  if (v.fonte === 'spotify') seg = null;
  const parte = seg ?` (dal minuto ${formatTempo(seg.inizio || 0)}${seg.fine != null ? ' al ' + formatTempo(seg.fine) : ''})` : '';
  return `${v.title}${parte}\n${linkVideo(v, seg)}`;
}

// Apertura da un link condiviso (…/prima-app/?v=ID&start=80&end=226&titolo=…)
function apriVideoDaLink() {
  const p = new URLSearchParams(location.search);
  const id = p.get('v');
  if (!id || !/^[\w-]{6,20}$/.test(id)) return;
  const intero = (k) => (/^\d+$/.test(p.get(k) || '') ? Number(p.get(k)) : undefined);
  const segmento = { inizio: intero('start'), fine: intero('end') };
  const titolo = p.get('titolo') || 'Video condiviso';
  history.replaceState(null, '', location.pathname); // il tasto indietro torna all'app, senza riaprire il video
  apriVideo(id, titolo, { id, title: titolo, segmento });
}

$('btn-condividi').addEventListener('click', () => {
  if (!videoCorrente) return;
  const seg = videoCorrente.segmento || (videoCorrente.usaSegmento ? leggiSegmenti()[videoCorrente.id] : null);
  comandoPlayer('pauseVideo');
  condividi(videoCorrente.title, testoVideo(videoCorrente, seg));
});

// ---------- Guarda sulla TV ----------
// Apre il video nell'app YouTube, dove c'è il tasto ufficiale per trasmettere alla TV.
// Su Android un link "intent" apre sempre l'app (e il sito solo se l'app non c'è).
function linkAppYouTube(id) {
  const web = 'https://www.youtube.com/watch?v=' + id;
  if (!/Android/i.test(navigator.userAgent)) return web;
  return 'intent://www.youtube.com/watch?v=' + id
    + '#Intent;package=com.google.android.youtube;scheme=https;'
    + 'S.browser_fallback_url=' + encodeURIComponent(web) + ';end';
}

$('open-yt').addEventListener('click', () => {
  // Pausa il video nell'app, così non continua a suonare mentre guardi sulla TV
  comandoPlayer('pauseVideo');
});

function chiudiVideo() {
  $('yt-frame').src = 'about:blank';
  show('home');
  document.dispatchEvent(new CustomEvent('videochiuso'));
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
aggiornaQuota();
// Dopo che tutti gli script sono pronti (anche "Mi piace"), apri l'eventuale video di un link condiviso
document.addEventListener('DOMContentLoaded', apriVideoDaLink);

// ---------- Installabilità (PWA) ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
