// Sidebar structure for the docs site. Source-of-truth for which
// content pages exist + their grouping; the [...slug] route validates
// paths against the actual file system at request time, but the
// sidebar reads from this list so the order is editorial, not
// alphabetical.
//
// Add a new page in two steps:
//   1. Drop the .md (or .markdoc) into src/content/<group>/<slug>.md
//   2. Add it to the matching `items` list below
//
// Top-level pages (no group) go in the implicit "" section at the
// top of the sidebar.

export type NavItem = {
	title: string;
	href: string;
	/** Optional short label for the sidebar — defaults to title. */
	label?: string;
};

export type NavGroup = {
	title: string;
	items: NavItem[];
};

export const nav: NavGroup[] = [
	{
		title: 'Get started',
		items: [
			{ title: 'Introduction', href: '/' },
			{ title: 'Installation', href: '/get-started/installation' },
			{ title: 'The web UI', href: '/get-started/web-ui' },
			{ title: 'Quick start', href: '/get-started/quick-start' }
		]
	},
	{
		title: 'Concepts',
		items: [
			{ title: 'Architecture', href: '/concepts/architecture' },
			{ title: 'Event sourcing', href: '/concepts/event-sourcing' },
			{ title: 'RBAC and scopes', href: '/concepts/rbac' },
			{ title: 'Dynamic device groups', href: '/concepts/dynamic-groups' },
			{ title: 'Maintenance windows', href: '/concepts/maintenance-windows' },
			{ title: 'Compliance', href: '/concepts/compliance' }
		]
	},
	{
		title: 'Action reference',
		items: [
			{ title: 'Overview', href: '/action-reference' },
			{ title: 'PACKAGE', href: '/action-reference/package' },
			{ title: 'SHELL', href: '/action-reference/shell' },
			{ title: 'FILE', href: '/action-reference/file' },
			{ title: 'SERVICE', href: '/action-reference/service' },
			{ title: 'LPS (password rotation)', href: '/action-reference/lps' },
			{ title: 'ENCRYPTION (LUKS)', href: '/action-reference/encryption' }
		]
	},
	{
		title: 'Security',
		items: [
			{ title: 'Threat model', href: '/security/threat-model' },
			{ title: 'mTLS and signed actions', href: '/security/mtls' },
			{ title: 'Asynq task signing', href: '/security/task-signing' },
			{ title: 'Remote terminal access', href: '/security/terminal-access' },
			{ title: 'Audit log', href: '/security/audit-log' }
		]
	},
	{
		title: 'Operations',
		items: [
			{ title: 'Roadmap', href: '/operations/roadmap' },
			{ title: 'Adding screenshots', href: '/operations/screenshots' }
		]
	}
];

// Flat list, in nav order, for prev/next navigation at the bottom of
// each page. The catch-all route uses this to compute the
// surrounding pages without re-walking the nav tree per-request.
export const flatNav: NavItem[] = nav.flatMap((g) => g.items);
