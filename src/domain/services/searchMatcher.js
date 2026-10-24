// Lógica compartida de filtrado por keywords (frases exactas "...", palabras obligatorias y exclusiones -...)
// usada por todos los proveedores para descartar anuncios que no cumplen el criterio de búsqueda.

function normalizeText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSearchKeywords(rawKeywords) {
  const requiredPhrases = [];
  const requiredWords = [];
  const excludedTerms = [];
  const positiveSearchParts = [];

  if (!rawKeywords || !String(rawKeywords).trim()) {
    return { requiredPhrases, requiredWords, excludedTerms, cleanSearchText: '' };
  }

  // Normalizar comillas tipográficas (“ ”, « », etc.) a comillas dobles estándar (")
  const normalizedQuotes = String(rawKeywords)
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB“”„«»]/g, '"')
    .trim();

  const tokenRegex = /(-?\s*"[^"]+")|(\S+)/g;
  let match;
  while ((match = tokenRegex.exec(normalizedQuotes)) !== null) {
    const quotedToken = match[1];
    const plainToken = match[2];

    if (quotedToken) {
      const trimmed = quotedToken.trim();
      const isNegated = trimmed.startsWith('-');
      const inner = trimmed.replace(/^-?\s*"/, '').replace(/"$/, '').trim();
      if (!inner) continue;

      if (isNegated) {
        excludedTerms.push(inner);
      } else if (inner.startsWith('-') && inner.length > 1) {
        excludedTerms.push(inner.slice(1).trim());
      } else {
        requiredPhrases.push(inner);
        positiveSearchParts.push(inner);
      }
    } else if (plainToken) {
      const cleaned = plainToken.replace(/^"+|"+$/g, '').trim();
      if (!cleaned || cleaned === '-') continue;

      if (cleaned.startsWith('-') && cleaned.length > 1) {
        const excl = cleaned.slice(1).replace(/^"+|"+$/g, '').trim();
        if (excl) excludedTerms.push(excl);
      } else {
        requiredWords.push(cleaned);
        positiveSearchParts.push(cleaned);
      }
    }
  }

  return {
    requiredPhrases,
    requiredWords,
    excludedTerms,
    cleanSearchText: positiveSearchParts.join(' ').replace(/\s+/g, ' ').trim()
  };
}

function buildTermRegex(rawTerm) {
  const norm = normalizeText(rawTerm).trim();
  if (!norm) return null;

  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const wordPatterns = words.map(word => {
    if (word.includes('-')) {
      const subParts = word.split('-').filter(Boolean).map(p => escapeRegex(p));
      return subParts.join('[\\s\\-_/.]*');
    }
    return escapeRegex(word);
  });

  const corePattern = wordPatterns.join('[\\s\\-_/,.:;|+]+');
  const lastWord = words[words.length - 1];
  const isLastWordNumeric = /^\d+$/.test(lastWord);

  const endBoundary = isLastWordNumeric
    ? '(?:gb|tb|mb|go|to|kb|p|pulgadas|pouces|inch|inches|cm|mm|m|hz|khz|mhz|ghz|w|mah)?(?![a-z0-9])'
    : '(?![a-z0-9])';

  return new RegExp(`(?<![a-z0-9])${corePattern}${endBoundary}`, 'i');
}

function matchesTerm(normalizedHaystack, rawTerm) {
  const regex = buildTermRegex(rawTerm);
  if (!regex) return true;
  return regex.test(normalizedHaystack);
}

function isSet(value) {
  return value !== undefined && value !== null && value !== '';
}

// Valida el precio contra min_price / max_price de la búsqueda
function matchesPriceRange(rawAmount, searchConfig) {
  const amount = Number(rawAmount);
  if (isNaN(amount)) return true;
  if (isSet(searchConfig.min_price) && amount < Number(searchConfig.min_price)) return false;
  if (isSet(searchConfig.max_price) && amount > Number(searchConfig.max_price)) return false;
  return true;
}

// Valida keywords (frases exactas, palabras obligatorias, exclusiones) y extra_filters.excluded
// contra un texto ya normalizado con normalizeText().
function matchesKeywordQuery(normalizedHaystack, searchConfig) {
  const { requiredPhrases, requiredWords, excludedTerms } = parseSearchKeywords(searchConfig.keywords);

  for (const term of [...requiredPhrases, ...requiredWords]) {
    if (!matchesTerm(normalizedHaystack, term)) return false;
  }

  for (const excluded of excludedTerms) {
    if (matchesTerm(normalizedHaystack, excluded)) return false;
  }

  const extra = (searchConfig.extra_filters && typeof searchConfig.extra_filters === 'object')
    ? searchConfig.extra_filters
    : {};

  if (extra.excluded && String(extra.excluded).trim() !== '') {
    const extraExcludedParsed = parseSearchKeywords(String(extra.excluded).replace(/,/g, ' '));
    const allExtraExcluded = [
      ...extraExcludedParsed.requiredPhrases,
      ...extraExcludedParsed.requiredWords,
      ...extraExcludedParsed.excludedTerms
    ];
    for (const excluded of allExtraExcluded) {
      if (matchesTerm(normalizedHaystack, excluded)) return false;
    }
  }

  return true;
}

module.exports = {
  normalizeText,
  escapeRegex,
  parseSearchKeywords,
  buildTermRegex,
  matchesTerm,
  matchesPriceRange,
  matchesKeywordQuery
};
