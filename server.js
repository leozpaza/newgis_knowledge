const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.json({ limit: '50mb' }));

// ============== SYNONYMS DATABASE ==============
const SYNONYMS = {
  'счетчик': ['счётчик', 'ипу', 'прибор учета', 'прибор учёта', 'водомер', 'электросчетчик', 'электросчётчик', 'теплосчетчик', 'теплосчётчик', 'одпу', 'индивидуальный прибор'],
  'уборка': ['клининг', 'мытье', 'мытьё', 'чистка', 'санитарная обработка', 'влажная уборка'],
  'подъезд': ['парадная', 'лестничная клетка', 'лестница', 'мкд', 'мопы', 'моп'],
  'вандализм': ['порча', 'повреждение', 'разрушение', 'граффити', 'надписи', 'рисунки'],
  'отопление': ['тепло', 'батареи', 'радиаторы', 'теплоснабжение', 'отопительный сезон', 'холодно'],
  'вода': ['водоснабжение', 'гвс', 'хвс', 'горячая вода', 'холодная вода', 'водопровод', 'напор'],
  'лифт': ['лифтовое оборудование', 'подъемник', 'подъёмник', 'кабина лифта'],
  'освещение': ['свет', 'лампа', 'лампочка', 'светильник', 'фонарь', 'темно', 'темнота'],
  'крыша': ['кровля', 'протечка', 'течь', 'течет', 'течёт', 'капает'],
  'мусор': ['тбо', 'тко', 'отходы', 'мусоропровод', 'контейнер', 'бак'],
  'домофон': ['дверь', 'замок', 'ключ', 'доступ', 'вход'],
  'квитанция': ['платежка', 'платёжка', 'счет', 'счёт', 'еирц', 'оплата', 'начисление'],
  'перерасчет': ['перерасчёт', 'возврат', 'корректировка', 'пересчет', 'пересчёт'],
  'ремонт': ['восстановление', 'починка', 'устранение', 'работы'],
  'двор': ['придомовая территория', 'благоустройство', 'площадка', 'парковка'],
  'шум': ['громко', 'громкий', 'звук', 'грохот', 'стук'],
  'запах': ['вонь', 'воняет', 'пахнет', 'канализация', 'газ'],
  'жалоба': ['претензия', 'заявление', 'обращение', 'недовольство'],
  'управляющая компания': ['ук', 'управляющая организация', 'уо', 'жэк', 'жкх', 'тсж', 'тсн']
};

// Build reverse synonym map
const SYNONYM_MAP = new Map();
for (const [key, values] of Object.entries(SYNONYMS)) {
  SYNONYM_MAP.set(key.toLowerCase(), key);
  for (const v of values) {
    SYNONYM_MAP.set(v.toLowerCase(), key);
  }
}

// ============== DATA STORAGE ==============
let data = { articles: [], categories: [] };
const DATA_FILE = path.join(__dirname, 'data.json');
const INITIAL_FILE = path.join(__dirname, 'initial_data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } else if (fs.existsSync(INITIAL_FILE)) {
      data = JSON.parse(fs.readFileSync(INITIAL_FILE, 'utf-8'));
      saveData();
    }
    // Initialize views counter
    data.articles.forEach(a => { if (!a.views) a.views = 0; });
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving data:', e);
  }
}

loadData();

// ============== INTELLIGENT SEARCH ==============
function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\wа-яa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandWithSynonyms(query) {
  const words = normalizeText(query).split(' ');
  const expanded = new Set(words);
  
  for (const word of words) {
    const baseWord = SYNONYM_MAP.get(word);
    if (baseWord && SYNONYMS[baseWord]) {
      expanded.add(baseWord);
      SYNONYMS[baseWord].forEach(s => expanded.add(normalizeText(s)));
    }
  }
  
  return Array.from(expanded);
}

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  return matrix[b.length][a.length];
}

function fuzzyMatch(text, query, threshold = 0.7) {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  
  if (normalizedText.includes(normalizedQuery)) return 1;
  
  const words = normalizedText.split(' ');
  for (const word of words) {
    if (word.length < 3 || normalizedQuery.length < 3) continue;
    const distance = levenshteinDistance(word, normalizedQuery);
    const maxLen = Math.max(word.length, normalizedQuery.length);
    const similarity = 1 - distance / maxLen;
    if (similarity >= threshold) return similarity;
  }
  
  return 0;
}

function calculateRelevance(article, searchTerms) {
  let score = 0;
  const weights = {
    topic: 10,
    topic_code: 8,
    number: 7,
    response_text: 5,
    appeal_text: 4,
    tags: 6,
    address: 3,
    executor: 3
  };
  
  for (const term of searchTerms) {
    // Exact matches
    if (normalizeText(article.topic).includes(term)) score += weights.topic;
    if (normalizeText(article.topic_code).includes(term)) score += weights.topic_code;
    if (normalizeText(article.number).includes(term)) score += weights.number;
    if (normalizeText(article.response_text).includes(term)) score += weights.response_text;
    if (normalizeText(article.appeal_text).includes(term)) score += weights.appeal_text;
    if (normalizeText(article.address).includes(term)) score += weights.address;
    if (normalizeText(article.executor).includes(term)) score += weights.executor;
    
    // Tag matches
    if (article.tags?.some(t => normalizeText(t).includes(term))) score += weights.tags;
    
    // Fuzzy matches (lower weight)
    const fuzzyScore = fuzzyMatch(article.topic, term);
    if (fuzzyScore > 0) score += weights.topic * fuzzyScore * 0.5;
  }
  
  // Boost recent and popular articles
  if (article.views > 10) score += 1;
  if (article.views > 50) score += 2;
  
  return score;
}

function intelligentSearch(articles, query, filters = {}) {
  if (!query && !Object.keys(filters).length) return articles;
  
  let results = [...articles];
  
  // Apply filters first
  if (filters.address) {
    const addr = normalizeText(filters.address);
    results = results.filter(a => normalizeText(a.address).includes(addr));
  }
  
  if (filters.executor) {
    const exec = normalizeText(filters.executor);
    results = results.filter(a => normalizeText(a.executor).includes(exec));
  }
  
  if (filters.dateFrom) {
    results = results.filter(a => a.date >= filters.dateFrom);
  }
  
  if (filters.dateTo) {
    results = results.filter(a => a.date <= filters.dateTo);
  }
  
  if (filters.status) {
    results = results.filter(a => a.status === filters.status);
  }
  
  if (filters.category) {
    results = results.filter(a => a.tags?.includes(filters.category));
  }
  
  // Apply text search with synonyms and relevance scoring
  if (query) {
    const searchTerms = expandWithSynonyms(query);
    
    results = results
      .map(article => ({
        ...article,
        relevance: calculateRelevance(article, searchTerms)
      }))
      .filter(a => a.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance);
  }
  
  return results;
}

