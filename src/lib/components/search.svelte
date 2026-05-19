<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { cn } from '$lib/utils';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';

	// Static-site search via Pagefind. The index is built at
	// build time (see package.json's `build` script) and the
	// pagefind.js loader gets dynamic-imported on first open so
	// the ~80 KB pagefind runtime stays out of the initial bundle.
	//
	// Dev mode has no index (pagefind only runs in the production
	// build), so the import will fail and we surface a friendly
	// "search needs the production build" message rather than
	// breaking the trigger.

	type PagefindResult = {
		url: string;
		excerpt: string;
		meta: {
			title?: string;
		};
		sub_results?: { title: string; url: string; excerpt: string }[];
	};

	type PagefindModule = {
		search(query: string): Promise<{
			results: { id: string; data(): Promise<PagefindResult> }[];
		}>;
		options(opts: Record<string, unknown>): Promise<void>;
	};

	let open = $state(false);
	let query = $state('');
	let results = $state<PagefindResult[]>([]);
	let loading = $state(false);
	let loadError = $state<string | null>(null);

	let mod = $state<PagefindModule | null>(null);
	let inputEl: HTMLInputElement | null = $state(null);

	// macOS shows ⌘, everyone else shows Ctrl. Computed lazily so
	// SSR renders without crashing on `navigator`.
	const isMac = $derived(
		browser &&
			typeof navigator !== 'undefined' &&
			/mac|iphone|ipad|ipod/i.test(navigator.platform || '')
	);

	async function ensureLoaded() {
		if (mod || loading) return;
		loading = true;
		loadError = null;
		try {
			// Vite tries to bundle string-template dynamic imports; the
			// @vite-ignore comment keeps it as a runtime resolve. The
			// path is a public URL served from build/client/pagefind/
			// (see package.json — pagefind output goes there so the
			// bun adapter serves it as /pagefind/...).
			const m = await import(/* @vite-ignore */ `${base}/pagefind/pagefind.js`);
			await m.options({ baseUrl: base + '/' });
			mod = m;
		} catch (err) {
			loadError =
				err instanceof Error && err.message.includes('dynamically imported module')
					? 'Search index not found. Run `bun run build` to generate it (only available in the production build).'
					: 'Failed to load search index.';
			console.warn('[search] load failed', err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!open) {
			results = [];
			query = '';
			return;
		}
		void ensureLoaded();
		// Focus the input one tick after the dialog mounts so the
		// browser actually accepts the focus (Svelte's autofocus is
		// flaky during the same task as the {#if} insertion).
		setTimeout(() => inputEl?.focus(), 0);
	});

	$effect(() => {
		if (!mod || !query.trim()) {
			results = [];
			return;
		}
		const q = query;
		void (async () => {
			const search = await mod.search(q);
			if (q !== query) return; // stale, newer query already in flight
			const top = await Promise.all(search.results.slice(0, 8).map((r) => r.data()));
			results = top;
		})();
	});

	function onKeydown(event: KeyboardEvent) {
		// ⌘K / Ctrl+K opens the dialog from anywhere on the page.
		const isToggle =
			event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
		if (isToggle) {
			event.preventDefault();
			open = !open;
			return;
		}
		if (open && event.key === 'Escape') {
			event.preventDefault();
			open = false;
		}
	}

	// Pagefind reports URLs based on the prerendered file paths
	// (e.g. /concepts/compliance.html, /index.html). SvelteKit's
	// routes use trailingSlash: 'never' (no .html, no trailing slash,
	// '/' for the index). Strip the extension before navigating so
	// goto() lands on a real route.
	function normalizeUrl(url: string): string {
		let u = url;
		if (u.endsWith('/index.html')) u = u.slice(0, -'index.html'.length);
		else if (u.endsWith('.html')) u = u.slice(0, -'.html'.length);
		if (u === '' || u === '/') return '/';
		if (u.endsWith('/')) u = u.slice(0, -1);
		return u;
	}

	function pick(url: string) {
		open = false;
		void goto(normalizeUrl(url));
	}
</script>

<svelte:window on:keydown={onKeydown} />

<button
	type="button"
	onclick={() => (open = true)}
	aria-label="Search docs"
	class={cn(
		'inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5',
		'text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
		'h-9 w-full max-w-xs md:w-64'
	)}
>
	<Search class="size-4 shrink-0" />
	<span class="flex-1 text-left">Search docs…</span>
	<kbd
		class="hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium md:inline-flex"
	>
		{isMac ? '⌘' : 'Ctrl'}<span>K</span>
	</kbd>
</button>

{#if open}
	<!-- Backdrop. Click closes the dialog. role/aria handled on the
	     panel below; this is purely for the dim-out effect. -->
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		role="presentation"
		onclick={() => (open = false)}
		onkeydown={(e) => {
			if (e.key === 'Escape') open = false;
		}}
	></div>
	<div
		role="dialog"
		aria-modal="true"
		aria-label="Search docs"
		class={cn(
			'fixed left-1/2 top-[10vh] z-50 w-[min(640px,calc(100vw-2rem))]',
			'-translate-x-1/2 rounded-lg border border-border bg-popover',
			'text-popover-foreground shadow-2xl'
		)}
	>
		<div class="flex items-center gap-2 border-b border-border px-3">
			<Search class="size-4 shrink-0 text-muted-foreground" />
			<input
				bind:this={inputEl}
				bind:value={query}
				type="text"
				placeholder="Search the docs…"
				class="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
			/>
			<button
				type="button"
				onclick={() => (open = false)}
				aria-label="Close search"
				class="rounded p-1 text-muted-foreground hover:text-foreground"
			>
				<X class="size-4" />
			</button>
		</div>

		<div class="max-h-[60vh] overflow-y-auto">
			{#if loadError}
				<p class="p-4 text-sm text-muted-foreground">{loadError}</p>
			{:else if loading && !mod}
				<p class="p-4 text-sm text-muted-foreground">Loading search index…</p>
			{:else if !query.trim()}
				<p class="p-4 text-sm text-muted-foreground">Start typing to search.</p>
			{:else if results.length === 0}
				<p class="p-4 text-sm text-muted-foreground">No results for "{query}".</p>
			{:else}
				<ul class="p-2">
					{#each results as result (result.url)}
						<li>
							<button
								type="button"
								onclick={() => pick(result.url)}
								class={cn(
									'block w-full rounded-md px-3 py-2 text-left transition-colors',
									'hover:bg-accent hover:text-accent-foreground',
									'focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground'
								)}
							>
								<div class="text-sm font-medium">{result.meta.title || 'Untitled'}</div>
								<!-- excerpt comes back with <mark>...</mark> spans
								     wrapping the matched terms — render as HTML so the
								     highlight survives. -->
								<div class="mt-0.5 text-xs text-muted-foreground [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-foreground dark:[&_mark]:bg-yellow-700/40">
									{@html result.excerpt}
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
			<span>
				<kbd class="rounded border border-border bg-background px-1 font-mono">Esc</kbd>
				to close
			</span>
			<span>Powered by Pagefind</span>
		</div>
	</div>
{/if}
