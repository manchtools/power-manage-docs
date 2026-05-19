<script lang="ts">
	import { untrack } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	// {% tabs labels="apt,dnf" initial="apt" %}
	//   {% tab label="apt" %} ... {% /tab %}
	//   {% tab label="dnf" %} ... {% /tab %}
	// {% /tabs %}
	//
	// `labels` lists the tab order up-front so the trigger row can
	// render during SSR. Previous attempts relied on each child
	// registering its label via context during render, but Svelte 5
	// SSR is single-pass top-to-bottom: the parent's {#each} block
	// emits before {@render children?.()} runs, so children couldn't
	// populate the list in time.
	//
	// Authors do duplicate labels once (parent attribute + each tab's
	// `label`), but the alternative (a Markdoc transform that lifts
	// child attributes into the parent) is much more code for the
	// same result.

	type Props = {
		labels: string;
		initial?: string;
		children?: import('svelte').Snippet;
	};

	const { labels, initial, children }: Props = $props();

	// `labels` is a comma-separated string from the Markdoc
	// attribute — split + trim so authors can write
	// labels="apt, dnf" with a space and it still works.
	const labelList = $derived(
		labels
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	);

	let value = $state(untrack(() => initial ?? '') || untrack(() => labelList[0] ?? ''));
</script>

<!-- gap-0 overrides the primitive's default gap-2 (8px between
     Tabs.List and Tabs.Content). The Markdoc body usually starts
     with a code block / paragraph that already carries its own
     top margin, so the extra flex gap reads as accidental space. -->
<Tabs.Root bind:value class="gap-0">
	<Tabs.List>
		{#each labelList as label (label)}
			<Tabs.Trigger value={label}>{label}</Tabs.Trigger>
		{/each}
	</Tabs.List>
	{@render children?.()}
</Tabs.Root>
