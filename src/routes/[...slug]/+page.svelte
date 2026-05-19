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
		<!-- Markdoc-compiled Svelte component renders here. Wrapping
		     in .prose scopes the typographic styles defined in app.css
		     so they only apply to authored content, not the chrome. -->
		<div class="prose">
			<ContentComponent />
		</div>

		<PrevNext currentHref={data.currentHref} />
	</article>

	<Toc />
</div>
