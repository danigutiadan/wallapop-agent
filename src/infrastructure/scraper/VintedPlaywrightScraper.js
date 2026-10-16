const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');
const Item = require('../../domain/models/Item');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Categorías de Wallapop que no aplican al catálogo de Vinted (Inmobiliaria, Empleo, Servicios, Industria)
const UNSUPPORTED_WALLAPOP_CATEGORIES = new Set(['200', '21000', '13200', '20000']);

// Mapeo de IDs de categorías/subcategorías de Wallapop (categories.json) a catalog[] IDs de Vinted
const WALLAPOP_TO_VINTED_CATALOG_MAP = {
  // Categorías principales
  '12465': [1904, 5],       // Moda y accesorios -> Mujer, Hombre
  '24200': [2994],          // Tecnología y electrónica -> Electrónica
  '12579': [4332],          // Deporte y ocio -> Deportes
  '17000': [4333],          // Bicicletas -> Ciclismo
  '12467': [1918],          // Hogar y jardín -> Hogar
  '13100': [3474, 3478],    // Electrodomésticos -> Pequeños electrodomésticos / Cuidado del hogar
  '12463': [2309],          // Cine, libros y música -> Entretenimiento
  '12461': [1193],          // Niños y bebés -> Niños
  '18000': [4824],          // Coleccionismo -> Hobbies y coleccionismo
  '19000': [3811],          // Construcción y reformas -> Bricolaje y herramientas

  // Subcategorías Moda y accesorios
  '11002': [1904],          // Mujer
  '11021': [16],            // Mujer > Calzado
  '11004': [4],             // Mujer > Ropa
  '11003': [5],             // Hombre
  '11044': [1231],          // Hombre > Calzado
  '11031': [2050],          // Hombre > Ropa
  '10436': [1187, 82, 19],  // Accesorios (Mujer, Hombre, Bolsos)
  '10152': [19],            // Bolsos y mochilas
  '10156': [1187],          // Joyería
  '10437': [146, 139],      // Belleza

  // Subcategorías Tecnología y electrónica
  '10206': [3568],          // Imagen: televisores y proyectores -> TV y Home Cinema
  '24149': [3566],          // Sonido: auriculares y altavoces -> Sonido, auriculares y Hi-Fi
  '10200': [3054],          // Fotografía: cámaras y drones -> Cámaras y accesorios
  '24201': [3565, 3004],    // Telefonía: móviles y smartwatches -> Teléfonos móviles y Wearables
  '24202': [3564, 3567],    // Informática: ordenadores y tablets -> Ordenadores y Tablets
  '24203': [3002],          // Gaming: consolas y videojuegos -> Videojuegos y consolas

  // Subcategorías Deporte y ocio / Bicicletas
  '10094': [4337],          // Baloncesto -> Deportes de equipo
  '10095': [4337],          // Balonmano -> Deportes de equipo
  '10096': [4334],          // Estáticas y elípticas -> Fitness, running y yoga
  '10097': [4334],          // Fitness, running y yoga
  '10098': [4337],          // Fútbol -> Deportes de equipo
  '10099': [4339],          // Golf
  '10100': [4881, 4343],    // Juegos recreativos y de mesa
  '10101': [5151],          // Manualidades -> Arte y manualidades
  '10102': [4344, 4335],    // Montaña y esquí -> Deportes de invierno y aire libre
  '10103': [4336],          // Natación y accesorios piscina -> Deportes acuáticos
  '10106': [4341],          // Patinetes y patinaje -> Tablas de skate y patinetes
  '10107': [4337],          // Rugby -> Deportes de equipo
  '10108': [4338],          // Tenis y pádel -> Deportes de raqueta
  '10109': [4337],          // Vóley -> Deportes de equipo
  '10055': [4333],          // Accesorios para bicicletas
  '10056': [4333],          // Bicicletas y triciclos
  '10058': [4333],          // Piezas y recambios de bici
  '10059': [4333],          // Protección y vestimenta ciclismo

  // Subcategorías Hogar y jardín / Electrodomésticos
  '10125': [1934],          // Muebles y organización -> Decoración
  '10119': [1919, 1934],    // Baño y accesorios
  '10120': [3476, 3477, 1920], // Cocina -> Menaje y utensilios de cocina
  '10122': [1934],          // Decoración y espejos
  '10123': [1934],          // Iluminación
  '10124': [3812],          // Jardín y exteriores
  '10118': [5106],          // Artículos para mascotas
  '10111': [3474],          // Electrodomésticos de cocina
  '10112': [3478],          // Lavandería y plancha -> Cuidado del hogar
  '10113': [3474],          // Pequeños electrodomésticos

  // Subcategorías Cine, libros y música
  '24002': [3037],          // Cine y series -> Vídeo
  '24003': [2312, 5424],    // Libros, cómics y revistas
  '24001': [3036],          // Música

  // Subcategorías Niños y bebés
  '10177': [3393],          // Accesorios de baño -> Baño y cambio
  '10178': [3432],          // Alimentación del bebé -> Lactancia y alimentación
  '10179': [3419],          // Artículos de maternidad -> Salud y embarazo
  '10180': [1501],          // Artículos escolares -> Material escolar
  '10182': [3296],          // Cunas y camas -> Descanso y ropa de cama
  '10185': [1498],          // Mobiliario infantil -> Muebles y decoración
  '10188': [3427],          // Seguridad y cuidado
  '10181': [1497],          // Transporte del bebé -> Carritos, portabebés y sillas de coche
  '10189': [1498],          // Tronas y andadores

  // Subcategorías Coleccionismo / Motor
  '10078': [4888],          // Filatelia y sellos
  '10081': [4895],          // Monedas y billetes
  '10083': [4874],          // Naipes -> Cartas coleccionables
  '10085': [4894],          // Postales y suvenires
  '10164': [2995],          // GPS y electrónica
  '10165': [3811]           // Herramientas
};

