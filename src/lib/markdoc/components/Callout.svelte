<script lang="ts">
	import * as Alert from '$lib/components/ui/alert';
	import { cn } from '$lib/utils';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	// {% callout type="info|warn|danger|success" title="..." %} ... {% /callout %}
	//
	// Built on shadcn-svelte's <Alert>. The primitive provides
	// structure (grid layout, role="alert", title/description slots,
	// border + radius + padding); we add the variant-specific colour
	// scheme on top because shadcn ships only default / destructive.
	//
	// Keep the variant table narrow on purpose — a fifth variant
	// dilutes the signal of the existing four.

	type Variant = 'info' | 'warn' | 'danger' | 'success';

	type Props = {
		type?: Variant;
		title?: string;
		children?: import('svelte').Snippet;
	};

	const { type = 'info', title, children }: Props = $props();

	const variantClasses: Record<Variant, string> = {
		info: 'border-blue-500/30 bg-blue-500/5 text-blue-900 dark:text-blue-100',
		warn: 'border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-100',
		danger: 'border-destructive/40 bg-destructive/5 text-destructive dark:text-red-100',
		success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100'
	};

	const Icon = $derived(
		type === 'info'
			? Info
			: type === 'warn'
				? TriangleAlert
				: type === 'danger'
					? OctagonAlert
					: CircleCheck
	);
</script>

<Alert.Root class={cn('not-prose my-6 border-l-4 px-4 py-3', variantClasses[type])}>
	<Icon />
	{#if title}
		<Alert.Title class="font-semibold">{title}</Alert.Title>
	{/if}
	<Alert.Description class="text-current [&_p]:my-1 [&_p:last-child]:mb-0">
		{@render children?.()}
	</Alert.Description>
</Alert.Root>
