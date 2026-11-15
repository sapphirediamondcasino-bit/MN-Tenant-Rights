// Reads every PDF in ./pdfs, splits it into page-aware chunks, and stores it in Supabase.
// Run on YOUR computer (not in the browser, not on the site):
//   npm init -y
//   npm i pdf-parse @supabase/supabase-js
//   (Windows PowerShell)  $env:SUPABASE_URL="https://ytdqtscvaxwwumabydtj.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"; node ingest-pdfs.mjs
//   (Mac/Linux)           SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node ingest-pdfs.mjs
// The service_role key stays on your machine. Never put it in index.html.

import fs from 'node:fs';
import path from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

const PDF_DIR = process.argv[2] || './pdfs';
const SITE_PATH_PREFIX = 'pdfs'; // folder name on the website
const CHUNK = 1200;
const OVERLAP = 200;

const TITLES = {
  '1-1AG-1 pubLandlordTenants (3).pdf': 'Minnesota Landlord & Tenant Rights Handbook (Attorney General)',
  'H-26 Evictions - Copy.pdf': 'Minnesota Evictions - H-26 Guide',
  'HousingLink - MN Eviction Process.pdf': 'HousingLink - MN Eviction Process'
};

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function slugify(s) {
  return s.toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function clean(t) {
  return t.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function chunkText(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK, text.length);
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end);
      if (sp > i + CHUNK * 0.6) end = sp;
    }
    const piece = text.slice(i, end).trim();
    if (piece.length > 40) out.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out;
}

async function ingestFile(file) {
  const full = path.join(PDF_DIR, file);
  const buf = fs.readFileSync(full);
  const pages = [];
  await pdf(buf, {
    pagerender: async (pageData) => {
      const tc = await pageData.getTextContent();
      const text = tc.items.map((it) => it.str).join(' ');
      pages.push(text);
      return text;
    }
  });

  const totalChars = pages.reduce((n, p) => n + p.length, 0);
  if (totalChars < 200) {
    console.warn(`SKIPPED ${file}: almost no text (scanned PDF?). It needs OCR first.`);
    return;
  }

  const title = TITLES[file] || file.replace(/\.pdf$/i, '');
  const sourcePath = `${SITE_PATH_PREFIX}/${file}`;

  // Re-runs replace the old copy (chunks cascade-delete).
  const del = await supabase.from('documents').delete().eq('source_path', sourcePath);
  if (del.error) throw del.error;

  const ins = await supabase
    .from('documents')
    .insert({ slug: slugify(file), title, source_path: sourcePath, page_count: pages.length })
    .select('id')
    .single();
  if (ins.error) throw ins.error;
  const documentId = ins.data.id;

  const rows = [];
  pages.forEach((p, idx) => {
    chunkText(clean(p)).forEach((content, ci) => {
      rows.push({ document_id: documentId, page: idx + 1, chunk_index: ci, content });
    });
  });

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('document_chunks').insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  console.log(`OK  ${file}: ${pages.length} pages, ${rows.length} chunks stored.`);
}

const files = fs.readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
if (!files.length) {
  console.error(`No PDFs found in ${PDF_DIR}`);
  process.exit(1);
}
for (const f of files) {
  try { await ingestFile(f); } catch (e) { console.error(`FAILED ${f}:`, e.message || e); }
}
console.log('Done.');