// Mapeo de condición del frontal (Wallapop) a status_ids[] de Vinted
// Vinted: 6 = Nuevo con etiquetas, 1 = Nuevo sin etiquetas, 2 = Muy bueno, 3 = Bueno, 4 = Satisfactorio
const CONDITION_TO_VINTED_STATUS_IDS = {
  'new': [6, 1],
  'as_good_as_new': [6, 1, 2],
  'good': [2, 3],
  'fair': [3, 4],
  'has_given_it_all': [4]
};

// Mapeo de orden del frontal a Vinted
const ORDER_TO_VINTED = {
  'newest': 'newest_first',
  'price_low_to_high': 'price_low_to_high',
  'price_high_to_low': 'price_high_to_low'
};

class VintedPlaywrightScraper {
  constructor() {
    this.sellerStatsCache = new Map();
    this.browser = null;
    this.page = null;
    this.categoriesTree = this.loadCategoriesTree();
  }

  loadCategoriesTree() {
    try {
      const candidates = [
        path.resolve(__dirname, '../../domain/categories.json'),
        path.resolve(__dirname, '../../../../wallapop-frontend/src/app/features/searches/domain/categories.json'),
        path.resolve(process.cwd(), '../wallapop-frontend/src/app/features/searches/domain/categories.json')
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        }
      }
    } catch (e) {
      // Fallback silencioso al mapa estático
    }
    return [];
  }

  findCategoryPath(targetId, nodes = this.categoriesTree, currentPath = []) {
    if (!targetId || !Array.isArray(nodes)) return null;
    const targetStr = String(targetId);
    for (const node of nodes) {
      const nextPath = [...currentPath, node];
      if (String(node.id) === targetStr) {
        return nextPath;
      }
      if (Array.isArray(node.subcategories) && node.subcategories.length > 0) {
        const found = this.findCategoryPath(targetStr, node.subcategories, nextPath);
        if (found) return found;
      }
    }
    return null;
  }

  resolveVintedCategoryAndKeywords(searchConfig) {
    const extra = (searchConfig.extra_filters && typeof searchConfig.extra_filters === 'object')
      ? searchConfig.extra_filters
      : {};

    const rawCategoryId = searchConfig.category_id || searchConfig.category_ids || extra.category_id || extra.category_ids || '';
    const rawSubcategoryId = searchConfig.subcategory_ids || searchConfig.object_type_id || extra.subcategory_ids || extra.object_type_id || '';

    const categoryId = rawCategoryId ? String(rawCategoryId).trim() : '';
    const subcategoryId = rawSubcategoryId ? String(rawSubcategoryId).trim() : '';

    if (categoryId && UNSUPPORTED_WALLAPOP_CATEGORIES.has(categoryId)) {
      return { unsupported: true, catalogIds: [], extraKeyword: '' };
    }

    let catalogIds = [];
    let extraKeyword = '';

    // 1. Intentar mapeo directo de subcategoría
    if (subcategoryId && WALLAPOP_TO_VINTED_CATALOG_MAP[subcategoryId]) {
      catalogIds = WALLAPOP_TO_VINTED_CATALOG_MAP[subcategoryId];
    } else if (subcategoryId && this.categoriesTree.length > 0) {
      // 2. Buscar en el árbol de categorías el ancestro más específico que tenga mapeo a Vinted
      const pathNodes = this.findCategoryPath(subcategoryId);
      if (pathNodes && pathNodes.length > 0) {
        for (let i = pathNodes.length - 1; i >= 0; i--) {
          const nodeId = String(pathNodes[i].id);
          if (WALLAPOP_TO_VINTED_CATALOG_MAP[nodeId]) {
            catalogIds = WALLAPOP_TO_VINTED_CATALOG_MAP[nodeId];
            break;
          }
        }
        const deepestNode = pathNodes[pathNodes.length - 1];
        if (deepestNode && deepestNode.name && !/^otros/i.test(deepestNode.name)) {
          extraKeyword = deepestNode.name;
        }
      }
    }

    // 3. Fallback a la categoría principal
    if (catalogIds.length === 0 && categoryId && WALLAPOP_TO_VINTED_CATALOG_MAP[categoryId]) {
      catalogIds = WALLAPOP_TO_VINTED_CATALOG_MAP[categoryId];
    }

    return { unsupported: false, catalogIds, extraKeyword };
  }

  buildTargetUrl(searchConfig) {
    if (searchConfig.vinted_url) {
      return searchConfig.vinted_url;
    }
    if (searchConfig.url && searchConfig.url.includes('vinted.')) {
      return searchConfig.url;
    }

    const { unsupported, catalogIds, extraKeyword } = this.resolveVintedCategoryAndKeywords(searchConfig);
    if (unsupported) {
      return null;
    }

    const extra = (searchConfig.extra_filters && typeof searchConfig.extra_filters === 'object')
      ? searchConfig.extra_filters
      : {};

    // Construir search_text combinando keywords con atributos textuales de extra_filters
    const textParts = [];
    const hasExplicitKeywords = Boolean(searchConfig.keywords && String(searchConfig.keywords).trim());
    if (hasExplicitKeywords) {
      textParts.push(String(searchConfig.keywords).trim());
    } else if (extraKeyword) {
      textParts.push(extraKeyword);
    }

    const textFilterKeys = ['brand', 'model', 'version', 'color', 'storage_capacity', 'isbn', 'author', 'publisher'];
    for (const key of textFilterKeys) {
      const val = extra[key];
      if (val !== undefined && val !== null && String(val).trim() !== '' && String(val) !== 'true') {
        const cleanVal = String(val).trim();
        const alreadyIncluded = textParts.some(p => p.toLowerCase().includes(cleanVal.toLowerCase()));
        if (!alreadyIncluded) {
          textParts.push(cleanVal);
        }
      }
    }

    const searchText = textParts.join(' ').trim();

    // Si no hay ni texto de búsqueda ni categoría de Vinted mapeada, evitamos scrapear el feed aleatorio
    if (!searchText && catalogIds.length === 0) {
      return null;
    }

    const params = [];
    if (searchText) {
      params.push(`search_text=${encodeURIComponent(searchText)}`);
    }

    for (const catId of catalogIds) {
      params.push(`catalog[]=${encodeURIComponent(catId)}`);
    }

    const hasMinPrice = searchConfig.min_price !== undefined && searchConfig.min_price !== null && searchConfig.min_price !== '';
    const hasMaxPrice = searchConfig.max_price !== undefined && searchConfig.max_price !== null && searchConfig.max_price !== '';

    if (hasMinPrice) {
      params.push(`price_from=${encodeURIComponent(searchConfig.min_price)}`);
    }
    if (hasMaxPrice) {
      params.push(`price_to=${encodeURIComponent(searchConfig.max_price)}`);
    }
    if (hasMinPrice || hasMaxPrice) {
      params.push('currency=EUR');
    }

    const condition = searchConfig.condition || extra.condition || '';
    if (condition && CONDITION_TO_VINTED_STATUS_IDS[condition]) {
      for (const statusId of CONDITION_TO_VINTED_STATUS_IDS[condition]) {
        params.push(`status_ids[]=${statusId}`);
      }
    }

    const orderBy = ORDER_TO_VINTED[searchConfig.order_by] || 'newest_first';
    params.push(`order=${encodeURIComponent(orderBy)}`);

    return `https://www.vinted.es/catalog?${params.join('&')}`;
  }

  matchesExtraFilters(rawProduct, searchConfig) {
    const amount = Number(rawProduct.price?.amount);
    if (!isNaN(amount)) {
      if (searchConfig.min_price !== undefined && searchConfig.min_price !== null && searchConfig.min_price !== '') {
        if (amount < Number(searchConfig.min_price)) return false;
      }
      if (searchConfig.max_price !== undefined && searchConfig.max_price !== null && searchConfig.max_price !== '') {
        if (amount > Number(searchConfig.max_price)) return false;
      }
    }

    const extra = (searchConfig.extra_filters && typeof searchConfig.extra_filters === 'object')
      ? searchConfig.extra_filters
      : {};

    // Si hay filtro de talla (size), comprobar contra secondLine (ej. "M · Muy bueno") o título
    if (extra.size && String(extra.size).trim() !== '') {
      const targetSize = String(extra.size).trim().toLowerCase();
      const secondLine = String(rawProduct.itemBox?.secondLine || '').toLowerCase();
      const sizeToken = secondLine.includes('·') ? secondLine.split('·')[0].trim() : '';
      const title = String(rawProduct.title || '').toLowerCase();
      if (sizeToken && sizeToken !== targetSize && !sizeToken.includes(targetSize) && !title.includes(targetSize)) {
        return false;
      }
    }

    // Si hay filtro de marca (brand), comprobar contra firstLine (marca en Vinted) o título
    if (extra.brand && String(extra.brand).trim() !== '') {
      const targetBrand = String(extra.brand).trim().toLowerCase();
      const firstLine = String(rawProduct.itemBox?.firstLine || '').toLowerCase();
      const title = String(rawProduct.title || '').toLowerCase();
      if (firstLine && !firstLine.includes(targetBrand) && !title.includes(targetBrand)) {
        return false;
      }
    }

    return true;
  }

  mapToDomainItem(entry) {
    const product = entry.productItem || entry;
    if (!product || !product.id) return null;

    const brand = product.itemBox?.firstLine || product.brand_title || '';
    const secondLine = product.itemBox?.secondLine || product.status || '';
    const totalAmount = product.totalItemPrice?.amount || product.total_item_price?.amount || product.total_item_price;
    const currency = product.price?.currencyCode || product.price?.currency_code || product.currency || 'EUR';
    const baseAmount = product.price?.amount !== undefined ? Number(product.price.amount) : Number(product.price || 0);

    const descParts = [];
    if (brand) descParts.push(`Marca: ${brand}`);
    if (secondLine) descParts.push(`Detalle: ${secondLine}`);
    if (totalAmount) descParts.push(`Total con protección: ${totalAmount} ${currency}`);
    const description = descParts.length > 0 ? descParts.join(' | ') : (product.title || 'Anuncio en Vinted');

    const photos = Array.isArray(product.photos) ? product.photos : (product.photo ? [product.photo] : []);
    const images = photos.map(p => ({
      urls: {
        big: p.url || p.full_size_url || product.thumbnailUrl,
        medium: p.url || product.thumbnailUrl
      }
    }));
    if (images.length === 0 && product.thumbnailUrl) {
      images.push({
        urls: {
          big: product.thumbnailUrl,
          medium: product.thumbnailUrl
        }
      });
    }

    const rawUrl = product.url || `/items/${product.id}`;
    const fullUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.vinted.es${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const ownerId = product.user?.id || entry.catalogTracking?.ownerId || null;

    return new Item({
      id: `vinted_${product.id}`,
      provider: 'vinted',
      title: product.title || 'Sin título',
      description,
      price: {
        amount: isNaN(baseAmount) ? (product.price?.amount || 0) : baseAmount,
        currency
      },
      location: {
        city: 'Vinted',
        region2: 'Europa'
      },
      web_slug: rawUrl,
      itemUrl: fullUrl,
      images,
      originalData: {
        ...product,
        user_id: ownerId
      }
    });
  }

  async scrape(searchConfig) {
    this.sellerStatsCache = new Map();
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
      this.page = null;
    }

    const targetUrl = this.buildTargetUrl(searchConfig);
    if (!targetUrl) {
      console.log(`👗 [VintedScraper] Search skipped (category not applicable or empty query for Vinted).`);
      return [];
    }

    console.log(`👗 [VintedScraper] Navigating to: ${targetUrl}`);

    const delayMs = Math.floor(Math.random() * 5000) + 1500;
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log(`👗 [VintedScraper] Anti-bot measures: Sleeping for ${delayMs}ms before launching browser...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    const browser = await chromium.launch({ headless: true });
    this.browser = browser;
    const context = await browser.newContext({
      userAgent: randomUserAgent,
      viewport: { width: 1280 + Math.floor(Math.random() * 200), height: 800 + Math.floor(Math.random() * 100) },
      locale: 'es-ES',
      extraHTTPHeaders: {
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const page = await context.newPage();
    this.page = page;
    const itemsMap = new Map();

    // Escuchar también respuestas JSON de la API por si Vinted hace fetch cliente
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/v2/catalog/items')) {
        try {
          const json = await response.json();
          const apiItems = json.items || [];
          for (const rawItem of apiItems) {
            if (rawItem.is_promoted || rawItem.isPromoted) continue;
            if (!this.matchesExtraFilters(rawItem, searchConfig)) continue;
            const domainItem = this.mapToDomainItem(rawItem);
            if (domainItem) {
              itemsMap.set(domainItem.id, domainItem);
            }
          }
        } catch (err) {}
      }
    });

    try {
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const title = await page.title();
      if ((response && response.status() === 403) || title.includes('Access Denied') || title.includes('Just a moment')) {
        console.log(`👗 [VintedScraper] 🚨 FAST FAIL: Bot block detected on Vinted.`);
        return [];
      }

      // Esperar a que carguen las tarjetas en el DOM
      await page.waitForSelector('[data-testid^="product-item-id-"]', { timeout: 12000 }).catch(() => {});

      // Extraer items desde el payload SSR de Next.js (__next_f) o fallback al DOM
      const rawEntries = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '');
        let unescapedFull = '';
        for (const s of scripts) {
          if (!s.includes('__next_f.push')) continue;
          const re = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
          let m;
          while ((m = re.exec(s)) !== null) {
            try {
              unescapedFull += JSON.parse(m[1]);
            } catch (e) {}
          }
        }

        const marker = '"items":{"items":[';
        const idx = unescapedFull.indexOf(marker);
        if (idx !== -1) {
          const startArr = idx + '"items":{"items":'.length;
          let depth = 0;
          let inStr = false;
          let esc = false;
          for (let i = startArr; i < unescapedFull.length; i++) {
            const ch = unescapedFull[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (!inStr) {
              if (ch === '[') depth++;
              else if (ch === ']') {
                depth--;
                if (depth === 0) {
                  try {
                    return JSON.parse(unescapedFull.slice(startArr, i + 1));
                  } catch (e) {
                    break;
                  }
                }
              }
            }
          }
        }

        // Fallback DOM si no se encontró en __next_f
        const domCards = Array.from(document.querySelectorAll('[data-testid^="product-item-id-"][class*="container"]'));
        return domCards.map(card => {
          const testId = card.getAttribute('data-testid') || '';
          const idMatch = testId.match(/product-item-id-(\d+)/);
          if (!idMatch) return null;
          const id = Number(idMatch[1]);
          const linkEl = card.querySelector('a[href*="/items/"]');
          const imgEl = card.querySelector('img');
          const brandEl = card.querySelector('[data-testid$="--description-title"]');
          const subtitleEl = card.querySelector('[data-testid$="--description-subtitle"]');
          const priceEl = card.querySelector('[data-testid$="--price-text"]');
          const totalEl = card.querySelector('[data-testid="total-combined-price"]');

          const parsePrice = (str) => {
            if (!str) return 0;
            const cleaned = str.replace(/[^\d,.-]/g, '').replace(',', '.');
            return parseFloat(cleaned) || 0;
          };

          const rawTitle = linkEl?.getAttribute('title')?.split(',')[0]?.trim()
            || imgEl?.getAttribute('alt')?.split(',')[0]?.trim()
            || brandEl?.textContent?.trim()
            || `Artículo ${id}`;

          return {
            id,
            productItem: {
              id,
              title: rawTitle,
              url: linkEl ? linkEl.getAttribute('href') : `/items/${id}`,
              price: { amount: String(parsePrice(priceEl?.textContent)), currencyCode: 'EUR' },
              totalItemPrice: totalEl ? { amount: String(parsePrice(totalEl.textContent)), currencyCode: 'EUR' } : null,
              isPromoted: false,
              thumbnailUrl: imgEl ? imgEl.getAttribute('src') : null,
              itemBox: {
                firstLine: brandEl?.textContent?.trim() || '',
                secondLine: subtitleEl?.textContent?.trim() || ''
              }
            }
          };
        }).filter(Boolean);
      });

      if (Array.isArray(rawEntries)) {
        const MAX_ITEMS_PER_SEARCH = 24;
        for (const entry of rawEntries) {
          if (itemsMap.size >= MAX_ITEMS_PER_SEARCH) break;
          const product = entry.productItem || entry;
          if (!product) continue;
          // Descartar anuncios promocionados para respetar el orden (ej. más recientes)
          if (product.isPromoted || entry.catalogTracking?.contentSource === 'search_promoted_items') {
            continue;
          }
          if (!this.matchesExtraFilters(product, searchConfig)) {
            continue;
          }
          const domainItem = this.mapToDomainItem(entry);
          if (domainItem) {
            itemsMap.set(domainItem.id, domainItem);
          }
        }
      }

      console.log(`👗 [VintedScraper] Extracted ${itemsMap.size} organic items from Vinted.`);
    } catch (error) {
      console.error(`👗 [VintedScraper] Error scraping URL ${targetUrl}:`, error.message);
    }

    return Array.from(itemsMap.values());
  }

  async getSellerStats(userId) {
    if (!userId) return null;
    const cacheKey = String(userId);
    if (this.sellerStatsCache.has(cacheKey)) {
      return this.sellerStatsCache.get(cacheKey);
    }
    if (!this.page) {
      return null;
    }

    try {
      const result = await this.page.evaluate(async (uid) => {
        try {
          const response = await fetch(`/api/v2/users/${uid}`, {
            headers: { 'Accept': 'application/json' }
          });
          if (!response.ok) return null;
          return await response.json();
        } catch (e) {
          return null;
        }
      }, cacheKey);

      const user = result?.user;
      if (user) {
        const reviewsCount = Number(user.feedback_count || 0);
        const ratingFiveScale = user.feedback_reputation !== undefined && user.feedback_reputation !== null
          ? Number((Number(user.feedback_reputation) * 5).toFixed(2))
          : 0;

        const stats = {
          reviews_count: reviewsCount,
          rating: ratingFiveScale,
          city: user.city || null,
          country: user.country_title || null,
          counters: [
            { type: 'reviews', value: reviewsCount },
            { type: 'rating', value: ratingFiveScale }
          ]
        };
        this.sellerStatsCache.set(cacheKey, stats);
        return stats;
      }
    } catch (error) {
      console.error(`👗 [VintedScraper] Error fetching stats for user ${userId}:`, error.message);
    }

    this.sellerStatsCache.set(cacheKey, null);
    return null;
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = VintedPlaywrightScraper;
