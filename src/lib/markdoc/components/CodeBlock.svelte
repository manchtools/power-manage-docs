<script lang="ts">
	import { onMount } from 'svelte';
	import { mode } from 'mode-watcher';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';

	// Fenced code block. Two branches:
	//
	//   - language === 'mermaid' renders as a diagram via mermaid.js.
	//     Dynamic-imported on mount so the ~500KB bundle never ships
	//     on pages without diagrams. Re-renders when the colour mode
	//     flips so light/dark stays correct. Theme variables resolve
	//     from the shadcn CSS tokens at render time, so the diagram
	//     picks up whatever palette the rest of the docs is using.
	//
	//   - everything else gets Shiki-highlighted on mount. Dynamic
	//     import: zero added weight on initial paint, brief flash of
	//     unhighlighted code on first render (acceptable for docs).

	type Props = {
		content: string;
		language?: string;
	};

	const { content, language = 'text' }: Props = $props();

	const isMermaid = $derived(language === 'mermaid');

	let highlighted = $state<string | null>(null);
	let mermaidSvg = $state<string | null>(null);
	let mermaidError = $state<string | null>(null);
	let copied = $state(false);

	// Stable id per mounted component so mermaid.render's internal
	// xlink:href targets don't collide when a page has more than one
	// diagram. crypto.randomUUID isn't available SSR-side, so keep
	// this client-only by deriving inside an effect.
	let diagramId = $state('mermaid-pending');

	onMount(() => {
		if (isMermaid) {
			diagramId = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
			return; // handled by the theme-reactive effect below
		}
		void (async () => {
			try {
				const { codeToHtml } = await import('shiki');
				highlighted = await codeToHtml(content.trimEnd(), {
					lang: language,
					themes: { light: 'github-light', dark: 'github-dark' },
					defaultColor: false
				});
			} catch (err) {
				console.warn('[CodeBlock] highlight failed', { language, err });
			}
		})();
	});

	// Resolves a shadcn `--token` to a colour mermaid can parse.
	// The tokens in this project are oklch() values; mermaid's
	// colour parser only handles rgb/hex/hsl. Trick: set the raw
	// colour on a hidden DOM element and read it back via
	// getComputedStyle — the browser's CSS engine always normalises
	// `color` to `rgb(r, g, b)` or `rgba(...)` regardless of the
	// input syntax (oklch, hsl, hex, named). Far more reliable
	// across browsers than the canvas2d round-trip, which some
	// engines return un-normalised.
	function token(name: string): string {
		const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		if (!raw) return '';
		const probe = document.createElement('span');
		probe.style.color = raw;
		probe.style.position = 'absolute';
		probe.style.visibility = 'hidden';
		probe.style.pointerEvents = 'none';
		document.body.appendChild(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return resolved || raw;
	}

	$effect(() => {
		if (!isMermaid || diagramId === 'mermaid-pending') return;
		// Subscribe to the colour mode so a theme flip re-renders.
		const isDark = mode.current === 'dark';
		void (async () => {
			try {
				const mermaid = (await import('mermaid')).default;
				mermaid.initialize({
					startOnLoad: false,
					theme: 'base',
					securityLevel: 'strict',
					fontFamily:
						'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
					themeVariables: {
						background: 'transparent',
						primaryColor: token('--primary'),
						primaryTextColor: token('--primary-foreground'),
						primaryBorderColor: token('--primary'),
						secondaryColor: token('--secondary'),
						secondaryTextColor: token('--secondary-foreground'),
						secondaryBorderColor: token('--border'),
						tertiaryColor: token('--muted'),
						tertiaryTextColor: token('--muted-foreground'),
						tertiaryBorderColor: token('--border'),
						mainBkg: token('--primary'),
						lineColor: token('--foreground'),
						textColor: token('--foreground'),
						nodeBorder: token('--border'),
						clusterBkg: token('--muted'),
						clusterBorder: token('--border'),
						edgeLabelBackground: token('--background'),
						fontSize: '14px'
					},
					flowchart: {
						curve: 'basis',
						htmlLabels: true,
						padding: 16,
						nodeSpacing: 50,
						rankSpacing: 60,
						useMaxWidth: true
					}
				});
				const { svg } = await mermaid.render(diagramId, content.trim());
				mermaidSvg = svg;
				mermaidError = null;
				// Mark the effect dependency so reactivity picks up the
				// theme change (mode.current was already read above).
				void isDark;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				mermaidError = msg;
				console.warn('[CodeBlock] mermaid render failed', { err });
			}
		})();
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(content);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard API can fail in cross-origin iframes or under
			// strict CSP. No-op rather than crash; readers can still
			// select and copy by hand.
		}
	}
</script>

{#if isMermaid}
	<figure class="not-prose my-8">
		{#if mermaidError}
			<div
				class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
			>
				<p class="font-medium">Mermaid render failed</p>
				<p class="mt-1 font-mono text-xs">{mermaidError}</p>
				<pre class="mt-2 overflow-x-auto text-xs text-muted-foreground"><code
						>{content}</code
					></pre>
			</div>
		{:else if mermaidSvg}
			<div class="mermaid-figure flex justify-center">
				{@html mermaidSvg}
			</div>
		{:else}
			<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
				Rendering diagram…
			</div>
		{/if}
	</figure>
{:else}
	<div class="not-prose group relative my-6">
		<button
			type="button"
			onclick={copy}
			aria-label={copied ? 'Copied' : 'Copy code'}
			class={cn(
				'absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-md',
				'bg-muted/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity',
				'hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100'
			)}
		>
			{#if copied}
				<Check class="size-4" />
			{:else}
				<Copy class="size-4" />
			{/if}
		</button>

		{#if highlighted}
			<!-- Shiki returns its own <pre>; .shiki class lets us scope theme rules if needed -->
			{@html highlighted}
		{:else}
			<pre><code class="language-{language}">{content}</code></pre>
		{/if}
	</div>
{/if}

<style>
	/* Mermaid output polish. The library inlines most styling onto
	   SVG elements via themeVariables, but a few global tweaks help
	   it sit cleanly in prose:
	   - Cap the rendered SVG width so wide flowcharts don't blow
	     out the layout. mermaid's useMaxWidth:true does the inverse
	     (scale up); this caps the upper bound.
	   - Nudge font weight on node labels so they read as a heading
	     rather than body text. */
	:global(.mermaid-figure svg) {
		max-width: 100%;
		height: auto;
	}
	:global(.mermaid-figure .nodeLabel),
	:global(.mermaid-figure .edgeLabel) {
		font-weight: 500;
	}
	:global(.mermaid-figure .edgeLabel) {
		font-size: 12px;
	}

	/* Shiki dual-theme output: with defaultColor:false, every span
	   gets inline --shiki-light + --shiki-dark CSS variables. We pick
	   which one to read based on the document's dark-mode class. */
	:global(.shiki) {
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		padding: 1rem;
		font-size: 0.875rem;
		line-height: 1.5rem;
		overflow-x: auto;
		color: var(--shiki-light);
		background-color: var(--shiki-light-bg);
	}
	:global(.shiki span) {
		color: var(--shiki-light);
		background-color: var(--shiki-light-bg);
	}
	:global(html.dark .shiki),
	:global(html.dark .shiki span) {
		color: var(--shiki-dark);
		background-color: var(--shiki-dark-bg);
	}
</style>
