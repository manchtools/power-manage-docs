<script lang="ts">
	import { base } from '$app/paths';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ServerCog from '@lucide/svelte/icons/server-cog';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Cog from '@lucide/svelte/icons/cog';

	// Landing page. The /[...slug] route also serves a "Welcome"
	// content page authored in Markdoc — this hero exists for
	// first-time visitors who land at / and need orientation before
	// reading prose.

	const sections = [
		{
			icon: BookOpen,
			title: 'Get started',
			description: 'Install, deploy, and connect your first agent.',
			href: '/get-started/installation'
		},
		{
			icon: ServerCog,
			title: 'Concepts',
			description: 'Event sourcing, RBAC, dynamic device groups.',
			href: '/concepts/architecture'
		},
		{
			icon: Cog,
			title: 'Action reference',
			description: 'Every action type the agent can execute.',
			href: '/action-reference'
		},
		{
			icon: ShieldCheck,
			title: 'Security',
			description: 'mTLS, signed dispatches, audit trail.',
			href: '/security/threat-model'
		}
	];
</script>

<svelte:head>
	<title>power-manage — Documentation</title>
</svelte:head>

<div class="px-6 py-12 lg:py-16 xl:px-12">
	<section class="max-w-3xl">
		<p class="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
			Documentation
		</p>
		<h1 class="text-4xl font-bold tracking-tight md:text-5xl">
			Linux fleet management,<br />declarative and audit-first
		</h1>
		<p class="mt-6 text-lg leading-relaxed text-muted-foreground">
			power-manage is an open-source platform for managing Linux endpoints. mTLS-authenticated
			agents, an event-sourced audit log, OIDC and SCIM provisioning, and twenty-three idempotent
			action types covering packages, services, files, and LUKS rotation.
		</p>
		<div class="mt-8 flex flex-wrap gap-3">
			<Button href={base + '/get-started/installation'}>
				Get started
				<ArrowRight class="ml-2 size-4" />
			</Button>
			<Button variant="outline" href={base + '/concepts/architecture'}>
				Architecture overview
			</Button>
		</div>
	</section>

	<section class="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each sections as s (s.href)}
			<a href={base + s.href} class="block transition-transform hover:-translate-y-0.5">
				<Card class="h-full">
					<CardHeader>
						<s.icon class="size-6 text-primary" />
						<CardTitle class="mt-2 text-base">{s.title}</CardTitle>
						<CardDescription>{s.description}</CardDescription>
					</CardHeader>
				</Card>
			</a>
		{/each}
	</section>
</div>
