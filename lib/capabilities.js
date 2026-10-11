// Official API support is deliberately enumerated, never inferred from a prefix.
export const API_FAST_MODELS = new Set([
  'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-sol',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5',
  'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-2024-05-13',
  'gpt-4o-mini', 'o3', 'o4-mini',
]);
export const API_ULTRAFAST_MODELS = new Set(['gpt-6-astra', 'gpt-6.1-sol']);
export const MODES = ['standard', 'fast', 'ultrafast'];
export const TIERS = { standard: 'default', fast: 'priority', ultrafast: 'ultrafast' };
export function apiModes(model, config = {}) {
  const fast = API_FAST_MODELS.has(model) || config.apiFastModels?.includes(model);
  const ultra = API_ULTRAFAST_MODELS.has(model) || config.apiUltrafastModels?.includes(model);
  return ['standard', ...(fast ? ['fast'] : []), ...(ultra ? ['ultrafast'] : [])];
}
export function parseCatalog(value) {
  if (!value || !Array.isArray(value.models)) throw new Error('Malformed Codex model catalog');
  const result = new Map();
  for (const model of value.models) {
    if (!model || typeof model.slug !== 'string') continue;
    const tiers = [
      ...(Array.isArray(model.additional_speed_tiers) ? model.additional_speed_tiers : []),
      ...(Array.isArray(model.service_tiers) ? model.service_tiers.map(t => t?.id) : []),
    ];
    const modes = ['standard', ...(tiers.some(t => t === 'fast' || t === 'priority') ? ['fast'] : []),
      ...(tiers.includes('ultrafast') ? ['ultrafast'] : [])];
    result.set(model.slug, modes);
  }
  return result;
}
export function isOfficialTransport(model, route) {
  try {
    const url = new URL(model.baseUrl);
    if (url.protocol !== 'https:') return false;
    if (route === 'openai') return url.origin === 'https://api.openai.com' &&
      ['openai-responses', 'openai-completions'].includes(model.api);
    return route === 'openai-codex' && url.origin === 'https://chatgpt.com' &&
      ['/backend-api', '/backend-api/', '/backend-api/codex', '/backend-api/codex/'].includes(url.pathname) && model.api === 'openai-codex-responses';
  } catch { return false; }
}
