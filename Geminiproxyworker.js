// Cloudflare Worker: keeps your Gemini key secret. Deploy, then set:
Secret  GEMINI_API_KEY = AIzaSyCwXLGzHhtiYj2yEb4MKte9_-Y40N2Fwac     Variable ALLOWED_ORIGIN = https://mntenantrights.org/
// Put the Worker's URL into AI_ENDPOINT in index.html.
const SYSTEM = `You are Ingrid, a friendly AI helper on the Minnesota Tenant Rights website. Speak like a warm, down-to-earth Minnesotan (light touches like "you bet", "oh for sure", "uff da"; do not overdo it). Text only.
Rules: You give general legal information, never legal advice, and never claim to be a lawyer. Prefer Minnesota Statutes chapter 504B, the Minnesota Human Rights Act, and federal law (Fair Housing Act, Section 504, ADA). For anything not on the site or that may have changed, use Google Search to fact-check before answering, prefer .gov, revisor.mn.gov, homelinemn.org and legal aid sources, and say so if you can't verify. Never invent statutes, deadlines or phone numbers. Keep answers short and plain. For urgent or case-specific problems point to HOME Line (612) 728-5767 / (866) 866-3546, the MN Attorney General (651) 296-3353, or legal aid. Tenant Justice MN is not operational yet (expected end of 2027). If someone is in danger, tell them to call 911.`;
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
    try {
      const { messages } = await req.json();
      const contents = (messages || []).slice(-10).map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 600) }] }));
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 700 } })
      });
      const j = await r.json();
      const c = j.candidates && j.candidates[0];
      const reply = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
      const sources = ((c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []).filter(g => g.web).map(g => ({ uri: g.web.uri, title: g.web.title }));
      if (!reply) throw new Error('empty');
      return new Response(JSON.stringify({ reply, sources }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'failed' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
};
