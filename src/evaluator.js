import axios from 'axios';
import { log } from './utils.js';

const DEFAULT_SYSTEM_RULES = `You are a market-intelligence and business news analyst. Evaluate whether a news article is genuinely useful to a business or professional tracking commercial, industrial, technology, and market developments. Prioritize confirmed investments, capex, project announcements, contracts, tenders, acquisitions, partnerships with concrete outcomes, deployments, manufacturing/production capacity, technology breakthroughs, major product launches, and regulatory decisions with direct industry impact. Reject generic explainers, opinion pieces, thin keyword mentions, job listings, stock-price-only stories, repeated syndicated stories, and superficial or unrelated uses of words. Do not invent facts, numbers, locations or company names. If evidence is weak, score low. Return only valid JSON.`;

const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview'
];

function cleanJsonText(raw = '') {
  let text = String(raw).trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return text;
}

async function callGeminiWithRetry(prompt, key, systemRules = DEFAULT_SYSTEM_RULES) {
  let lastError;
  for (const model of CANDIDATE_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axios.post(url, {
          systemInstruction: { parts: [{ text: systemRules }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        }, {
          params: { key },
          timeout: 45000,
          headers: { 'Content-Type': 'application/json' }
        });

        const text = response.data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
        if (text) return text;
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message || err.message;

        // If daily quota exceeded on this model, break immediately to the next candidate model
        if (status === 429 && msg.toLowerCase().includes('quota exceeded')) {
          log('warn', `Gemini model ${model} daily free quota reached. Switching to next fallback model...`);
          break;
        }

        // If transient concurrency spike 429 or 503, wait with exponential backoff
        if (status === 429 || status === 503) {
          const waitTime = attempt * 1500;
          log('warn', `Gemini (${model}) ${status} transient spike - retrying in ${waitTime}ms (attempt ${attempt}/3)...`);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }

        // If other error (e.g. 404 or bad request), break to next candidate model
        log('warn', `Gemini model ${model} unavailable (${status}: ${msg}), trying fallback model...`);
        break;
      }
    }
  }
  throw lastError || new Error('All Gemini candidate models failed to return a response.');
}

export async function evaluateArticle(article) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is required for reliable AI relevance filtering.');

  const focusTopics = [
    article.categoryHint,
    ...(article.matchedKeywords || [])
  ].filter(Boolean).join(', ') || 'market and industry developments';

  const dynamicSystemRules = `You are a market-intelligence and business news analyst. Evaluate whether a news article is genuinely useful to a business or professional tracking topics related to: ${focusTopics}.
Prioritize confirmed investments, capex, factory/project announcements, contracts, tenders, acquisitions, partnerships with concrete outcomes, commercial deployments, manufacturing capacity, technology breakthroughs, major product launches, and regulatory decisions with direct impact on these topics.
Reject generic explainers, opinion pieces, thin keyword mentions, job listings, stock-price-only stories, repeated syndicated stories, and unrelated uses of words. Do not invent facts, numbers, locations or company names. If evidence is weak, score low. Return only valid JSON.`;

  const prompt = `${dynamicSystemRules}

Score this article for practical business value from 0 to 100 regarding: ${focusTopics}. The bot only saves scores >= ${Number(process.env.MIN_RELEVANCE_SCORE || 75)}.

Article JSON:
${JSON.stringify({
  title: article.title,
  url: article.url,
  publisher: article.source,
  publishedAt: article.publishedAt,
  description: article.description,
  keywordMatches: article.matchedKeywords,
  categoryHint: article.categoryHint,
  regionHint: article.regionHint
})}

Return this exact JSON shape:
{
  "relevant": true,
  "score": 0,
  "category": "one concise category",
  "companies": "comma-separated company names or Unknown",
  "development_type": "investment|contract|plant expansion|deployment|product|partnership|acquisition|policy|other",
  "summary": "2 concise factual sentences",
  "key_development": "one sentence explaining the material development",
  "deal_value": "reported value with currency, or Not reported",
  "location": "reported location or Not reported",
  "region": "India|Worldwide|Unknown",
  "reason": "brief evidence-based explanation"
}
The summary must not claim facts absent from the supplied article details. If the headline alone is insufficient, use conservative wording and lower the score.`;

  try {
    const rawText = await callGeminiWithRetry(prompt, key, dynamicSystemRules);
    const text = cleanJsonText(rawText);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 250)}`);
    }

    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const minScore = Number(process.env.MIN_RELEVANCE_SCORE || 75);

    return {
      relevant: Boolean(parsed.relevant) && score >= minScore,
      score,
      category: stringOr(parsed.category, article.categoryHint || 'Industry News'),
      companies: stringOr(parsed.companies, 'Unknown'),
      developmentType: stringOr(parsed.development_type, 'other'),
      summary: stringOr(parsed.summary, article.title),
      keyDevelopment: stringOr(parsed.key_development, 'See source article'),
      dealValue: stringOr(parsed.deal_value, 'Not reported'),
      location: stringOr(parsed.location, 'Not reported'),
      region: stringOr(parsed.region, 'Unknown'),
      reason: stringOr(parsed.reason, '')
    };
  } catch (error) {
    // If all Gemini models are exhausted or rate limited, provide graceful keyword-matched fallback
    log('warn', `AI scoring unavailable (${error.message}). Retaining candidate using keyword heuristic.`);
    const keywordMatches = article.matchedKeywords || [];
    return {
      relevant: true,
      score: 75,
      category: article.categoryHint || 'Industry News',
      companies: 'Pending AI Analysis',
      developmentType: 'general',
      summary: article.description ? article.description.slice(0, 300) : article.title,
      keyDevelopment: article.title,
      dealValue: 'Not reported',
      location: article.regionHint || 'Not reported',
      region: article.regionHint || 'Unknown',
      reason: `Matched high-priority keywords: ${keywordMatches.join(', ')}. (AI quota limit reached - keyword matched candidate)`
    };
  }
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
