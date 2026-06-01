<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import TopNav from '$lib/components/top-nav.svelte';
	import Sidebar from '$lib/components/sidebar.svelte';

	type Props = { children?: import('svelte').Snippet };
	const { children }: Props = $props();
</script>

<ModeWatcher />

<!-- Fixed-viewport layout. The outer container is exactly the
     viewport height; the middle row owns the remaining vertical
     space (viewport − topnav − footer). Sidebar and main each
     scroll internally inside that row.

     Why not document scroll: with the previous min-h-screen layout,
     the sidebar's h-[calc(100vh-3.5rem)] forced the row to fill the
     viewport minus the top-nav, and the footer then sat just past
     the fold — producing an unwanted ~70px page scroll on short
     pages. Internal scroll keeps the footer at the bottom of the
     viewport and removes the duplicate h-calc in Sidebar. -->
<div class="flex h-screen flex-col">
	<TopNav />

	<div class="container mx-auto flex w-full max-w-screen-2xl flex-1 overflow-hidden px-4 lg:px-6">
		<aside class="hidden h-full w-64 shrink-0 border-r border-border md:block">
			<Sidebar />
		</aside>

		<!-- Main content. The [...slug] route + landing page both
		     render their content into this slot. The TOC sits inside
		     the page-specific layout because the landing page doesn't
		     have one. -->
		<main class="min-w-0 flex-1 overflow-y-auto" data-pagefind-body>
			{@render children?.()}
		</main>
	</div>

	<footer class="border-t border-border py-6 text-sm text-muted-foreground">
		<div class="container mx-auto max-w-screen-2xl px-4 lg:px-6">
			<p>
				Power Manage docs — built with SvelteKit + Markdoc.
				<a
					class="underline underline-offset-4 hover:text-foreground"
					href="https://github.com/manchtools/power-manage-docs"
				>
					Edit on GitHub
				</a>
			</p>
		</div>
	</footer>
</div>
