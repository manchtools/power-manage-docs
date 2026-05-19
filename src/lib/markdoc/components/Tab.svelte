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

<Tabs.Content value={label} class="prose-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
	{@render children?.()}
</Tabs.Content>
