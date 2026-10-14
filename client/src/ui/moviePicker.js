import { searchMovies } from '../api.js';

const GENRES = [
  ['all', 'All films'],
  ['horror', 'Horror'],
  ['sci-fi', 'Sci-fi'],
  ['comedy', 'Comedy'],
  ['crime', 'Crime & noir'],
  ['western', 'Western'],
  ['animation', 'Animation'],
  ['documentary', 'Documentary'],
];

function makeButton(label, className = 'btn-ghost') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function cleanDescription(value) {
  return new DOMParser().parseFromString(String(value || ''), 'text/html').body.textContent
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderMoviePicker({ container = document.body, onPlay, onClose = () => {} }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'movie-picker-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'glass movie-picker-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'movie-picker-title');

  const header = document.createElement('header');
  header.className = 'movie-picker-header';
  const headingWrap = document.createElement('div');
  const eyebrow = document.createElement('div');
  eyebrow.className = 'movie-picker-eyebrow';
  eyebrow.textContent = 'INTERNET ARCHIVE · PUBLIC DOMAIN';
  const title = document.createElement('h2');
  title.id = 'movie-picker-title';
  title.textContent = 'Movie library';
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Pick a film and it will play on the cinema screen for everyone in the room.';
  headingWrap.append(eyebrow, title, subtitle);
  const closeBtn = makeButton('×', 'movie-picker-close');
  closeBtn.setAttribute('aria-label', 'Close movie library');
  header.append(headingWrap, closeBtn);

  const filters = document.createElement('div');
  filters.className = 'movie-picker-filters';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'text-input movie-search-input';
  searchInput.placeholder = 'Search titles, people, or topics';
  searchInput.setAttribute('aria-label', 'Search movie library');

  const genreSelect = document.createElement('select');
  genreSelect.className = 'text-input movie-genre-select';
  genreSelect.setAttribute('aria-label', 'Filter movies by genre');
  for (const [value, label] of GENRES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    genreSelect.appendChild(option);
  }
  filters.append(searchInput, genreSelect);

  const resultsSummary = document.createElement('div');
  resultsSummary.className = 'movie-results-summary';
  const resultsGrid = document.createElement('div');
  resultsGrid.className = 'movie-results-grid';
  resultsGrid.setAttribute('aria-live', 'polite');

  const footer = document.createElement('footer');
  footer.className = 'movie-picker-footer';
  const sourceNote = document.createElement('span');
  sourceNote.textContent = 'Free-to-watch classics hosted by Internet Archive.';
  const pagination = document.createElement('div');
  pagination.className = 'movie-pagination';
  const previousBtn = makeButton('Previous');
  const pageLabel = document.createElement('span');
  const nextBtn = makeButton('Next', 'btn-gold');
  pagination.append(previousBtn, pageLabel, nextBtn);
  footer.append(sourceNote, pagination);

  dialog.append(header, filters, resultsSummary, resultsGrid, footer);
  backdrop.appendChild(dialog);
  container.appendChild(backdrop);

  let page = 1;
  let pageCount = 1;
  let resultCount = 0;
  let requestToken = 0;
  let debounceTimer = null;
  let isClosed = false;
  let isPlaying = false;

  function close() {
    if (isClosed) return;
    isClosed = true;
    clearTimeout(debounceTimer);
    window.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    onClose();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }

  function setLoading(message) {
    resultsSummary.textContent = message;
    resultsGrid.replaceChildren();
  }

  function renderCards(items) {
    resultsGrid.replaceChildren();
    for (const movie of items) {
      const card = document.createElement('article');
      card.className = 'movie-card';

      const badge = document.createElement('span');
      badge.className = 'movie-card-badge';
      badge.textContent = 'PUBLIC DOMAIN';

      const movieTitle = document.createElement('h3');
      movieTitle.textContent = movie.title;
      const meta = document.createElement('div');
      meta.className = 'movie-card-meta';
      meta.textContent = [movie.year, movie.creator].filter(Boolean).join(' · ') || 'Classic feature film';

      const description = document.createElement('p');
      description.className = 'movie-card-description';
      description.textContent = cleanDescription(movie.description) || 'A public-domain feature film from the Internet Archive collection.';

      const actions = document.createElement('div');
      actions.className = 'movie-card-actions';
      const playBtn = makeButton('Play for the room', 'btn-gold');
      playBtn.addEventListener('click', async () => {
        if (isPlaying) return;
        isPlaying = true;
        playBtn.disabled = true;
        playBtn.textContent = 'Loading film…';
        try {
          if (await onPlay(movie)) close();
        } finally {
          isPlaying = false;
          if (!isClosed) {
            playBtn.disabled = false;
            playBtn.textContent = 'Play for the room';
          }
        }
      });

      const sourceLink = document.createElement('a');
      sourceLink.className = 'movie-source-link';
      sourceLink.href = movie.detailsUrl;
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.textContent = 'Details ↗';
      actions.append(playBtn, sourceLink);
      card.append(badge, movieTitle, meta, description, actions);
      resultsGrid.appendChild(card);
    }
  }

  async function loadPage() {
    const token = ++requestToken;
    setLoading('Loading the movie library…');
    previousBtn.disabled = true;
    nextBtn.disabled = true;
    try {
      const response = await searchMovies({
        query: searchInput.value,
        genre: genreSelect.value,
        page,
      });
      if (isClosed || token !== requestToken) return;
      const items = Array.isArray(response.items) ? response.items : [];
      resultCount = Number(response.total) || items.length;
      pageCount = Math.max(1, Math.ceil(resultCount / (Number(response.pageSize) || 24)));
      page = Math.min(page, pageCount);
      resultsSummary.textContent = resultCount
        ? 'Public-domain feature films · popular titles first'
        : 'No films matched. Try a different title or genre.';
      renderCards(items);
      pageLabel.textContent = `Page ${page} of ${pageCount}`;
      previousBtn.disabled = page <= 1;
      nextBtn.disabled = page >= pageCount;
    } catch (err) {
      if (isClosed || token !== requestToken) return;
      setLoading(err.message || 'Could not load the movie library.');
      pageLabel.textContent = '';
    }
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    page = 1;
    debounceTimer = setTimeout(loadPage, 250);
  });
  genreSelect.addEventListener('change', () => {
    page = 1;
    loadPage();
  });
  previousBtn.addEventListener('click', () => {
    if (page <= 1) return;
    page -= 1;
    loadPage();
  });
  nextBtn.addEventListener('click', () => {
    if (page >= pageCount) return;
    page += 1;
    loadPage();
  });

  window.addEventListener('keydown', onKeyDown);
  searchInput.focus();
  loadPage();
  return { close };
}
