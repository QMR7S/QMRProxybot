// Outbound HTTP is available ONLY through the Telegram Serverless SDK 'fetch'.
// Public MTProto community list with static fallback; no bot token or webhook operations.
import { nodes as fallback } from 'lib/nodes';
const UPSTREAM = 'https://iwizard7.github.io/MTProxy_list/endpoints.json';
const MAX_AGE_MS = 36 * 60 * 60 * 1000;
let memory = null;
let memoryAt = 0;

function valid(n) {
  return n && typeof n.server === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(n.server)
    && Number.isInteger(n.port) && n.port >= 1 && n.port <= 65535
    && typeof n.secret === 'string'
    && (/^[a-fA-F0-9]{32,512}$/.test(n.secret)
      || /^[A-Za-z0-9_-]{22,684}={0,2}$/.test(n.secret));
}
export function selectFromFeed(payload) {
  if (!payload || !Array.isArray(payload.endpoints)) return null;
  const stamp = Date.parse(payload.updated_at || '');
  if (!Number.isFinite(stamp) || stamp > Date.now() + 600000 || Date.now() - stamp > MAX_AGE_MS) return null;
  const seen = new Set();
  const nodes = payload.endpoints.filter(n =>
    n.verified === true && n.ads?.status !== 'present' && n.success_rate >= 0.8 &&
    n.samples >= 5 && Number.isFinite(n.median_rtt_ms) && valid(n))
    .sort((a,b) => b.success_rate - a.success_rate || a.median_rtt_ms - b.median_rtt_ms)
    .filter(n => {
      const key = n.server.toLowerCase() + ':' + n.port;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0,60).map((n,i) => ({
      name:'مجتمعي '+String(i+1).padStart(2,'0')+' — خارجي',
      server:n.server,port:n.port,secret:n.secret,enabled:true,
      source:'third_party',ads_status:n.ads?.status||'unknown',
      median_rtt_ms:n.median_rtt_ms
    }));
  return nodes.length >= 20 ? {nodes,origin:'remote',checked:payload.updated_at} : null;
}
export async function currentNodes(httpFetch) {
  if (memory && Date.now() - memoryAt < 600000) return memory;
  if (typeof httpFetch === 'function') {
    try {
      const response = await httpFetch(UPSTREAM);
      if (!response.ok) throw new Error('Source unavailable');
      const result = selectFromFeed(await response.json());
      if (result) { memory = result; memoryAt = Date.now(); return result; }
    } catch {
      // Restrictive network or bad source: known public snapshot, not fabricated links.
    }
  }
  return {nodes:fallback,origin:'snapshot',checked:'2026-11-16T06:25:41.547232+00:00'};
}
