// ---------- Chiedi a Claude: si parla con Claude dentro l'app ----------
// Tocchi il cerchio, fai la domanda a voce, Claude risponde e il telefono legge la risposta.
// Claude non vede il video: conosce titolo, canale, descrizione e il minuto a cui sei arrivato.
// La chiave di Claude la inserisce ognuno in Impostazioni: resta solo su quel telefono,
// non è mai scritta nel codice (che su GitHub è pubblico).

const CHIAVE_CLAUDE = 'chiave_claude';
const MODELLO_CLAUDE = 'claude-opus-5-5';

const leggiChiaveClaude = () => { try { return localStorage.getItem(CHIAVE_CLAUDE) || ''; } catch { return ''; } };

// Conversazione con Claude sul video in riproduzione (ricomincia quando cambi video)
let chatClaude = { idVideo: null, sistema: '', messaggi: [] };
let ascoltoClaude = null;
let statoClaude = 'fermo'; // fermo | ascolta | pensa | parla

function impostaStatoClaude(stato, testo) {
  statoClaude = stato;
  const box = $('claude-box');
  box.classList.remove('ascolta', 'pensa', 'parla');
  if (stato !== 'fermo') box.classList.add(stato);
  if (testo != null) $('claude-stato').textContent = testo;
  $('claude-cerchio').setAttribute('aria-label', {
    fermo: 'Parla con Claude', ascolta: 'Sto ascoltando: tocca per finire',
    pensa: 'Claude sta pensando', parla: 'Claude sta parlando: tocca per interromperlo e fare un\'altra domanda',
  }[stato]);
}

// Informazioni sul video che Claude riceve insieme alle domande
async function contestoVideo(v) {
  const righe = [`Titolo: ${v.title}`];
  let canale = v.channel || '';
  let descrizione = v.descrizione || '';
  let data = v.date || '';
  if (v.fonte !== 'podcast') {
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(v.id)}&key=${encodeURIComponent(getKey())}`;
      const r = await fetch(url);
      contaQuota(1);
      const s = (await r.json()).items?.[0]?.snippet;
      if (s) {
        canale = s.channelTitle || canale;
        descrizione = (s.description || '').slice(0, 3000);
        data = s.publishedAt || data;
      }
    } catch { /* senza descrizione Claude lavora con il solo titolo */ }
  }
  if (canale) righe.push(`${v.fonte === 'podcast' ? 'Podcast' : 'Canale'}: ${canale}`);
  if (data) righe.push(`Pubblicato il: ${new Date(data).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  if (descrizione) righe.push(`Descrizione:\n${descrizione}`);
  return righe.join('\n');
}

function istruzioniClaude(v, contesto) {
  const cosa = v.fonte === 'podcast' ? 'un episodio di podcast' : 'un video di YouTube';
  return `Sei Claude, l'assistente di Anthropic, dentro l'app per telefono "Cerca e Guarda". `
    + `L'utente sta guardando ${cosa} e ti parla a voce: la tua risposta verrà letta ad alta voce dal telefono.\n\n`
    + 'Come rispondere:\n'
    + '- In italiano parlato, con frasi brevi e naturali: di solito da due a cinque frasi, di più solo se te lo chiede.\n'
    + '- Niente elenchi puntati, titoli, grassetti, emoji o link: solo testo da ascoltare.\n'
    + '- Se ti chiede un parere, dallo con franchezza e spiega in breve perché.\n'
    + '- Non puoi vedere né ascoltare il contenuto: conosci solo le informazioni qui sotto e quello che sai in generale. '
    + 'Se la domanda riguarda un punto preciso che non puoi conoscere, dillo con semplicità e rispondi con quello che sai.\n\n'
    + `Informazioni su ${cosa}:\n${contesto}`;
}

// Una domanda a Claude (raw HTTP: l'app è JavaScript semplice nel browser, senza programmi di build)
async function chiamaClaude() {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': leggiChiaveClaude(),
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true', // la chiamata parte dal telefono, con la chiave di chi usa l'app
    },
    body: JSON.stringify({
      model: MODELLO_CLAUDE,
      max_tokens: 2048, // risposte volutamente brevi: vengono lette ad alta voce
      output_config: { effort: 'low' }, // conversazione: risposte rapide
      fallbacks: 'default', // se il modello rifiuta, l'API riprova da sola con il modello di riserva consigliato
      system: chatClaude.sistema,
      messages: chatClaude.messaggi,
    }),
  });
  let dati = {};
  try { dati = await r.json(); } catch {}
  if (!r.ok) {
    const tipo = dati.error?.type || '';
    const messaggio = dati.error?.message || '';
    if (r.status === 401) throw new Error('La chiave di Claude non è valida: controllala in ⚙️ Impostazioni.');
    if (r.status === 402 || tipo === 'billing_error' || /credit/i.test(messaggio)) throw new Error('Il credito di Claude è finito: ricaricalo sul sito della console di Anthropic.');
    if (r.status === 403) throw new Error('Questa chiave non ha il permesso di usare Claude.');
    if (r.status === 429) throw new Error('Troppe domande in poco tempo: riprova tra un minuto.');
    if (r.status >= 500) throw new Error('Claude in questo momento è sovraccarico: riprova tra poco.');
    throw new Error(`Errore di Claude (${r.status}): ${messaggio || 'richiesta rifiutata'}`);
  }
  return dati;
}

