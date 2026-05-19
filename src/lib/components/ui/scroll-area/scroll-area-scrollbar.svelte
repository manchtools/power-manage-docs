<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	type Props = ScrollAreaPrimitive.ScrollbarProps & {
		class?: string;
	};

	let {
		ref = $bindable(null),
		class: className,
		orientation = 'vertical',
		...restProps
	}: Props = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
	bind:ref
	{orientation}
	data-slot="scroll-area-scrollbar"
	class={cn(
		'flex touch-none select-none p-px transition-colors',
		orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
		orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
		className
	)}
	{...restProps}
>
	<ScrollAreaPrimitive.Thumb class={cn('bg-border relative flex-1 rounded-full')} />
</ScrollAreaPrimitive.Scrollbar>
