<script lang="ts">
	import { browser } from '$app/environment';
	import { mode } from 'mode-watcher';
	import { diagrams, layout } from '$lib/diagrams';

	// {% flow name="event-sourcing-write" /%}
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
	//
	// Diagrams are rendered "static" — no panning, dragging, zooming
	// or controls. This is by design: the doc page is the focus, the
	// diagram is illustrative. Dagre handles positioning so the spec
	// only lists nodes + edges (Mermaid-style authoring).

	type Props = { name?: string };
	const { name = '' }: Props = $props();

	const spec = $derived(name ? diagrams[name] : undefined);
	// layout() is pure; computing it eagerly (even during SSR, where
	// dagre runs but SvelteFlow doesn't) gives us the canvas height
	// for the placeholder so prerender and hydration agree.
	const computed = $derived(spec ? layout(spec) : null);
	const height = $derived(computed?.height ?? 320);

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

{#if !spec || !computed}
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
			<SvelteFlow
				nodes={computed.nodes}
				edges={computed.edges}
				fitView
				colorMode={mode.current === 'dark' ? 'dark' : 'light'}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				zoomOnScroll={false}
				zoomOnPinch={false}
				zoomOnDoubleClick={false}
				panOnScroll={false}
				panOnDrag={false}
				preventScrolling={false}
			>
				<Background />
			</SvelteFlow>
		{:else}
			<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
				Diagram (interactive — enable JavaScript to view)
			</div>
		{/if}
	</div>
{/if}
