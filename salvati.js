// ---------- Mi piace: video salvati nelle liste (stessi nomi delle liste del Feed) ----------
// Restano solo su questo telefono, su YouTube non cambia nulla.
// Struttura salvata: { idListaFeed: [{ id, title, channel, thumb, date, salvato }] }, il più recente prima.
// Le liste sono collegate per id: se rinomini una lista del Feed, i video salvati la seguono.

const statusSalvati = (t) => { $('status-salvati').textContent = t; };
const leggiSalvati = () => leggi(K.salvati, {});
const scriviSalvati = (s) => scrivi(K.salvati, s);
let listaSalvatiAttiva = null;
let paginaSalvati = 0;

// ---------- Scheda "Mi piace" ----------
function mostraSalvati() {
  const liste = leggiListe();
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
  mostraVideo($('results-salvati'), video.slice(da, da + NUM_RISULTATI), {
    onRimuovi: (v) => {
      if (confirm(`Togliere "${v.title}" da questa lista?`)) rimuoviSalvato(listaSalvatiAttiva, v.id);
    },
  });
  aggiornaPager($('pager-salvati'), `${paginaSalvati + 1} di ${totale}`, paginaSalvati > 0, paginaSalvati + 1 < totale, totale > 0);

  const nome = liste.find((l) => l.id === listaSalvatiAttiva).nome;
  statusSalvati(video.length
    ? `${nome}: ${video.length} ${video.length === 1 ? 'video salvato' : 'video salvati'}`
    : `Nessun video in "${nome}". Apri un video e tocca ♡ per salvarlo qui.`);
}

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
  const salvato = !!videoCorrente && listeConVideo(videoCorrente.id).size > 0;
  const btn = $('btn-salva');
  btn.textContent = salvato ? '♥' : '♡';
  btn.classList.toggle('salvato', salvato);
  btn.setAttribute('aria-label', salvato ? 'Salvato in Mi piace: modifica' : 'Metti Mi piace');
}

function mostraSceltaSalva() {
  if (!videoCorrente) return;
  const dentro = listeConVideo(videoCorrente.id);
  const box = $('salva-liste');
  box.innerHTML = '';
  for (const l of leggiListe()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (dentro.has(l.id) ? ' attiva' : '');
    b.setAttribute('aria-pressed', String(dentro.has(l.id)));
    b.textContent = (dentro.has(l.id) ? '✓ ' : '') + l.nome;
    b.addEventListener('click', () => cambiaSalvato(l.id));
    box.append(b);
  }
  $('salva-scelta').classList.remove('hidden');
}

// Tocca una lista: se il video c'è lo toglie, altrimenti lo aggiunge in cima
function cambiaSalvato(idLista) {
  const v = videoCorrente;
  const s = leggiSalvati();
  const lista = s[idLista] || [];
  s[idLista] = lista.some((x) => x.id === v.id)
    ? lista.filter((x) => x.id !== v.id)
    : [{ id: v.id, title: v.title, channel: v.channel || '', thumb: v.thumb || '', date: v.date, salvato: new Date().toISOString() }, ...lista];
  scriviSalvati(s);
  mostraSceltaSalva();
  aggiornaCuore();
}

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
