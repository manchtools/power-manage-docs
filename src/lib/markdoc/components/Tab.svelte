<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';

	// Single panel inside a {% tabs %} block. Parent owns the trigger
	// row (via its `labels` attribute) so this component just renders
	// a Tabs.Content keyed by the matching `label`.

	type Props = {
		label: string;
		children?: import('svelte').Snippet;
	};

	const { label, children }: Props = $props();
</script>

<!-- Reset first/last-child margins so the body abuts the trigger
     row cleanly. Tab content is typically a CodeBlock or paragraph
     with its own my-6 — without this reset the visible space below
     the tab strip is the sum of (now-zero) flex gap + my-6, which
     looks like accidental padding. -->
<Tabs.Content value={label} class="[&>:first-child]:mt-0 [&>:last-child]:mb-0">
	{@render children?.()}
</Tabs.Content>
