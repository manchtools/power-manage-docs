<script lang="ts">
	import { browser } from '$app/environment';
	import { mode } from 'mode-watcher';
	import { parseMermaid, MermaidParseError } from '$lib/diagrams/parse';
	import { layout } from '$lib/diagrams/layout';

	// Renders a {@code ```mermaid} fence as a SvelteFlow diagram.
	// Authors write Mermaid flowchart syntax; we parse a subset and
	// render with SvelteFlow's chrome (rounded nodes, animated edges,
	// auto-routed connectors) instead of Mermaid's default SVG output.
	//
	// SvelteFlow is dynamic-imported so its bundle doesn't ship on
	// pages without diagrams. dagre layout is pure and runs on both
	// SSR and client, so the prerendered placeholder height matches
	// the hydrated diagram exactly — no layout shift.

	type Props = { content: string };
	const { content }: Props = $props();

	// Parse + layout are pure. Wrap in $derived so a hot-edit during
	// dev re-runs them; catch parse errors so a malformed fence shows
	// a friendly inline message instead of crashing the page.
	type Parsed =
		| { ok: true; value: ReturnType<typeof layout> }
		| { ok: false; error: string };

	const result = $derived.by<Parsed>(() => {
		try {
			const spec = parseMermaid(content);
			return { ok: true, value: layout(spec) };
		} catch (err) {
			if (err instanceof MermaidParseError) {
				return { ok: false, error: err.message };
			}
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	});

	const height = $derived(result.ok ? result.value.height : 160);

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

{#if !result.ok}
	<div
		class="not-prose my-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
	>
		<p class="font-medium">Mermaid parse error</p>
		<p class="mt-1 font-mono text-xs">{result.error}</p>
		<pre class="mt-2 overflow-x-auto text-xs text-muted-foreground"><code>{content}</code></pre>
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
				nodes={result.value.nodes}
				edges={result.value.edges}
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
