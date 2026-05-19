<script lang="ts">
	import { setContext } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	// {% tabs initial="apt" %}
	//   {% tab label="apt" %} ... {% /tab %}
	//   {% tab label="dnf" %} ... {% /tab %}
	// {% /tabs %}
	//
	// Markdoc-friendly authoring on top of shadcn-svelte's <Tabs>.
	// Children register themselves by label via context, the parent
	// builds the trigger row from that registry, and Tabs.Content
	// from each child renders below.
	//
	// Visual chrome diverges from shadcn's default pill-on-muted look
	// because that look reads as a floating control rather than a
	// "code-sample with tab strip" component. We wrap everything in a
	// bordered card, give the trigger row a bottom border so it sits
	// under the strip, and lean on a strong active-state contrast so
	// the selected tab is unambiguous.

	type Props = {
		initial?: string;
		children?: import('svelte').Snippet;
	};

	const { initial, children }: Props = $props();

	type TabsCtx = {
		register: (label: string) => void;
	};

	let registered = $state<string[]>([]);
	// `initial` is a one-shot default supplied via the Markdoc
	// attribute at parse time and never mutated after. Seeding
	// `value` from it inside an $effect.pre silences the
	// state_referenced_locally lint that flags reading a prop
	// directly into $state.
	let value = $state('');
	$effect.pre(() => {
		if (!value && initial) value = initial;
	});

	setContext<TabsCtx>('docs:tabs', {
		register(label) {
			if (registered.includes(label)) return;
			registered = [...registered, label];
			if (!value) value = label;
		}
	});
</script>

<div class="not-prose my-6 overflow-hidden rounded-lg border border-border">
	<Tabs.Root bind:value class="gap-0">
		<Tabs.List
			class="flex h-auto w-full justify-start rounded-none border-b border-border bg-muted/40 p-0"
		>
			{#each registered as label (label)}
				<Tabs.Trigger
					value={label}
					class="relative rounded-none border-0 bg-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-none data-active:after:absolute data-active:after:inset-x-0 data-active:after:-bottom-px data-active:after:h-0.5 data-active:after:bg-primary"
				>
					{label}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>
		<div class="p-4">
			{@render children?.()}
		</div>
	</Tabs.Root>
</div>
