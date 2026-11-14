// ---------- Podcast: ricerca nel catalogo pubblico di Apple Podcasts ----------
// Gratis, senza account e senza chiavi. Quasi tutti i podcast sono pubblicati anche lì
// (restano fuori solo gli esclusivi di Spotify). L'audio si ascolta con il lettore dell'app.
// (Spotify non è usabile: per le app nuove in prova vuole un proprietario con Premium.)

const PODCAST_PER_RICERCA = 48; // una sola richiesta, poi le pagine da 4 si sfogliano senza chiedere altro

// Episodio del catalogo Apple → elemento per mostraVideo / player / Mi piace
const daEpisodioApple = (r) => ({
  id: 'pod' + r.trackId, // prefisso: non si confonde mai con gli id dei video YouTube
  title: r.trackName,
  channel: r.collectionName || 'Podcast',
  thumb: r.artworkUrl160 || r.artworkUrl600 || r.artworkUrl60 || '',
  cover: r.artworkUrl600 || r.artworkUrl160 || '',
  audio: (r.episodeUrl || '').replace(/^http:/, 'https:'), // la pagina è https: anche l'audio deve esserlo
  link: r.trackViewUrl || '',
  date: r.releaseDate,
  durata: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
  fonte: 'podcast',
  descrizione: (r.description || r.shortDescription || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
});

// Chiamata da caricaPaginaRicerca in app.js
async function caricaPaginaPodcast(i) {
  try {
    if (!ricerca.tuttiPodcast) {
      const url = new URL('https://itunes.apple.com/search');
      url.search = new URLSearchParams({
        term: ricerca.query, media: 'podcast', entity: 'podcastEpisode',
        country: 'IT', limit: String(PODCAST_PER_RICERCA),
      });
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      ricerca.tuttiPodcast = (d.results || []).filter((x) => x.episodeUrl).map(daEpisodioApple);
    }
    const tutti = ricerca.tuttiPodcast;
    ricerca.pagine[i] = tutti.slice(i * NUM_RISULTATI, (i + 1) * NUM_RISULTATI);
    ricerca.token[i + 1] = (i + 1) * NUM_RISULTATI < tutti.length ? 'altre' : undefined;
    return true;
  } catch (err) {
    setStatus('Errore nella ricerca dei podcast: ' + err.message);
    return false;
  }
}

// Ricerca dello stesso episodio nell'app Spotify (per ascoltarlo lì o mandarlo a TV e casse)
function linkCercaSpotify(v) {
  return 'https://open.spotify.com/search/' + encodeURIComponent(`${v.title} ${v.channel || ''}`.trim());
}
