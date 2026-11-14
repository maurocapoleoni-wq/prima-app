// ---------- Mi piace: video salvati nelle liste (stessi nomi delle liste del Feed) ----------
// Restano solo su questo telefono, su YouTube non cambia nulla.
// Struttura salvata: { idListaFeed: [{ id, title, channel, thumb, date, salvato }] }, il più recente prima.
// Le liste sono collegate per id: se rinomini una lista del Feed, i video salvati la seguono.
// Se elimini una lista dal Feed, in "Mi piace" resta con i suoi video: si cancella solo da qui.

const statusSalvati = (t) => { $('status-salvati').textContent = t; };
const leggiSalvati = () => leggi(K.salvati, {});
const scriviSalvati = (s) => scrivi(K.salvati, s);
let listaSalvatiAttiva = null;
// Lista fissa "Guarda più tardi": c'è sempre, si riempie con il pulsante 🕒 nel player
const ID_DOPO = 'guarda-dopo';
const NOME_DOPO = '🕒 Guarda più tardi';
let paginaSalvati = 0;

// Liste di "Mi piace": quelle del Feed, poi quelle "solo in Mi piace" (eliminate dal Feed,
// o create con "+ Nuova lista" salvando un video) finché contengono almeno un video.
// In testa, sempre presente, "Guarda più tardi".
function listeSalvati() {
  const feed = leggiListe().map((l) => ({ id: l.id, nome: l.nome, nelFeed: true }));
  const s = leggiSalvati();
  const nomi = leggi(K.salvatiNomi, {});
  const soloQui = Object.keys(s)
    .filter((id) => id !== ID_DOPO && s[id].length && !feed.some((l) => l.id === id))
    .map((id) => ({ id, nome: nomi[id] || 'Lista eliminata', nelFeed: false }));
  return [{ id: ID_DOPO, nome: NOME_DOPO, fissa: true }, ...feed, ...soloQui];
}

const contaVideo = (n) => (n === 1 ? 'il suo video salvato' : `i suoi ${n} video salvati`);

// ---------- Scheda "Mi piace" ----------
function mostraSalvati() {
  const liste = listeSalvati();
  const salvati = leggiSalvati();
  if (!liste.some((l) => l.id === listaSalvatiAttiva)) listaSalvatiAttiva = liste[0].id;

  const box = $('salvati-liste');
  box.innerHTML = '';
  for (const l of liste) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (l.id === listaSalvatiAttiva ? ' attiva' : '');
    b.setAttribute('aria-pressed', String(l.id === listaSalvatiAttiva));
    b.textContent = `${l.nome} (${(salvati[l.id] || []).length})`;
    b.addEventListener('click', () => {
      listaSalvatiAttiva = l.id;
      paginaSalvati = 0;
      mostraSalvati();
    });
    box.append(b);
  }

  const video = salvati[listaSalvatiAttiva] || [];
  const totale = Math.ceil(video.length / NUM_RISULTATI);
  paginaSalvati = Math.min(paginaSalvati, Math.max(0, totale - 1)); // dopo una rimozione
  const da = paginaSalvati * NUM_RISULTATI;
  // da qui il video si apre con il suo segmento (inizio/fine segnati nel player)
  const segmenti = leggiSegmenti();
  const pagina = video.slice(da, da + NUM_RISULTATI).map((v) => ({
    ...v,
    usaSegmento: true,
    nota: segmenti[v.id] ? '⏱ ' + testoSegmento(segmenti[v.id]) : '',
  }));
  mostraVideo($('results-salvati'), pagina, {
    onRimuovi: (v) => {
      if (confirm(`Togliere "${v.title}" da questa lista?`)) rimuoviSalvato(listaSalvatiAttiva, v.id);
    },
  });
  aggiornaPager($('pager-salvati'), `${paginaSalvati + 1} di ${totale}`, paginaSalvati > 0, paginaSalvati + 1 < totale, totale > 0);

  const lista = liste.find((l) => l.id === listaSalvatiAttiva);
  const dove = lista.nelFeed || lista.fissa ? '' : ' (solo in Mi piace)';
  const tasto = lista.fissa ? '🕒' : '♡';
  statusSalvati(video.length
    ? `${lista.nome}${dove}: ${video.length} ${video.length === 1 ? 'video salvato' : 'video salvati'}`
    : `Nessun video in "${lista.nome}". Apri un video e tocca ${tasto} per salvarlo qui.`);

  // Una lista del Feed (o "Guarda più tardi") qui si può solo svuotare;
  // una lista non più nel Feed si elimina del tutto
  const btn = $('btn-salvati-elimina');
  btn.textContent = lista.nelFeed || lista.fissa ? 'Svuota lista' : 'Elimina lista';
  btn.disabled = video.length === 0;
  $('btn-salvati-condividi').disabled = video.length === 0;
}

