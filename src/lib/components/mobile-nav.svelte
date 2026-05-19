<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import Sidebar from './sidebar.svelte';
	import Menu from '@lucide/svelte/icons/menu';

	// Mobile hamburger + drawer. Visible only at md:hidden; the
	// desktop sticky sidebar covers everything from md+ already.
	//
	// Built on shadcn-svelte's Sheet primitive: focus trap, return
	// focus to the trigger, Esc + outside-click dismissal and the
	// slide-in chrome all come for free from bits-ui under the hood.
	// We only own the trigger button, the inner nav, and the close
	// behaviour on navigation.

	let open = $state(false);

	// Close on every successful navigation so tapping a link drops
	// the drawer rather than leaving it covering the destination.
	afterNavigate(() => {
		open = false;
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				class="md:hidden"
				aria-label="Open navigation menu"
			>
				<Menu class="size-5" />
			</Button>
		{/snippet}
	</Sheet.Trigger>

	<Sheet.Content side="left" class="w-72 max-w-[85vw] gap-0 p-0">
		<Sheet.Header class="h-14 border-b border-border px-4">
			<Sheet.Title class="text-base">Menu</Sheet.Title>
			<Sheet.Description class="sr-only">Documentation navigation</Sheet.Description>
		</Sheet.Header>
		<Sidebar />
	</Sheet.Content>
</Sheet.Root>