function findSimilarArticles(article, allArticles, limit = 5) {
  if (!article.tags?.length) return [];
  
  return allArticles
    .filter(a => a.id !== article.id)
    .map(a => {
      const commonTags = a.tags?.filter(t => article.tags.includes(t)).length || 0;
      const topicSimilarity = fuzzyMatch(a.topic, article.topic);
      return { ...a, similarity: commonTags * 2 + topicSimilarity };
    })
    .filter(a => a.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// ============== API ROUTES ==============
app.get('/api/articles', (req, res) => {
  const { search, category, address, executor, dateFrom, dateTo, status, page = 1, limit = 20, ids } = req.query;
  
  const filters = { category, address, executor, dateFrom, dateTo, status };
  Object.keys(filters).forEach(k => !filters[k] && delete filters[k]);

  let source = data.articles;
  if (ids) {
    const idsSet = new Set(ids.split(',').map(id => id.trim()).filter(Boolean));
    source = source.filter(a => idsSet.has(a.id));
  }
  
  const filtered = intelligentSearch(source, search, filters);
  
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + parseInt(limit));
  
  res.json({
    articles: paginated,
    total: filtered.length,
    page: parseInt(page),
    totalPages: Math.ceil(filtered.length / limit)
  });
});

app.get('/api/articles/:id', (req, res) => {
  const article = data.articles.find(a => a.id === req.params.id);
  if (!article) return res.status(404).json({ error: 'Not found' });
  
  // Increment views
  article.views = (article.views || 0) + 1;
  saveData();
  
  // Get similar articles
  const similar = findSimilarArticles(article, data.articles);
  
  res.json({ ...article, similar });
});

app.post('/api/articles', (req, res) => {
  const article = {
    ...req.body,
    id: String(Date.now()),
    views: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  data.articles.unshift(article);
  updateCategories();
  saveData();
  res.json(article);
});

app.put('/api/articles/:id', (req, res) => {
  const idx = data.articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.articles[idx] = { ...data.articles[idx], ...req.body, updated_at: new Date().toISOString() };
  updateCategories();
  saveData();
  res.json(data.articles[idx]);
});

app.delete('/api/articles/:id', (req, res) => {
  const idx = data.articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.articles.splice(idx, 1);
  updateCategories();
  saveData();
  res.json({ success: true });
});

app.get('/api/categories', (req, res) => {
  res.json(data.categories);
});

function buildStats() {
  const totalViews = data.articles.reduce((s, a) => s + (a.views || 0), 0);
  const topViewed = [...data.articles].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
  const executors = [...new Set(data.articles.map(a => a.executor).filter(Boolean))];
  const addresses = [...new Set(data.articles.map(a => {
    const m = a.address?.match(/д\.\s*\d+/);
    return m ? m[0] : null;
  }).filter(Boolean))];

  return {
    totalArticles: data.articles.length,
    totalCategories: data.categories.length,
    totalViews,
    topViewed,
    executors,
    addresses
  };
}

function buildStatsSummary() {
  const { totalArticles, totalCategories, totalViews } = buildStats();
  return { totalArticles, totalCategories, totalViews };
}

app.get('/api/stats', (req, res) => {
  try {
    res.json(buildStats());
  } catch (e) {
    console.error('Failed to build stats', e);
    res.status(500).json({ error: 'Failed to build stats' });
  }
});

app.get('/api/suggestions', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  
  const expanded = expandWithSynonyms(q);
  const suggestions = new Set();
  
  data.articles.forEach(a => {
    if (a.topic && expanded.some(term => normalizeText(a.topic).includes(term))) {
      suggestions.add(a.topic);
    }
  });
  
  res.json([...suggestions].slice(0, 10));
});

app.get('/api/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename=gis-kb-export.json');
  res.json(data);
});