async function chiediClaude(domanda) {
  domanda = domanda.trim();
  if (!domanda || statoClaude === 'pensa') return;
  const v = videoCorrente;
  if (!v) return;
  $('claude-domanda').textContent = '🗣 ' + domanda;
  $('claude-risposta').textContent = '';
  impostaStatoClaude('pensa', 'Claude sta pensando…');
  try {
    if (chatClaude.idVideo !== v.id) {
      chatClaude = { idVideo: v.id, sistema: istruzioniClaude(v, await contestoVideo(v)), messaggi: [] };
    }
    const minuto = tempoAttuale() > 5 ? `(Sono al minuto ${formatTempo(tempoAttuale())}.) ` : '';
    chatClaude.messaggi.push({ role: 'user', content: minuto + domanda });
    let risposta;
    try {
      risposta = await chiamaClaude();
    } catch (err) {
      chatClaude.messaggi.pop(); // la domanda non è andata a buon fine: si potrà rifare
      throw err;
    }
    if (risposta.stop_reason === 'refusal') {
      chatClaude.messaggi.pop();
      mostraRispostaClaude('Su questo preferisco non rispondere. Prova a chiedermelo in un altro modo.');
      return;
    }
    // la risposta torna intera nella conversazione (anche i blocchi che non si vedono)
    chatClaude.messaggi.push({ role: 'assistant', content: risposta.content });
    const testo = (risposta.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    mostraRispostaClaude(testo || 'Non ho una risposta, prova a chiedere in un altro modo.');
  } catch (err) {
    impostaStatoClaude('fermo', err instanceof TypeError ? 'Nessuna connessione: controlla internet e riprova.' : err.message);
  }
}

// Mostra la risposta e la fa leggere al telefono
function mostraRispostaClaude(testo) {
  $('claude-risposta').textContent = testo;
  if (!('speechSynthesis' in window)) {
    impostaStatoClaude('fermo', 'Tocca il cerchio per un\'altra domanda');
    return;
  }
  speechSynthesis.cancel();
  const voce = new SpeechSynthesisUtterance(testo.replace(/[*#_`]/g, ''));
  voce.lang = 'it-IT';
  const italiana = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith('it'));
  if (italiana) voce.voice = italiana;
  voce.onend = voce.onerror = () => {
    if (statoClaude === 'parla') impostaStatoClaude('fermo', 'Tocca il cerchio per un\'altra domanda');
  };
  impostaStatoClaude('parla', 'Claude sta parlando… (tocca il cerchio per interromperlo)');
  speechSynthesis.speak(voce);
}

function zittisciClaude() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (ascoltoClaude) { ascoltoClaude.onend = null; ascoltoClaude.abort(); ascoltoClaude = null; }
}

function ascoltaClaude() {
  if (!SpeechRec) {
    $('claude-testo').focus();
    impostaStatoClaude('fermo', 'Il microfono qui non è disponibile: scrivi la domanda.');
    return;
  }
  zittisciClaude();
  const rec = new SpeechRec();
  ascoltoClaude = rec;
  rec.lang = 'it-IT';
  rec.interimResults = true;
  let detto = '';
  rec.onresult = (e) => {
    detto = [...e.results].map((x) => x[0].transcript).join('');
    $('claude-domanda').textContent = '🗣 ' + detto;
  };
  rec.onerror = (e) => {
    rec.onend = null;
    ascoltoClaude = null;
    impostaStatoClaude('fermo', e.error === 'not-allowed'
      ? 'Il microfono è bloccato: permettilo all\'app oppure scrivi la domanda.'
      : 'Non ho sentito nulla: tocca il cerchio e riprova.');
  };
  rec.onend = () => {
    ascoltoClaude = null;
    if (detto.trim()) chiediClaude(detto);
    else impostaStatoClaude('fermo', 'Non ho sentito nulla: tocca il cerchio e riprova.');
  };
  $('claude-domanda').textContent = '';
  impostaStatoClaude('ascolta', 'Ti ascolto…');
  rec.start();
}

function apriClaude() {
  comandoPlayer('pauseVideo');
  $('audio-player').pause();
  $('btn-claude').classList.add('hidden');
  $('claude-box').classList.remove('hidden');
  const senzaChiave = !leggiChiaveClaude();
  $('claude-impostazioni').classList.toggle('hidden', !senzaChiave);
  $('claude-form').classList.toggle('hidden', senzaChiave);
  $('claude-cerchio').disabled = senzaChiave;
  if (senzaChiave) {
    impostaStatoClaude('fermo', 'Per parlare con Claude serve la tua chiave di Claude: inseriscila nelle Impostazioni.');
    return;
  }
  if (chatClaude.idVideo !== videoCorrente?.id) {
    $('claude-domanda').textContent = '';
    $('claude-risposta').textContent = '';
  }
  impostaStatoClaude('fermo', 'Tocca il cerchio e fai la tua domanda');
}

function chiudiClaude() {
  zittisciClaude();
  impostaStatoClaude('fermo');
  $('claude-box').classList.add('hidden');
  $('btn-claude').classList.remove('hidden');
}

$('btn-claude').addEventListener('click', apriClaude);
$('claude-chiudi').addEventListener('click', chiudiClaude);
$('claude-cerchio').addEventListener('click', () => {
  if (statoClaude === 'pensa') return;
  if (statoClaude === 'ascolta') { ascoltoClaude?.stop(); return; }
  ascoltaClaude(); // da fermo, o interrompendo Claude mentre parla
});
$('claude-form').addEventListener('submit', (e) => {
  e.preventDefault();
  zittisciClaude();
  const t = $('claude-testo').value;
  $('claude-testo').value = '';
  chiediClaude(t);
});
$('claude-impostazioni').addEventListener('click', () => $('btn-settings').click());

document.addEventListener('videoaperto', chiudiClaude);
document.addEventListener('videochiuso', chiudiClaude);
// alcune voci del telefono arrivano solo dopo un attimo
if ('speechSynthesis' in window) speechSynthesis.getVoices();

// ---------- Impostazioni: chiave di Claude ----------
function aggiornaInfoChiaveClaude() {
  $('claude-key').value = '';
  $('claude-key').placeholder = leggiChiaveClaude() ? '•••••••• (chiave salvata)' : 'sk-ant-...';
}
$('btn-settings').addEventListener('click', aggiornaInfoChiaveClaude);
$('btn-save-claude').addEventListener('click', () => {
  const k = $('claude-key').value.trim();
  if (!k && !leggiChiaveClaude()) return;
  if (!k && !confirm('Cancellare la chiave di Claude da questo telefono?')) return;
  try { k ? localStorage.setItem(CHIAVE_CLAUDE, k) : localStorage.removeItem(CHIAVE_CLAUDE); } catch {}
  aggiornaInfoChiaveClaude();
  $('claude-key-info').textContent = k ? 'Chiave di Claude salvata su questo telefono.' : 'Chiave di Claude cancellata.';
});