// Condivide tutta la lista in un messaggio: titoli e link numerati (con i segmenti segnati)
$('btn-salvati-condividi').addEventListener('click', () => {
  const lista = listeSalvati().find((l) => l.id === listaSalvatiAttiva);
  const video = leggiSalvati()[lista?.id] || [];
  if (!video.length) return;
  const segmenti = leggiSegmenti();
  const righe = video.map((v, i) => `${i + 1}. ${testoVideo(v, segmenti[v.id])}`);
  const conteggio = video.length === 1 ? '1 video' : `${video.length} video`;
  condividi(lista.nome, `🎬 La mia lista "${lista.nome}" (${conteggio}):\n\n${righe.join('\n\n')}`);
});

$('btn-salvati-elimina').addEventListener('click', () => {
  const lista = listeSalvati().find((l) => l.id === listaSalvatiAttiva);
  const n = (leggiSalvati()[lista?.id] || []).length;
  if (!lista || !n) return;
  const resta = lista.nelFeed || lista.fissa;
  const domanda = resta
    ? `Svuotare "${lista.nome}"? ${n === 1 ? 'Verrà tolto' : 'Verranno tolti'} ${contaVideo(n)}.${lista.nelFeed ? ' La lista resta nel Feed.' : ''}`
    : `Eliminare la lista "${lista.nome}" e ${contaVideo(n)}? Non si può annullare.`;
  if (!confirm(domanda)) return;
  const s = leggiSalvati();
  delete s[lista.id];
  scriviSalvati(s);
  const nomi = leggi(K.salvatiNomi, {});
  delete nomi[lista.id];
  scrivi(K.salvatiNomi, nomi);
  if (!resta) listaSalvatiAttiva = null;
  paginaSalvati = 0;
  mostraSalvati();
  statusSalvati(resta ? `"${lista.nome}" svuotata.` : `Lista "${lista.nome}" eliminata.`);
});

function rimuoviSalvato(idLista, idVideo) {
  const s = leggiSalvati();
  s[idLista] = (s[idLista] || []).filter((v) => v.id !== idVideo);
  scriviSalvati(s);
  mostraSalvati();
}

$('pager-salvati').querySelector('.next').addEventListener('click', () => { paginaSalvati++; mostraSalvati(); });
$('pager-salvati').querySelector('.prev').addEventListener('click', () => { paginaSalvati--; mostraSalvati(); });

// ---------- Nel player: ♡ per salvare il video in una o più liste ----------
function listeConVideo(idVideo) {
  const s = leggiSalvati();
  return new Set(Object.keys(s).filter((k) => s[k].some((v) => v.id === idVideo)));
}

function aggiornaCuore() {
  // il cuore riguarda le liste di Mi piace; "Guarda più tardi" ha il suo pulsante 🕒
  const dentro = videoCorrente ? listeConVideo(videoCorrente.id) : new Set();
  const dopo = dentro.delete(ID_DOPO);
  const salvato = dentro.size > 0;
  const btn = $('btn-salva');
  btn.textContent = salvato ? '♥' : '♡';
  btn.classList.toggle('salvato', salvato);
  btn.setAttribute('aria-label', salvato ? 'Salvato in Mi piace: modifica' : 'Metti Mi piace');
  const orologio = $('btn-dopo');
  orologio.classList.toggle('salvato', dopo);
  orologio.setAttribute('aria-pressed', String(dopo));
  orologio.setAttribute('aria-label', dopo ? 'In Guarda più tardi: tocca per toglierlo' : 'Aggiungi a Guarda più tardi');
}

