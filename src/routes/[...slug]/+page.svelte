<script lang="ts">
	import type { Component } from 'svelte';
	import Toc from '$lib/components/toc.svelte';
	import PrevNext from '$lib/components/prev-next.svelte';
import * as Tabs from "$lib/components/ui/tabs/index.js";
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
<Tabs.Root value="account" class="w-[400px]">
  <Tabs.List>
    <Tabs.Trigger value="account">Account</Tabs.Trigger>
    <Tabs.Trigger value="password">Password</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="account">
    Make changes to your account here.
  </Tabs.Content>
  <Tabs.Content value="password">Change your password here.</Tabs.Content>
</Tabs.Root>
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
