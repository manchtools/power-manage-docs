<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	// shadcn-svelte's separator wraps bits-ui's headless primitive.
	// bits-ui is a transitive dep of shadcn-svelte; we use it via
	// shadcn's wrapper rather than importing bits-ui directly.

	type Props = SeparatorPrimitive.RootProps & {
		class?: string;
	};

	let {
		class: className,
		orientation = 'horizontal',
		decorative = true,
		ref = $bindable(null),
		...restProps
	}: Props = $props();
</script>

<SeparatorPrimitive.Root
	bind:ref
	data-slot="separator"
	{orientation}
	{decorative}
	class={cn(
		'bg-border shrink-0',
		orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
		className
	)}
	{...restProps}
/>