function mostraSceltaSalva() {
  if (!videoCorrente) return;
  const dentro = listeConVideo(videoCorrente.id);
  const box = $('salva-liste');
  box.innerHTML = '';
  for (const l of listeSalvati().filter((x) => !x.fissa)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (dentro.has(l.id) ? ' attiva' : '');
    b.setAttribute('aria-pressed', String(dentro.has(l.id)));
    b.textContent = (dentro.has(l.id) ? '✓ ' : '') + l.nome;
    b.addEventListener('click', () => cambiaSalvato(l.id));
    box.append(b);
  }
  const nuova = document.createElement('button');
  nuova.type = 'button';
  nuova.className = 'chip nuova';
  nuova.textContent = '+ Nuova lista';
  nuova.addEventListener('click', salvaInNuovaLista);
  box.append(nuova);
  $('salva-scelta').classList.remove('hidden');
}

// Crea una lista solo in "Mi piace" (non nel Feed) e ci salva il video in riproduzione.
// Se esiste già una lista con quel nome, usa quella.
function salvaInNuovaLista() {
  const nome = (prompt('Nome della nuova lista:') || '').trim().slice(0, 30);
  if (!nome) return;
  const esistente = listeSalvati().find((l) => !l.fissa && norm(l.nome) === norm(nome));
  if (esistente) {
    if (!listeConVideo(videoCorrente.id).has(esistente.id)) cambiaSalvato(esistente.id);
    return;
  }
  const id = crypto.randomUUID();
  const nomi = leggi(K.salvatiNomi, {});
  nomi[id] = nome;
  scrivi(K.salvatiNomi, nomi);
  cambiaSalvato(id); // la lista esiste da quando contiene il video
}

// Tocca una lista: se il video c'è lo toglie, altrimenti lo aggiunge in cima
function cambiaSalvato(idLista) {
  const v = videoCorrente;
  const s = leggiSalvati();
  const lista = s[idLista] || [];
  s[idLista] = lista.some((x) => x.id === v.id)
    ? lista.filter((x) => x.id !== v.id)
    : [{
      id: v.id, title: v.title, channel: v.channel || '', thumb: v.thumb || '', date: v.date,
      // episodio di podcast: serve anche l'indirizzo dell'audio per riascoltarlo da Mi piace
      ...(v.fonte === 'podcast' && { fonte: 'podcast', audio: v.audio, cover: v.cover, link: v.link }),
      salvato: new Date().toISOString(),
    }, ...lista];
  scriviSalvati(s);
  if (!$('salva-scelta').classList.contains('hidden')) mostraSceltaSalva();
  aggiornaCuore();
}

// 🕒 nel player: aggiunge (o toglie) il video dalla lista "Guarda più tardi" di Mi piace
$('btn-dopo').addEventListener('click', () => {
  if (!videoCorrente) return;
  cambiaSalvato(ID_DOPO);
});

$('btn-salva').addEventListener('click', () => {
  if ($('salva-scelta').classList.contains('hidden')) mostraSceltaSalva();
  else $('salva-scelta').classList.add('hidden');
});
$('btn-salva-chiudi').addEventListener('click', () => $('salva-scelta').classList.add('hidden'));

document.addEventListener('videoaperto', () => {
  $('salva-scelta').classList.add('hidden');
  aggiornaCuore();
});
// Tornando dal player, la scheda "Mi piace" mostra le modifiche fatte con il cuore
document.addEventListener('videochiuso', () => {
  if (!$('tab-salvati').classList.contains('hidden')) mostraSalvati();
});

// ---------- Avvio ----------
if (!$('tab-salvati').classList.contains('hidden')) mostraSalvati();
