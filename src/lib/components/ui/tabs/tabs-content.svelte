<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.ContentProps = $props();
</script>

<!-- `[&_pre]:my-0` strips the @tailwindcss/typography margin from any
     <pre> rendered inside this panel. Without it, the plugin's
     1.71em pre margin stacks with Tabs.Root's gap-2 and the trigger
     row looks like it has accidental ~32px of padding below it.
     Local edit to the shadcn primitive — the shadcn-svelte model is
     'you own the component files, tweak them when defaults don't
     fit'. -->
<TabsPrimitive.Content
	bind:ref
	data-slot="tabs-content"
	class={cn("text-sm flex-1 outline-none [&_pre]:my-0", className)}
	{...restProps}
/>
