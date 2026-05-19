<script lang="ts">
	import { onMount } from 'svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';
	import Mermaid from './Mermaid.svelte';

	// Fenced code block. Two branches:
	//
	//   - language === 'mermaid' — author writes a (subset of) Mermaid
	//     flowchart in the fence; we parse it and render via SvelteFlow
	//     for nicer chrome (rounded nodes, animated edges, auto-routed
	//     connectors). See src/lib/diagrams/parse.ts for the supported
	//     subset. SvelteFlow is dynamic-imported inside the Mermaid
	//     component so its bundle never ships on pages without diagrams.
	//
	//   - everything else — Shiki-highlight on mount. Dynamic-import:
	//     zero added weight on initial paint, brief flash of
	//     unhighlighted code on first render (acceptable for docs).
	//
	// The copy button is independent of highlighting and works
	// regardless of whether Shiki has loaded.

	type Props = {
		content: string;
		language?: string;
	};

	const { content, language = 'text' }: Props = $props();

	const isMermaid = $derived(language === 'mermaid');

	let highlighted = $state<string | null>(null);
	let copied = $state(false);

	onMount(() => {
		if (isMermaid) return; // handled by <Mermaid />
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
	<Mermaid {content} />
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
