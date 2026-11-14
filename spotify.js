// ---------- Spotify: accesso e ricerca di episodi di podcast ----------
// Client ID della registrazione su developer.spotify.com ("Cerca e Guarda"). Non è segreto.
// L'accesso usa il metodo "PKCE", pensato per le app senza server: nessuna chiave segreta nel codice.
const SPOTIFY_CLIENT_ID = 'df8288238daa43399f6350d6fd09a56e';
const SP_REDIRECT = new URL('./', location.href).href; // deve coincidere con il Redirect URI registrato
const SP_SCOPE = 'user-library-read'; // servirà nella fase 2 per i podcast che segui
const SP = { token: 'sp_token', verifier: 'sp_verifier', state: 'sp_state', dopo: 'sp_dopo' };

// ---------- Accesso ----------
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const casuale = (n) => base64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(testo) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testo))));
}

// dopo = cosa riprendere al ritorno da Spotify, es. { azione: 'cerca', query: 'cucina' }
async function accediSpotify(dopo) {
  const verifier = casuale(64);
  const state = casuale(16);
  scrivi(SP.verifier, verifier);
  scrivi(SP.state, state);
  scrivi(SP.dopo, dopo || null);
  const p = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SP_REDIRECT,
    scope: SP_SCOPE,
    code_challenge_method: 'S256',
    code_challenge: await sha256(verifier),
    state,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}

async function chiediToken(campi) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...campi }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || r.status);
  const vecchio = leggi(SP.token, {}) || {};
  scrivi(SP.token, {
    valore: d.access_token,
    refresh: d.refresh_token || vecchio.refresh, // Spotify a volte non ne manda uno nuovo
    scade: Date.now() + (d.expires_in || 3600) * 1000,
  });
}

// Ritorno da Spotify (…/prima-app/?code=…&state=…): null se l'indirizzo non è una risposta di Spotify
async function leggiRispostaSpotify() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return null;
  if (!p.has('state') || p.get('state') !== leggi(SP.state, null)) return null; // non è nostra
  history.replaceState(null, '', location.pathname);
  const dopo = leggi(SP.dopo, null);
  const verifier = leggi(SP.verifier, null);
  scrivi(SP.state, null);
  scrivi(SP.verifier, null);
  scrivi(SP.dopo, null);
  if (p.has('error')) return { ok: false, dopo, errore: 'Accesso a Spotify annullato.' };
  try {
    await chiediToken({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: SP_REDIRECT, code_verifier: verifier });
    return { ok: true, dopo };
  } catch (err) {
    return { ok: false, dopo, errore: 'Accesso a Spotify non riuscito: ' + err.message };
  }
}

// Token valido, rinnovato da solo quando scade; null se serve rifare l'accesso
async function tokenSpotify() {
  const t = leggi(SP.token, null);
  if (!t) return null;
  if (t.scade > Date.now() + 60_000) return t.valore;
  if (!t.refresh) return null;
  try {
    await chiediToken({ grant_type: 'refresh_token', refresh_token: t.refresh });
    return leggi(SP.token, null).valore;
  } catch {
    scrivi(SP.token, null);
    return null;
  }
}

function esciSpotify() {
  scrivi(SP.token, null);
  aggiornaAccountSpotify();
}

function aggiornaAccountSpotify() {
  $('btn-esci-sp').classList.toggle('hidden', !leggi(SP.token, null));
}
$('btn-esci-sp').addEventListener('click', esciSpotify);

// ---------- Chiamate a Spotify ----------
class ServeAccesso extends Error {}

async function sp(percorso, params) {
  const token = await tokenSpotify();
  if (!token) throw new ServeAccesso();
  const url = new URL('https://api.spotify.com/v1/' + percorso);
  url.search = new URLSearchParams(params);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { scrivi(SP.token, null); throw new ServeAccesso(); }
  // Spotify di solito risponde in JSON, ma per alcuni rifiuti manda solo testo semplice
  const testoRisposta = await r.text();
  let d = {};
  try { d = JSON.parse(testoRisposta); } catch { d = { error: { message: testoRisposta.trim().slice(0, 200) } }; }
  if (r.status === 403) {
    // Mostro le parole esatte di Spotify: il rifiuto può avere motivi diversi
    // (utente non in User Management, abbonamento richiesto, funzione non disponibile…)
    const motivo = d.error?.message || 'accesso negato';
    throw new Error(`Spotify rifiuta la richiesta (403): "${motivo}". Se è un problema di utenti, `
      + "controlla User Management su developer.spotify.com");
  }
  if (r.status === 429) throw new Error('troppe richieste a Spotify, riprova tra poco');
  if (!r.ok) throw new Error(d.error?.message || r.status);
  return d;
}

// Episodio Spotify → elemento per mostraVideo
const daEpisodio = (e) => ({
  id: e.id,
  title: e.name,
  channel: e.show?.name || 'Podcast',
  thumb: e.images?.[1]?.url || e.images?.[0]?.url || '',
  date: e.release_date,
  fonte: 'spotify',
});

// ---------- Ricerca (chiamata da caricaPaginaRicerca in app.js) ----------
async function caricaPaginaSpotify(i) {
  try {
    const d = await sp('search', {
      q: ricerca.query, type: 'episode', market: 'from_token',
      limit: String(NUM_RISULTATI), offset: String(i * NUM_RISULTATI),
    });
    const trovati = (d.episodes?.items || []).filter(Boolean);
    // la ricerca non dice di quale podcast è ogni episodio: lo chiedo con una seconda richiesta
    let completi = trovati;
    if (trovati.length) {
      const e = await sp('episodes', { ids: trovati.map((x) => x.id).join(','), market: 'from_token' });
      completi = (e.episodes || []).filter(Boolean);
    }
    ricerca.pagine[i] = completi.map(daEpisodio);
    ricerca.token[i + 1] = d.episodes?.next ? 'altre' : undefined;
    return true;
  } catch (err) {
    if (err instanceof ServeAccesso) {
      setStatus('Ti porto su Spotify per accedere…');
      accediSpotify({ azione: 'cerca', query: ricerca.query });
      return false;
    }
    setStatus('Errore Spotify: ' + err.message);
    return false;
  }
}

// ---------- Avvio: ritorno dalla pagina di accesso di Spotify ----------
(async () => {
  aggiornaAccountSpotify();
  const ritorno = await leggiRispostaSpotify();
  if (!ritorno) return;
  aggiornaAccountSpotify();
  mostraTab('cerca');
  if (!ritorno.ok) { setStatus(ritorno.errore); return; }
  if (ritorno.dopo?.azione === 'cerca' && ritorno.dopo.query) {
    $('text-query').value = ritorno.dopo.query;
    cerca(ritorno.dopo.query, 'spotify');
  } else {
    setStatus('Accesso a Spotify fatto: tocca il lato verde e parla.');
  }
})();
