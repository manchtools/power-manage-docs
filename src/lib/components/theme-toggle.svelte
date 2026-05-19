<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';

	// Identical pattern to web/'s theme toggle — mode-watcher handles
	// the localStorage + html.dark class wiring, we just need the
	// trigger. Single icon swaps via Tailwind's dark: variant so we
	// don't ship a "current mode" prop that gets out of sync.
</script>

<Button variant="ghost" size="icon-sm" onclick={toggleMode} aria-label="Toggle theme">
	<Sun class="size-4 dark:hidden" />
	<Moon class="hidden size-4 dark:block" />
</Button>
