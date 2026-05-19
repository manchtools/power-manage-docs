<script lang="ts">
	import { browser } from '$app/environment';
	import { mode } from 'mode-watcher';
	import { diagrams } from '$lib/diagrams';

	// {% flow name="event-sourcing-write" %}
	//
	// SvelteFlow is purely client-side: it measures DOM rects during
	// init and stores them in a Svelte store, neither of which exists
	// during SSR/prerender. We gate the import behind `browser` so the
	// prerendered HTML ships a placeholder div with the right dimensions
	// (no layout shift) and the flow hydrates on mount. The trade-off:
	// search engines and JS-disabled visitors see "Diagram (interactive
	// — enable JavaScript to view)" instead of an SVG. Acceptable for
	// supplementary visualisations; if a diagram becomes load-bearing
	// for a concept, author it as an SVG and use {% callout %} text.

	type Props = { name?: string };
	const { name = '' }: Props = $props();

	const config = $derived(name ? diagrams[name] : undefined);
	const height = $derived(config?.height ?? 320);

	// Dynamic import keeps SvelteFlow out of the SSR bundle. The
	// `Loaded` state holds the resolved module so we can render
	// imperatively only after both `browser === true` and the chunk
	// has resolved.
	type LoadedFlow = typeof import('@xyflow/svelte');
	let mod = $state<LoadedFlow | null>(null);

	$effect(() => {
		if (browser && !mod) {
			void Promise.all([
				import('@xyflow/svelte'),
				import('@xyflow/svelte/dist/style.css')
			]).then(([m]) => {
				mod = m;
			});
		}
	});
</script>

{#if !config}
	<div
		class="not-prose my-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
	>
		Unknown diagram: <code>{name}</code>. Add it to <code>src/lib/diagrams/index.ts</code>.
	</div>
{:else}
	<div
		class="not-prose my-6 overflow-hidden rounded-lg border border-border bg-muted/20"
		style="height: {height}px"
	>
		{#if browser && mod}
			{@const SvelteFlow = mod.SvelteFlow}
			{@const Background = mod.Background}
			{@const Controls = mod.Controls}
			<SvelteFlow
				nodes={config.nodes}
				edges={config.edges}
				fitView
				colorMode={mode.current === 'dark' ? 'dark' : 'light'}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				zoomOnScroll={false}
				panOnScroll={false}
			>
				<Background />
				<Controls showLock={false} />
			</SvelteFlow>
		{:else}
			<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
				Diagram (interactive — enable JavaScript to view)
			</div>
		{/if}
	</div>
{/if}
