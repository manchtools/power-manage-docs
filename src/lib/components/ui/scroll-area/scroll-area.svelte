<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';
	import ScrollAreaScrollbar from './scroll-area-scrollbar.svelte';

	type Props = ScrollAreaPrimitive.RootProps & {
		class?: string;
		orientation?: 'horizontal' | 'vertical' | 'both';
		scrollbarXClasses?: string;
		scrollbarYClasses?: string;
	};

	let {
		class: className,
		orientation = 'vertical',
		scrollbarXClasses,
		scrollbarYClasses,
		children,
		ref = $bindable(null),
		...restProps
	}: Props = $props();
</script>

<ScrollAreaPrimitive.Root
	bind:ref
	data-slot="scroll-area"
	{...restProps}
	class={cn('relative overflow-hidden', className)}
>
	<ScrollAreaPrimitive.Viewport class="h-full w-full rounded-[inherit]">
		{@render children?.()}
	</ScrollAreaPrimitive.Viewport>
	{#if orientation === 'vertical' || orientation === 'both'}
		<ScrollAreaScrollbar orientation="vertical" class={scrollbarYClasses} />
	{/if}
	{#if orientation === 'horizontal' || orientation === 'both'}
		<ScrollAreaScrollbar orientation="horizontal" class={scrollbarXClasses} />
	{/if}
	<ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