app.post('/api/import', (req, res) => {
  try {
    if (req.body.articles && req.body.categories) {
      data = req.body;
      saveData();
      res.json({ success: true, count: data.articles.length });
    } else {
      res.status(400).json({ error: 'Invalid format' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function updateCategories() {
  const topicMap = {};
  data.articles.forEach(a => {
    (a.tags || []).forEach(t => {
      topicMap[t] = (topicMap[t] || 0) + 1;
    });
  });
  data.categories = Object.entries(topicMap).map(([name, count], i) => ({
    id: String(i + 1), name, count
  }));
}

// Keep-alive
setInterval(() => console.log('Keep-alive:', new Date().toISOString()), 14 * 60 * 1000);

// ============== HTML ==============
app.get('/', (req, res) => res.send(getHTML()));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

function getHTML() {
  const initialStats = buildStatsSummary();
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>База знаний ГИС ЖКХ</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f5f5;
      --bg-card: #ffffff;
      --bg-hover: #efefef;
      --bg-input: #f9f9f9;
      --border: #d6d6d6;
      --text: #111111;
      --text-dim: #51596c;
      --accent: #A60F2E;
      --accent-hover: #c52140;
      --accent-dim: rgba(166, 15, 46, 0.12);
      --success: #1b8a09;
      --success-dim: rgba(27, 138, 9, 0.12);
      --warning: #a99a68;
      --danger: #c43444;
      --shadow-soft: 0 10px 40px rgba(17, 32, 52, 0.08);
      --radius: 12px;
      --radius-sm: 8px;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    
    .container { max-width: 1500px; margin: 0 auto; padding: 0 24px; }
    
    /* Header */
    header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      box-shadow: 0 12px 30px rgba(49, 50, 53, 0.08);
      padding: 12px 0;
    }
    
    .header-inner {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
      white-space: nowrap;
    }
    
    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #DF1E42, var(--accent));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: #ffffff;
      box-shadow: 0 8px 20px rgba(166, 15, 46, 0.25);
    }
    
    /* Search */
    .search-area { flex: 1; max-width: 700px; position: relative; }
    
    .search-wrapper { position: relative; }
    
    .search-input {
      width: 100%;
      padding: 12px 16px 12px 44px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: 15px;
      transition: all 0.2s;
    }
    
    .search-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-dim);
    }
    
    .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
    }
    
    .search-suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-top: 4px;
      display: none;
      z-index: 1000;
      max-height: 300px;
      overflow-y: auto;
    }
    
    .search-suggestions.show { display: block; }
    
    .suggestion-item {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    
    .suggestion-item:last-child { border-bottom: none; }
    .suggestion-item:hover { background: var(--bg-hover); }
    
    .filters-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      margin-top: 8px;
      transition: all 0.2s;
    }
    
    .filters-toggle:hover { background: var(--bg-hover); }
    .filters-toggle.active { border-color: var(--accent); color: var(--accent); }
    
    .filters-panel {
      display: none;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 12px;
      padding: 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-soft);
    }
    
    .filters-panel.show { display: grid; }
    
    .filter-group label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    
    .filter-input {
      width: 100%;
      padding: 8px 12px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 13px;
    }
    
    .filter-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .header-actions { display: flex; gap: 8px; }
    
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      border-radius: var(--radius-sm);
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      white-space: nowrap;
    }
    
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: var(--bg-card); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: var(--bg-hover); }
    .btn-success { background: var(--success); color: white; }
    .btn-danger { background: var(--danger); color: white; }
    .btn-sm { padding: 6px 12px; font-size: 12px; }
    .btn-icon { padding: 8px; width: 36px; height: 36px; justify-content: center; }
    
    /* Main Layout */
    .main-layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 28px;
      padding: 28px 0;
    }
    
    @media (max-width: 1000px) {
      .main-layout { grid-template-columns: 1fr; }
      .sidebar { display: none; }
    }
    
    /* Sidebar */
    .sidebar { position: sticky; top: 90px; height: fit-content; }
    
    .sidebar-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
      margin-bottom: 18px;
      box-shadow: var(--shadow-soft);
    }
    
    .sidebar-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 14px;
    }
    
    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    
    .stat-card {
      background: linear-gradient(135deg, #ffffff, #f1f1f1);
      padding: 14px;
      border-radius: var(--radius-sm);
      text-align: center;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-soft);
    }
    
    .stat-value { font-size: 22px; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
    
    .category-list { list-style: none; max-height: 400px; overflow-y: auto; }
    
    .category-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      margin: 2px 0;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s;
    }
    
    .category-item:hover, .category-item.active {
      background: var(--bg-hover);
      color: var(--accent);
    }
    
    .category-count {
      background: var(--bg-hover);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      color: var(--text-dim);
      border: 1px solid var(--border);
    }
    
    /* Content */
    .content-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .content-title { font-size: 22px; font-weight: 600; }
    .results-info { display: flex; align-items: center; gap: 16px; }
    .results-count { color: var(--text-dim); font-size: 14px; }
    
    .sort-select {
      padding: 6px 12px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 13px;
    }
    
    /* Articles */
    .articles-grid { display: grid; gap: 14px; }
    
    .article-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
      box-shadow: var(--shadow-soft);
    }
    
    .article-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 18px 45px rgba(166, 15, 46, 0.14);
      background: linear-gradient(180deg, #ffffff 0%, #f9f9f9 100%);
    }
    
    .article-card.favorite { border-left: 3px solid var(--warning); }
    
    .article-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
    }
    
    .article-topic { font-size: 16px; font-weight: 600; flex: 1; }
    
    .article-badges { display: flex; gap: 6px; align-items: center; }
    
    .article-number {
      font-size: 12px;
      color: var(--text-dim);
      background: var(--bg-hover);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    
    .article-views {
      font-size: 11px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .article-text {
      color: var(--text-dim);
      font-size: 13px;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .article-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--text-dim);
    }
    
    .article-tag {
      background: var(--accent-dim);
      color: var(--accent);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    
    .relevance-badge {
      background: var(--success-dim);
      color: var(--success);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    
    /* Modals */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding: 40px 20px;
      overflow-y: auto;
    }
    
    .modal-overlay.active { display: flex; }
    
    .modal {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 100%;
      max-width: 900px;
      overflow: hidden;
      box-shadow: 0 22px 60px rgba(17, 32, 52, 0.18);
    }
    
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 22px;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg-card);
      z-index: 10;
    }
    
    .modal-title { font-size: 18px; font-weight: 600; }
    
    .modal-close {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: var(--bg);
      color: var(--text);
      cursor: pointer;
      font-size: 18px;
    }
    
    .modal-close:hover { background: var(--bg-hover); }
    
    .modal-body { padding: 22px; }
    
    .modal-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 22px;
      border-top: 1px solid var(--border);
      background: var(--bg-card);
    }
    
    .modal-footer-left { display: flex; gap: 8px; }
    .modal-footer-right { display: flex; gap: 8px; }
    
    /* View Article */
    .view-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      gap: 16px;
    }
    
    .view-title { font-size: 20px; font-weight: 600; }
    
    .view-actions { display: flex; gap: 8px; }
    
    .view-section { margin-bottom: 20px; }
    
    .view-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .view-content {
      background: var(--bg-card);
      padding: 16px;
      border-radius: var(--radius-sm);
      white-space: pre-wrap;
      line-height: 1.7;
      font-size: 14px;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-soft);
    }
    
    .view-response {
      background: var(--success-dim);
      border-left: 3px solid var(--success);
    }
    
    .view-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    
    .meta-item {
      background: var(--bg-card);
      padding: 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-soft);
    }
    
    .meta-label { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
    .meta-value { font-size: 14px; font-weight: 500; }
    
    /* Similar Articles */
    .similar-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
    .similar-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-dim); }
    .similar-grid { display: grid; gap: 10px; }
    
    .similar-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: var(--bg-card);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.15s;
      border: 1px solid var(--border);
    }
    
    .similar-item:hover { background: var(--bg-hover); box-shadow: 0 10px 22px rgba(17, 32, 52, 0.08); }
    .similar-item-title { font-size: 13px; flex: 1; }
    .similar-item-tag { font-size: 11px; color: var(--text-dim); }
    
    /* Form */
    .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .form-group { margin-bottom: 18px; }
    .form-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
    
    .form-input, .form-textarea, .form-select {
      width: 100%;
      padding: 10px 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
    }
    
    .form-input:focus, .form-textarea:focus, .form-select:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .form-textarea { min-height: 140px; resize: vertical; }
    
    /* Pagination */
    .pagination { display: flex; justify-content: center; gap: 6px; margin-top: 28px; }
    
    .page-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
    }
    
    .page-btn:hover, .page-btn.active { background: var(--accent); border-color: var(--accent); color: #ffffff; box-shadow: 0 10px 26px rgba(166, 15, 46, 0.18); }
    
    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--success);
      color: white;
      padding: 12px 20px;
      border-radius: var(--radius-sm);
      font-weight: 500;
      font-size: 14px;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
      z-index: 2000;
    }
    
    .toast.show { transform: translateY(0); opacity: 1; }
    
    /* Loading & Empty */
    .loading { display: flex; justify-content: center; padding: 40px; }
    .spinner { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .empty-state { text-align: center; padding: 50px 20px; color: var(--text-dim); }
    .empty-icon { font-size: 42px; margin-bottom: 12px; }
    
    .import-input { display: none; }
    
    /* Copied tooltip */
    .copy-tooltip {
      position: absolute;
      background: var(--success);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }
    
    .copy-tooltip.show { opacity: 1; }
    
    /* Quick Tags */
    .quick-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    
    .quick-tags-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .clear-tags-btn {
      padding: 6px 10px;
      border-radius: 14px;
      font-size: 11px;
      line-height: 1;
    }

    .quick-tag {
      padding: 6px 12px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
      color: var(--text);
      box-shadow: 0 4px 12px rgba(17, 32, 52, 0.06);
    }
    
    .quick-tag:hover { border-color: var(--accent); color: var(--accent); box-shadow: 0 8px 18px rgba(166, 15, 46, 0.12); }
    .quick-tag.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
    .quick-tag-label { pointer-events: none; }
    .quick-tag-remove {
      margin-left: 8px;
      font-weight: 700;
      color: var(--accent);
      opacity: 0.8;
      cursor: pointer;
    }
    .quick-tag-remove:hover { opacity: 1; }

    .quick-tags-expand {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .btn-link {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-size: 13px;
      padding: 8px 0;
      width: 100%;
      text-align: center;
      font-weight: 500;
      transition: all 0.2s;
    }

    .btn-link:hover {
      text-decoration: underline;
    }

    #expandCount {
      color: var(--text-dim);
      font-size: 12px;
    }

    .filters-badge {
      background: var(--danger);
      color: white;
      border-radius: 10px;
      padding: 2px 6px;
      font-size: 11px;
      margin-left: 4px;
      font-weight: 600;
    }

    .executor-link {
      cursor: pointer;
      transition: color 0.2s;
    }

    .executor-link:hover {
      color: var(--accent);
      text-decoration: underline;
    }

    mark {
      background: #fff3cd;
      padding: 2px 4px;
      border-radius: 2px;
      font-weight: 500;
      color: var(--text);
    }

    /* Favorites */
    .favorites-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }
    .favorites-btn .badge {
      background: var(--warning);
      color: var(--text);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid var(--border);
    }
    .favorites-btn.active {
      border-color: var(--warning);
      background: var(--warning);
      color: var(--text);
    }
    .favorites-btn.active .badge { background: var(--text); color: var(--warning); }

    .favorites-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
    .favorite-item {
      padding: 10px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.15s;
      font-size: 13px;
    }
    .favorite-item:hover { border-color: var(--accent); background: var(--bg-hover); box-shadow: 0 10px 24px rgba(166, 15, 46, 0.1); }
    .favorite-item-title { display: block; font-weight: 600; margin-bottom: 4px; }
    .favorite-item-number { color: var(--text-dim); font-size: 12px; }
    .favorites-empty { font-size: 13px; color: var(--text-dim); }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <div class="header-inner">
        <div class="logo">
          <div class="logo-icon">📚</div>
          <span>База знаний ГИС ЖКХ</span>
        </div>
        
        <div class="search-area">
          <div class="search-wrapper">
            <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input type="text" class="search-input" id="searchInput" placeholder="Счётчик, ИПУ, уборка...">
            <div class="search-suggestions" id="suggestions"></div>
          </div>
          
          <button class="filters-toggle" id="filtersToggle" onclick="toggleFilters()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            Расширенные фильтры
            <span class="filters-badge" id="filtersBadge" style="display:none;">0</span>
          </button>
          
          <div class="filters-panel" id="filtersPanel">
            <div class="filter-group">
              <label>Адрес</label>
              <input type="text" class="filter-input" id="filterAddress" placeholder="ул. Муринская...">
            </div>
            <div class="filter-group">
              <label>Исполнитель</label>
              <input type="text" class="filter-input" id="filterExecutor" placeholder="Иванов...">
            </div>
            <div class="filter-group">
              <label>Дата от</label>
              <input type="date" class="filter-input" id="filterDateFrom">
            </div>
            <div class="filter-group">
              <label>Дата до</label>
              <input type="date" class="filter-input" id="filterDateTo">
            </div>
            <div class="filter-group">
              <label>Статус</label>
              <select class="filter-input" id="filterStatus">
                <option value="">Все</option>
                <option value="Исполнено">Исполнено</option>
                <option value="В работе">В работе</option>
                <option value="Новое">Новое</option>
              </select>
            </div>
            <div class="filter-group" style="display:flex;align-items:flex-end;">
              <button class="btn btn-secondary btn-sm" onclick="clearFilters()">Сбросить</button>
            </div>
          </div>
      </div>
        
        <div class="header-actions">
          <button class="btn btn-secondary favorites-btn" id="favoritesButton" onclick="toggleFavoritesView()" title="Открыть избранное">
            ⭐ Избранное <span class="badge" id="favoritesBadge">0</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="exportFavorites()" title="Экспорт избранного">📥 Экспорт ⭐</button>
          <button class="btn btn-secondary btn-icon" onclick="exportData()" title="Экспорт">📤</button>
          <label class="btn btn-secondary btn-icon" title="Импорт">
            📥
            <input type="file" class="import-input" id="importInput" accept=".json" onchange="importData(event)">
          </label>
          <button class="btn btn-primary" onclick="openCreateModal()">+ Добавить</button>
        </div>
      </div>
    </div>
  </header>

  <div class="container">
    <div class="main-layout">
      <aside class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-title">Статистика</div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value" id="totalArticles">0</div>
              <div class="stat-label">Статей</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="totalCategories">0</div>
              <div class="stat-label">Категорий</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="totalViews">0</div>
              <div class="stat-label">Просмотров</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="totalFavorites">0</div>
              <div class="stat-label">Избранное</div>
            </div>
          </div>
        </div>

        <div class="sidebar-section">
          <div class="sidebar-title quick-tags-title">
            <span>Быстрые теги</span>
            <button class="btn btn-secondary btn-sm clear-tags-btn" onclick="clearTag()">Очистить теги</button>
          </div>
          <div class="quick-tags" id="quickTags"></div>
          <div class="quick-tags-expand" id="quickTagsExpand" style="display:none;"></div>
          <button class="btn-link" onclick="toggleExpandTags()" id="expandTagsBtn">
            Показать ещё <span id="expandCount">(25)</span>
          </button>
        </div>
        
        <div class="sidebar-section">
          <div class="sidebar-title">Категории</div>
          <ul class="category-list" id="categoryList"></ul>
        </div>
      </aside>

      <main>
        <div class="content-header">
          <h1 class="content-title" id="contentTitle">Все обращения</h1>
          <div class="results-info">
            <span class="results-count" id="resultsCount"></span>
          </div>
        </div>
        
        <div id="articlesContainer">
          <div class="loading"><div class="spinner"></div></div>
        </div>
        
        <div class="pagination" id="pagination"></div>
      </main>
    </div>
  </div>

  <!-- View Modal -->
  <div class="modal-overlay" id="viewModal">
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title" id="viewTitle">Просмотр</h2>
        <button class="modal-close" onclick="closeModal('viewModal')">×</button>
      </div>
      <div class="modal-body" id="viewBody"></div>
      <div class="modal-footer">
        <div class="modal-footer-left">
          <button class="btn btn-danger btn-sm" onclick="deleteArticle()">🗑 Удалить</button>
        </div>
        <div class="modal-footer-right">
          <button class="btn btn-secondary" onclick="editArticle()">✏️ Редактировать</button>
          <button class="btn btn-primary" onclick="closeModal('viewModal')">Закрыть</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Edit Modal -->
  <div class="modal-overlay" id="editModal">
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title" id="editTitle">Добавить статью</h2>
        <button class="modal-close" onclick="closeModal('editModal')">×</button>
      </div>
      <div class="modal-body">
        <form id="articleForm">
          <input type="hidden" id="articleId">
          
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Тема обращения *</label>
              <input type="text" class="form-input" id="topicInput" required placeholder="Проблемы с уборкой">
            </div>
            <div class="form-group">
              <label class="form-label">Код темы</label>
              <input type="text" class="form-input" id="topicCodeInput" placeholder="12.14">
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Номер обращения</label>
              <input type="text" class="form-input" id="numberInput" placeholder="78-2025-XXXXX">
            </div>
            <div class="form-group">
              <label class="form-label">Статус</label>
              <select class="form-select" id="statusInput">
                <option value="Исполнено">Исполнено</option>
                <option value="В работе">В работе</option>
                <option value="Новое">Новое</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Адрес</label>
            <input type="text" class="form-input" id="addressInput" placeholder="Санкт-Петербург г., ул. ...">
          </div>
          
          <div class="form-group">
            <label class="form-label">Текст обращения</label>
            <textarea class="form-textarea" id="appealTextInput" placeholder="Текст от жителя..."></textarea>
          </div>
          
          <div class="form-group">
            <label class="form-label">Текст ответа / Инструкция *</label>
            <textarea class="form-textarea" id="responseTextInput" required placeholder="Шаблон ответа..." style="min-height:180px;"></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Исполнитель</label>
              <input type="text" class="form-input" id="executorInput" placeholder="ФИО">
            </div>
            <div class="form-group">
              <label class="form-label">Теги (через запятую)</label>
              <input type="text" class="form-input" id="tagsInput" placeholder="Уборка, Подъезд">
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <div class="modal-footer-left"></div>
        <div class="modal-footer-right">
          <button class="btn btn-secondary" onclick="closeModal('editModal')">Отмена</button>
          <button class="btn btn-primary" onclick="saveArticle()">Сохранить</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const INITIAL_STATS = ${JSON.stringify(initialStats)};
    let articles = [];
    let categories = [];
    let currentPage = 1;
    let currentCategory = '';
    let currentSearch = '';
    let currentArticleId = null;
    let favorites = JSON.parse(localStorage.getItem('gis_favorites') || '[]');
    let favoritesOnly = false;
    let filtersVisible = false;
    let activeTag = '';
    let expandedTags = false;

    const QUICK_TAGS = [
      'Другое',
      'Проблема с платежными документами',
      'Проблемы с входной дверью',
      'Проблемы с уборкой подъезда',
      'Другая тема',
      'Проблемы с начислениями в квитанциях',
      'Проблемы с лифтом',
      'Подключение к видеонаблюдению',
      'Размещение информации об индивидуальном приборе учета',
      'Вандализм',
      'Отсутствие горячей воды',
      'Розыск неучтенных направленных платежей',
      'Подключение к домофону',
      'Неисправный домофон или запирающие устройства',
      'Даты приёма показаний неверны'
    ];

    const ALL_CATEGORIES_FOR_EXPAND = [
      'Неисправное освещение',
      'Ненадлежащее качество коммунальной услуги по отоплению (холодно/жарко в квартире)',
      'Уход за газоном и зелеными насаждениями',
      'Нужна справка или документ по всему дому',
      'Ненадлежащее качество коммунальной услуги по горячему водоснабжению низкая/высокая температура горячей воды в квартире',
      'Содержание детской/спортивной площадки',
      'Повреждение стен и фасада',
      'Уборка во дворе',
      'Состояние дорог и тротуаров',
      'Содержание контейнерной площадки, вывоз мусора',
      'Намокание межквартирных перегородок',
      'Низкое/высокое давление (напор) горячей воды',
      'Проблемы с капремонтом',
      'Ошибки в квитанциях',
      'Отсутствует счетчик в мобильном приложении',
      'Вызвать специалиста',
      'Подключение к видеонаблюдению ГИС ЖКХ',
      'Предоставление отчета',
      'Неверно указан номер счетчика',
      'Некорректные сведения, размещённые в системе поставщиками информации',
      'Дублируются счетчики в мобильном приложении',
      'Передача показаний ИПУ в виде фотофиксации для проверки',
      'Проблемы при голосовании',
      'Прикрепление лицевого счета',
      'Неисправность прибора учёта на время замены'
    ];

    document.addEventListener('DOMContentLoaded', () => {
      loadArticles();
      loadCategories();
      loadStats();
      renderQuickTags();
      renderFavoritesList();
      updateFavoritesBadge();
      updateContentTitle();
      
      const searchInput = document.getElementById('searchInput');
      searchInput.addEventListener('input', debounce(handleSearch, 300));
      searchInput.addEventListener('focus', () => loadSuggestions());
      searchInput.addEventListener('blur', () => setTimeout(() => hideSuggestions(), 200));
      
      // Filter inputs
      ['filterAddress', 'filterExecutor', 'filterDateFrom', 'filterDateTo', 'filterStatus'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => { currentPage = 1; updateFiltersCount(); loadArticles(); });
      });
    });

    function handleSearch(e) {
      currentSearch = e.target.value;
      if (activeTag) {
        activeTag = '';
        renderQuickTags();
      }
      currentPage = 1;
      favoritesOnly = false;
      loadArticles();
      if (currentSearch.length >= 2) loadSuggestions();
    }

    async function loadSuggestions() {
      const q = document.getElementById('searchInput').value;
      if (q.length < 2) { hideSuggestions(); return; }
      
      const res = await fetch('/api/suggestions?q=' + encodeURIComponent(q));
      const suggestions = await res.json();
      
      const container = document.getElementById('suggestions');
      if (suggestions.length === 0) { hideSuggestions(); return; }
      
      container.innerHTML = suggestions.map(s => 
        \`<div class="suggestion-item" onclick="selectSuggestion('\${escapeHtml(s)}')">\${escapeHtml(s)}</div>\`
      ).join('');
      container.classList.add('show');
    }

    function selectSuggestion(text) {
      document.getElementById('searchInput').value = text;
      currentSearch = text;
      hideSuggestions();
      loadArticles();
    }

    function hideSuggestions() {
      document.getElementById('suggestions').classList.remove('show');
    }

    function updateFiltersCount() {
      let count = 0;
      if (document.getElementById('filterAddress').value) count++;
      if (document.getElementById('filterExecutor').value) count++;
      if (document.getElementById('filterStatus').value !== '') count++;
      if (document.getElementById('filterDateFrom').value) count++;
      if (document.getElementById('filterDateTo').value) count++;

      const badge = document.getElementById('filtersBadge');
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    function toggleFilters() {
      filtersVisible = !filtersVisible;
      document.getElementById('filtersPanel').classList.toggle('show', filtersVisible);
      document.getElementById('filtersToggle').classList.toggle('active', filtersVisible);
    }

    function clearFilters() {
      ['filterAddress', 'filterExecutor', 'filterDateFrom', 'filterDateTo'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('filterStatus').value = '';
      currentPage = 1;
      updateFiltersCount();
      loadArticles();
    }

    function getFilters() {
      return {
        address: document.getElementById('filterAddress').value,
        executor: document.getElementById('filterExecutor').value,
        dateFrom: document.getElementById('filterDateFrom').value,
        dateTo: document.getElementById('filterDateTo').value,
        status: document.getElementById('filterStatus').value
      };
    }

    async function loadArticles() {
      const filters = getFilters();

      // Если включён режим избранного, но список пуст — показываем пустое состояние
      if (favoritesOnly && favorites.length === 0) {
        renderArticles({ articles: [], total: 0, totalPages: 1, page: 1 });
        document.getElementById('resultsCount').textContent = 'В избранном пока нет карточек';
        updateContentTitle();
        return;
      }

      const params = new URLSearchParams({
        page: currentPage,
        limit: favoritesOnly ? Math.max(50, favorites.length || 1) : 20,
        ...(currentSearch && { search: currentSearch }),
        ...(currentCategory && { category: currentCategory }),
        ...(filters.address && { address: filters.address }),
        ...(filters.executor && { executor: filters.executor }),
        ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
        ...(filters.dateTo && { dateTo: filters.dateTo }),
        ...(filters.status && { status: filters.status }),
        ...(favoritesOnly && favorites.length ? { ids: favorites.join(',') } : {})
      });
      
      const res = await fetch('/api/articles?' + params);
      const data = await res.json();
      
      articles = data.articles;
      renderArticles(data);
      renderPagination(data);
      
      document.getElementById('resultsCount').textContent = favoritesOnly ? \`Избранных: \${data.total}\` : \`Найдено: \${data.total}\`;
      updateContentTitle();
    }

    async function loadCategories() {
      const res = await fetch('/api/categories');
      categories = await res.json();
      renderCategories();
    }

    const statsSnapshot = INITIAL_STATS || { totalArticles: 0, totalCategories: 0, totalViews: 0 };

    function renderStats(stats = {}) {
      document.getElementById('totalArticles').textContent = stats.totalArticles ?? 0;
      document.getElementById('totalCategories').textContent = stats.totalCategories ?? 0;
      document.getElementById('totalViews').textContent = stats.totalViews ?? 0;
      document.getElementById('totalFavorites').textContent = stats.totalFavorites ?? favorites.length;
    }

    async function loadStats() {
      // Always show at least the snapshot + локальные избранные
      renderStats({ ...statsSnapshot, totalFavorites: favorites.length });
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const stats = await res.json();
        renderStats({ ...stats, totalFavorites: favorites.length });
      } catch (err) {
        console.error('Не удалось загрузить статистику', err);
        showToast('Статистика временно недоступна, показаны сохранённые данные');
      }
    }

    function renderQuickTags() {
      const container = document.getElementById('quickTags');
      container.innerHTML = QUICK_TAGS.map(tag => {
        const isActive = activeTag === tag;
        return \`
          <button class="quick-tag \${isActive ? 'active' : ''}" onclick="toggleTag('\${tag}')">
            <span class="quick-tag-label">\${tag}</span>
            \${isActive ? '<span class="quick-tag-remove" onclick="clearTag(event)">×</span>' : ''}
          </button>
        \`;
      }).join('');
    }

    function updateContentTitle() {
      const title = favoritesOnly ? 'Избранное' : (currentCategory || 'Все обращения');
      document.getElementById('contentTitle').textContent = title;
    }

    function toggleTag(tag) {
      if (activeTag === tag) {
        clearTag();
        return;
      }
      activeTag = tag;
      document.getElementById('searchInput').value = tag;
      currentSearch = tag;
      currentPage = 1;
      favoritesOnly = false;
      renderQuickTags();
      loadArticles();
    }

    function clearTag(event) {
      if (event) event.stopPropagation();
      if (!activeTag) return;
      activeTag = '';
      document.getElementById('searchInput').value = '';
      currentSearch = '';
      currentPage = 1;
      favoritesOnly = false;
      renderQuickTags();
      loadArticles();
    }

    function toggleExpandTags() {
      expandedTags = !expandedTags;
      const container = document.getElementById('quickTagsExpand');
      const btn = document.getElementById('expandTagsBtn');

      if (expandedTags) {
        container.style.display = 'flex';
        container.innerHTML = ALL_CATEGORIES_FOR_EXPAND.map(tag => {
          const isActive = activeTag === tag;
          return \`
            <button class="quick-tag \${isActive ? 'active' : ''}" onclick="toggleTag('\${escapeHtml(tag)}')">
              <span class="quick-tag-label">\${escapeHtml(tag)}</span>
              \${isActive ? '<span class="quick-tag-remove" onclick="clearTag(event)">×</span>' : ''}
            </button>
          \`;
        }).join('');
        btn.innerHTML = 'Скрыть ↑';
      } else {
        container.style.display = 'none';
        btn.innerHTML = \`Показать ещё <span id="expandCount">(\${ALL_CATEGORIES_FOR_EXPAND.length})</span>\`;
      }
    }

    function renderArticles(data) {
      const container = document.getElementById('articlesContainer');
      
      if (data.articles.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <p>\${favoritesOnly ? 'В избранном пока пусто' : 'Ничего не найдено'}</p>
            <p style="font-size:13px;margin-top:8px;">\${favoritesOnly ? 'Добавьте карточки через кнопку ⭐ в карточке или откройте все обращения' : 'Попробуйте изменить запрос или фильтры'}</p>
          </div>
        \`;
        return;
      }
      
      container.innerHTML = \`<div class="articles-grid">\${data.articles.map(a => {
        const isFav = favorites.includes(a.id);
        return \`
        <div class="article-card \${isFav ? 'favorite' : ''}" onclick="openViewModal('\${a.id}')">
          <div class="article-header">
            <div class="article-topic">\${escapeHtml(a.topic || 'Без темы')}</div>
            <div class="article-badges">
              \${a.relevance ? \`<span class="relevance-badge">⚡ \${Math.round(a.relevance)}</span>\` : ''}
              <span class="article-views">👁 \${a.views || 0}</span>
              <span class="article-number">\${escapeHtml(a.number || '-')}</span>
            </div>
          </div>
          <div class="article-text">\${highlightText(a.response_text || a.appeal_text || '', currentSearch)}</div>
          <div class="article-meta">
            \${(a.tags || []).slice(0, 3).map(t => \`<span class="article-tag">\${escapeHtml(t)}</span>\`).join('')}
            \${a.executor ? \`<span class="executor-link" onclick="filterByExecutor(event, '\${escapeHtml(a.executor)}')">👤 \${escapeHtml(a.executor.split(' ').slice(0, 2).join(' '))}</span>\` : ''}
          </div>
        </div>
      \`}).join('')}</div>\`;
    }

    function renderCategories() {
      const list = document.getElementById('categoryList');
      const sorted = [...categories].sort((a, b) => b.count - a.count).slice(0, 20);
      const total = categories.reduce((s, c) => s + c.count, 0);
      
      list.innerHTML = \`
        <li class="category-item \${favoritesOnly ? 'active' : ''}" onclick="showFavorites()">
          <span>⭐ Избранное</span>
          <span class="category-count">\${favorites.length}</span>
        </li>
        <li class="category-item \${!currentCategory && !favoritesOnly ? 'active' : ''}" onclick="filterByCategory('')">
          <span>Все обращения</span>
          <span class="category-count">\${total}</span>
        </li>
        \${sorted.map(c => \`
          <li class="category-item \${currentCategory === c.name ? 'active' : ''}" onclick="filterByCategory('\${escapeHtml(c.name)}')">
            <span>\${escapeHtml(c.name.length > 28 ? c.name.substring(0, 28) + '...' : c.name)}</span>
            <span class="category-count">\${c.count}</span>
          </li>
        \`).join('')}
      \`;
    }

    async function renderFavoritesList() {
      const container = document.getElementById('favoritesList');
      if (!container) return;
      
      if (!favorites.length) {
        container.innerHTML = '<div class="favorites-empty">Добавьте карточку в избранное через ⭐</div>';
        return;
      }

      try {
        const params = new URLSearchParams({
          ids: favorites.join(','),
          limit: Math.max(50, favorites.length),
          page: 1
        });
        const res = await fetch('/api/articles?' + params);
        const data = await res.json();
        if (!data.articles?.length) {
          container.innerHTML = '<div class="favorites-empty">Избранные карточки не найдены</div>';
          return;
        }
        const order = new Map(favorites.map((id, idx) => [id, idx]));
        const items = data.articles
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          .slice(0, 8)
          .map(a => \`
          <div class="favorite-item" onclick="openViewModal('\${a.id}')">
            <span class="favorite-item-title">\${escapeHtml(a.topic || 'Без темы')}</span>
            <span class="favorite-item-number">\${escapeHtml(a.number || '')}</span>
          </div>
        \`).join('');
        container.innerHTML = items;
      } catch (e) {
        console.error('Не удалось загрузить избранное', e);
        container.innerHTML = '<div class="favorites-empty">Не удалось загрузить список</div>';
      }
    }

    function updateFavoritesBadge() {
      const badge = document.getElementById('favoritesBadge');
      if (badge) badge.textContent = favorites.length;
      const sidebarBadge = document.getElementById('favoritesSidebarBadge');
      if (sidebarBadge) sidebarBadge.textContent = favorites.length;
      const btn = document.getElementById('favoritesButton');
      if (btn) btn.classList.toggle('active', favoritesOnly);
    }

    function renderPagination(data) {
      const container = document.getElementById('pagination');
      if (data.totalPages <= 1) { container.innerHTML = ''; return; }
      
      let html = '';
      const start = Math.max(1, data.page - 3);
      const end = Math.min(data.totalPages, data.page + 3);
      
      if (start > 1) html += \`<button class="page-btn" onclick="goToPage(1)">1</button>\`;
      if (start > 2) html += \`<button class="page-btn" disabled>...</button>\`;
      
      for (let i = start; i <= end; i++) {
        html += \`<button class="page-btn \${i === data.page ? 'active' : ''}" onclick="goToPage(\${i})">\${i}</button>\`;
      }
      
      if (end < data.totalPages - 1) html += \`<button class="page-btn" disabled>...</button>\`;
      if (end < data.totalPages) html += \`<button class="page-btn" onclick="goToPage(\${data.totalPages})">\${data.totalPages}</button>\`;
      
      container.innerHTML = html;
    }

    function filterByCategory(cat) {
      currentCategory = cat;
      favoritesOnly = false;
      currentPage = 1;
      if (activeTag) {
        clearTag();
        renderCategories();
        return;
      }
      loadArticles();
      renderCategories();
    }

    function filterByExecutor(event, executor) {
      event.stopPropagation();
      document.getElementById('filterExecutor').value = executor;
      currentPage = 1;
      updateFiltersCount();
      if (!filtersVisible) toggleFilters();
      loadArticles();
      showToast(\`Фильтр: \${executor}\`);
    }

    function toggleFavoritesView() {
      favoritesOnly = !favoritesOnly;
      currentCategory = '';
      currentPage = 1;
      updateFavoritesBadge();
      updateContentTitle();
      loadArticles();
      renderCategories();
      renderFavoritesList();
    }

    function showFavorites() {
      favoritesOnly = true;
      currentCategory = '';
      currentPage = 1;
      updateFavoritesBadge();
      updateContentTitle();
      loadArticles();
      renderCategories();
      renderFavoritesList();
    }

    function goToPage(page) {
      currentPage = page;
      loadArticles();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function openViewModal(id) {
      currentArticleId = id;
      const res = await fetch('/api/articles/' + id);
      const a = await res.json();
      
      const isFav = favorites.includes(a.id);
      
      document.getElementById('viewTitle').textContent = a.topic || 'Обращение';
      document.getElementById('viewBody').innerHTML = \`
        <div class="view-header">
          <div class="view-title">\${escapeHtml(a.topic || '')}</div>
          <div class="view-actions">
            <button class="btn btn-sm \${isFav ? 'btn-warning' : 'btn-secondary'}" onclick="toggleFavorite('\${a.id}')">
              \${isFav ? '⭐ В избранном' : '☆ В избранное'}
            </button>
            <button class="btn btn-sm btn-success" onclick="copyResponse()">📋 Копировать ответ</button>
          </div>
        </div>
        
        <div class="view-meta">
          <div class="meta-item">
            <div class="meta-label">Номер</div>
            <div class="meta-value">\${escapeHtml(a.number || '-')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Код темы</div>
            <div class="meta-value">\${escapeHtml(a.topic_code || '-')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Статус</div>
            <div class="meta-value">\${escapeHtml(a.status || '-')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Просмотров</div>
            <div class="meta-value">\${a.views || 0}</div>
          </div>
        </div>
        
        \${a.address ? \`<div class="view-section">
          <div class="view-label">📍 Адрес</div>
          <div class="view-content">\${escapeHtml(a.address)}</div>
        </div>\` : ''}
        
        \${a.appeal_text ? \`<div class="view-section">
          <div class="view-label">📝 Текст обращения</div>
          <div class="view-content">\${escapeHtml(a.appeal_text)}</div>
        </div>\` : ''}
        
        <div class="view-section">
          <div class="view-label">✅ Ответ / Инструкция</div>
          <div class="view-content view-response" id="responseContent">\${escapeHtml(a.response_text || 'Нет ответа')}</div>
        </div>
        
        \${a.executor ? \`<div class="view-section">
          <div class="view-label">👤 Исполнитель</div>
          <div class="view-content">\${escapeHtml(a.executor)}</div>
        </div>\` : ''}
        
        \${a.similar?.length ? \`
        <div class="similar-section">
          <div class="similar-title">🔗 Похожие обращения</div>
          <div class="similar-grid">
            \${a.similar.map(s => \`
              <div class="similar-item" onclick="openViewModal('\${s.id}')">
                <span class="similar-item-title">\${escapeHtml(s.topic || 'Без темы')}</span>
                <span class="similar-item-tag">\${escapeHtml(s.number || '')}</span>
              </div>
            \`).join('')}
          </div>
        </div>
        \` : ''}
      \`;
      
      document.getElementById('viewModal').classList.add('active');
      loadStats();
    }

    function copyResponse() {
      const text = document.getElementById('responseContent').textContent;
      navigator.clipboard.writeText(text).then(() => {
        showToast('Ответ скопирован в буфер');
      });
    }

    function toggleFavorite(id) {
      const idx = favorites.indexOf(id);
      if (idx === -1) {
        favorites.push(id);
        showToast('Добавлено в избранное');
      } else {
        favorites.splice(idx, 1);
        showToast('Удалено из избранного');
      }
      localStorage.setItem('gis_favorites', JSON.stringify(favorites));
      updateFavoritesBadge();
      renderFavoritesList();
      if (favoritesOnly) {
        loadArticles();
        renderCategories();
      }
      openViewModal(id);
      loadStats();
    }

    function openCreateModal() {
      currentArticleId = null;
      document.getElementById('editTitle').textContent = 'Добавить статью';
      document.getElementById('articleForm').reset();
      document.getElementById('articleId').value = '';
      document.getElementById('editModal').classList.add('active');
    }

    async function editArticle() {
      closeModal('viewModal');
      const res = await fetch('/api/articles/' + currentArticleId);
      const a = await res.json();
      
      document.getElementById('editTitle').textContent = 'Редактировать';
      document.getElementById('articleId').value = a.id;
      document.getElementById('topicInput').value = a.topic || '';
      document.getElementById('topicCodeInput').value = a.topic_code || '';
      document.getElementById('numberInput').value = a.number || '';
      document.getElementById('statusInput').value = a.status || 'Исполнено';
      document.getElementById('addressInput').value = a.address || '';
      document.getElementById('appealTextInput').value = a.appeal_text || '';
      document.getElementById('responseTextInput').value = a.response_text || '';
      document.getElementById('executorInput').value = a.executor || '';
      document.getElementById('tagsInput').value = (a.tags || []).join(', ');
      
      document.getElementById('editModal').classList.add('active');
    }

    async function saveArticle() {
      const id = document.getElementById('articleId').value;
      const topic = document.getElementById('topicInput').value;
      const tags = document.getElementById('tagsInput').value.split(',').map(t => t.trim()).filter(t => t);
      if (!tags.includes(topic) && topic) tags.unshift(topic);
      
      const data = {
        topic,
        topic_code: document.getElementById('topicCodeInput').value,
        number: document.getElementById('numberInput').value,
        status: document.getElementById('statusInput').value,
        address: document.getElementById('addressInput').value,
        appeal_text: document.getElementById('appealTextInput').value,
        response_text: document.getElementById('responseTextInput').value,
        executor: document.getElementById('executorInput').value,
        tags
      };
      
      const url = id ? '/api/articles/' + id : '/api/articles';
      const method = id ? 'PUT' : 'POST';
      
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      closeModal('editModal');
      loadArticles();
      loadCategories();
      loadStats();
      showToast(id ? 'Статья обновлена' : 'Статья добавлена');
    }

    async function deleteArticle() {
      if (!confirm('Удалить эту статью?')) return;
      
      await fetch('/api/articles/' + currentArticleId, { method: 'DELETE' });
      closeModal('viewModal');
      loadArticles();
      loadCategories();
      loadStats();
      showToast('Статья удалена');
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('active');
    }

    async function exportData() {
      const res = await fetch('/api/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gis-kb-' + new Date().toISOString().split('T')[0] + '.json';
      a.click();
      showToast('Экспортировано');
    }

    async function exportFavorites() {
      if (!favorites.length) {
        showToast('Нет избранных статей');
        return;
      }

      const params = new URLSearchParams({ ids: favorites.join(','), limit: 1000 });
      const res = await fetch('/api/articles?' + params);
      const data = await res.json();

      const exportData = {
        articles: data.articles,
        categories: categories.filter(c =>
          data.articles.some(a => a.tags.includes(c.name))
        ),
        exportedAt: new Date().toISOString(),
        type: 'favorites'
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`gis-kb-favorites-\${new Date().toISOString().split('T')[0]}.json\`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('✅ Избранное экспортировано');
    }

    async function importData(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      const text = await file.text();
      const data = JSON.parse(text);
      
      await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      loadArticles();
      loadCategories();
      loadStats();
      showToast('Импортировано: ' + data.articles.length + ' статей');
      event.target.value = '';
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function highlightText(text, query) {
      if (!query || query.length < 2) return escapeHtml(text);

      const words = query.toLowerCase().split(' ').filter(w => w.length > 2);
      let highlighted = escapeHtml(text);

      words.forEach(word => {
        const regex = new RegExp(\`(\${word})\`, 'gi');
        highlighted = highlighted.replace(regex, '<mark>$1</mark>');
      });

      return highlighted;
    }

    function debounce(fn, ms) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
      };
    }
    
    document.addEventListener('keydown', (e) => {
      // Escape - закрыть модальные окна и фильтры
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        if (filtersVisible) toggleFilters();
      }

      // / - фокус на поиск
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        document.getElementById('searchInput').focus();
      }

      // Ctrl+K или Cmd+K - фокус и выделение поиска
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('searchInput');
        searchInput.focus();
        searchInput.select();
      }

      // Ctrl+F или Cmd+F - переключить фильтры
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (!filtersVisible) toggleFilters();
      }
    });
  </script>
</body>
</html>`;
}
