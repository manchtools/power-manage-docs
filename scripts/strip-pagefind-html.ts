#!/usr/bin/env bun
// Post-build step: rewrite URLs in Pagefind's fragment index so they
// match SvelteKit's route shape (trailingSlash: 'never', no .html).
//
// Pagefind derives URLs from the file path under --site. Pointing it
// at build/prerendered/ gives URLs like /concepts/compliance.html and
// /index.html, which don't match the routes the SvelteKit server
// actually serves. Rather than normalising at click time on the
// client, do it once here so the index ships pre-corrected.
//
// Fragment file format (Pagefind 1.x): gzip-compressed,
// `pagefind_dcd` ASCII prefix, then a JSON object containing
// { url, content, word_count, filters, meta, anchors }.
// We touch only `url`. Everything else (including any `.html`
// substrings that happen to live inside `content`) is untouched.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fragmentDir = 'build/client/pagefind/fragment';
const PREFIX = 'pagefind_dcd';

function normalise(url: string): string {
	let u = url;
	if (u.endsWith('/index.html')) u = u.slice(0, -'index.html'.length);
	else if (u.endsWith('.html')) u = u.slice(0, -'.html'.length);
	if (u !== '/' && u.endsWith('/')) u = u.slice(0, -1);
	return u || '/';
}

let edited = 0;
let skipped = 0;
for (const name of readdirSync(fragmentDir)) {
	if (!name.endsWith('.pf_fragment')) continue;
	const path = join(fragmentDir, name);
	const compressed = readFileSync(path);
	const raw = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(compressed)));
	if (!raw.startsWith(PREFIX)) {
		console.warn(`[strip-pagefind-html] unexpected fragment shape in ${name}; skipping`);
		skipped++;
		continue;
	}
	const json = JSON.parse(raw.slice(PREFIX.length));
	const before = json.url as string;
	json.url = normalise(before);
	if (json.url === before) continue;
	const rewritten = PREFIX + JSON.stringify(json);
	const recompressed = Bun.gzipSync(new TextEncoder().encode(rewritten));
	writeFileSync(path, recompressed);
	edited++;
}

console.log(
	`pagefind: rewrote ${edited} fragment URL${edited === 1 ? '' : 's'}` +
		(skipped ? `, skipped ${skipped} malformed` : '')
);
