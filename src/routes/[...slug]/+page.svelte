<script lang="ts">
	import type { Component } from 'svelte';
	import Toc from '$lib/components/toc.svelte';
	import PrevNext from '$lib/components/prev-next.svelte';
	type Props = {
		data: {
			component: Component;
			currentHref: string;
		};
	};
	const { data }: Props = $props();

	const ContentComponent = $derived(data.component);
</script>

<div class="flex">
	<article class="min-w-0 flex-1 px-6 py-12 xl:px-12">
		<!-- Markdoc-compiled Svelte component renders here.
		     prose-neutral matches the shadcn neutral palette; the
		     plugin's prose-invert variant flips it for dark mode. -->
		<div class="prose prose-neutral dark:prose-invert max-w-none">
			<ContentComponent />
		</div>

		<PrevNext currentHref={data.currentHref} />
	</article>

	<Toc />
</div>
