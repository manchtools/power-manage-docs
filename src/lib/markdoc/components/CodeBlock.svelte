<script lang="ts">
	import { onMount } from 'svelte';
	import { mode } from 'mode-watcher';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';

	// Fenced code block. Two branches:
	//
	//   - language === 'mermaid' — render as a diagram via mermaid.js.
	//     Dynamic-imported on mount so the ~500KB mermaid bundle never
	//     ships unless the page actually has a diagram. Re-renders when
	//     the colour mode flips so light/dark stays correct.
	//
	//   - everything else — Shiki-highlight on mount. Same dynamic-
	//     import pattern: zero added weight on the initial paint, brief
	//     flash of unhighlighted code on first render (acceptable for
	//     docs; switch to build-time highlighting if it ever annoys).
	//
	// The copy button is independent of highlighting and works regardless
	// of whether Shiki/mermaid has loaded — for mermaid fences we hide it
	// because copying the DSL source out of a rendered diagram is rarely
	// what the reader wants.

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

	// Stable id per mounted component so mermaid.render's xlink:href
	// targets don't collide when a page has more than one diagram.
	const diagramId = `mermaid-${Math.random().toString(36).slice(2, 10)}`;

	onMount(() => {
		if (isMermaid) return; // mermaid is handled by its own $effect (theme-reactive)
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

	$effect(() => {
		if (!isMermaid) return;
		// Re-render when mode flips. mermaid is initialized once with
		// the current theme — to switch themes we re-initialize and
		// re-render. This is what mermaid.js's own docs recommend.
		const theme = mode.current === 'dark' ? 'dark' : 'default';
		void (async () => {
			try {
				const mermaid = (await import('mermaid')).default;
				mermaid.initialize({
					startOnLoad: false,
					theme,
					securityLevel: 'strict',
					fontFamily: 'inherit'
				});
				const { svg } = await mermaid.render(diagramId, content.trim());
				mermaidSvg = svg;
				mermaidError = null;
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
			// Clipboard API can fail in cross-origin iframes / strict
			// CSP envs. Silently no-op rather than crashing — the
			// reader can still select+copy by hand.
		}
	}
</script>

{#if isMermaid}
	<div class="not-prose my-6 overflow-hidden rounded-lg border border-border bg-muted/20 p-4">
		{#if mermaidError}
			<div class="text-sm text-destructive">
				Mermaid render failed: <code>{mermaidError}</code>
			</div>
			<pre class="mt-2 overflow-x-auto text-xs text-muted-foreground"><code>{content}</code></pre>
		{:else if mermaidSvg}
			<div class="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto">
				{@html mermaidSvg}
			</div>
		{:else}
			<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
				Rendering diagram…
			</div>
		{/if}
	</div>
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
	/* Shiki dual-theme output: with defaultColor:false, every span
	   gets inline --shiki-light + --shiki-dark CSS variables. We pick
	   which one to read based on the document's dark-mode class.
	   Container chrome (padding, border, radius) is ours; per-token
	   colors come from Shiki via the variables. */
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
