<script lang="ts">
	import { cn } from '$lib/utils';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	// {% callout type="info|warn|danger|success" title="..." %} ... {% /callout %}
	//
	// The variant table is intentionally narrow — keep callout usage
	// editorially consistent. Don't add new types unless the
	// information class genuinely doesn't fit the four below; a fifth
	// variant tends to dilute the signal of the existing ones.

	type Variant = 'info' | 'warn' | 'danger' | 'success';

	type Props = {
		type?: Variant;
		title?: string;
		children?: import('svelte').Snippet;
	};

	const { type = 'info', title, children }: Props = $props();

	const variantStyles: Record<Variant, string> = {
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

<aside
	class={cn(
		'not-prose my-6 rounded-lg border-l-4 p-4',
		variantStyles[type]
	)}
	role="note"
>
	<div class="flex items-start gap-3">
		<Icon class="mt-1 size-5 shrink-0" />
		<div class="min-w-0 flex-1">
			{#if title}
				<p class="mt-0 mb-1 font-semibold">{title}</p>
			{/if}
			<div class="prose-sm [&_p]:my-1 [&_p:last-child]:mb-0">
				{@render children?.()}
			</div>
		</div>
	</div>
</aside>
