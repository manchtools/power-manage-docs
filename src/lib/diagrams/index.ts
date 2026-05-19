import { Position, type Node, type Edge } from '@xyflow/svelte';

// Diagram registry — every {% flow name="..." %} tag in Markdoc
// looks up a config here by `name`. Keeping diagram definitions in
// .ts (not inline in Markdoc) means: typed nodes/edges, autocomplete,
// and the option to share node primitives across diagrams later.

export type DiagramConfig = {
	nodes: Node[];
	edges: Edge[];
	// Render height in px. SvelteFlow needs an explicit height
	// because the parent is `display: block`, not a flex/grid cell.
	height?: number;
};

// Shared visual vocabulary. Colours reference shadcn theme tokens so
// both light and dark modes pick up the right palette automatically
// — `colorMode` only flips the SvelteFlow background grid; the node
// fills come from `hsl(var(--…))`.
const STORE = 'background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border: 1px solid hsl(var(--border));';
const SERVICE = 'background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: 1px solid hsl(var(--border));';
const ACTOR = 'background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); border: 1px solid hsl(var(--border));';

export const diagrams: Record<string, DiagramConfig> = {
	'event-sourcing-write': {
		height: 360,
		nodes: [
			{
				id: 'client',
				position: { x: 0, y: 140 },
				data: { label: 'Client (web / CLI)' },
				style: ACTOR,
				sourcePosition: Position.Right,
				targetPosition: Position.Left
			},
			{
				id: 'handler',
				position: { x: 200, y: 140 },
				data: { label: 'RPC handler\n(internal/api)' },
				style: SERVICE,
				sourcePosition: Position.Right,
				targetPosition: Position.Left
			},
			{
				id: 'append',
				position: { x: 420, y: 60 },
				data: { label: 'AppendEvent\nWithVersion' },
				style: SERVICE,
				sourcePosition: Position.Right,
				targetPosition: Position.Left
			},
			{
				id: 'events',
				position: { x: 640, y: 60 },
				data: { label: 'events\n(append-only log)' },
				style: STORE,
				sourcePosition: Position.Bottom,
				targetPosition: Position.Left
			},
			{
				id: 'listener',
				position: { x: 640, y: 220 },
				data: { label: 'Projector listener\n(post-commit)' },
				style: SERVICE,
				sourcePosition: Position.Left,
				targetPosition: Position.Top
			},
			{
				id: 'projection',
				position: { x: 420, y: 220 },
				data: { label: '*_projection\n(read model)' },
				style: STORE,
				sourcePosition: Position.Left,
				targetPosition: Position.Right
			},
			{
				id: 'read',
				position: { x: 200, y: 220 },
				data: { label: 'Read query\n(handler)' },
				style: SERVICE,
				sourcePosition: Position.Left,
				targetPosition: Position.Right
			}
		],
		edges: [
			{ id: 'e1', source: 'client', target: 'handler', label: 'Connect-RPC' },
			{ id: 'e2', source: 'handler', target: 'append' },
			{ id: 'e3', source: 'append', target: 'events', label: 'INSERT' },
			{ id: 'e4', source: 'events', target: 'listener', label: 'commit', animated: true },
			{ id: 'e5', source: 'listener', target: 'projection', label: 'UPSERT' },
			{ id: 'e6', source: 'projection', target: 'read', label: 'SELECT' },
			{ id: 'e7', source: 'read', target: 'client', label: 'response' }
		]
	},

	'control-gateway-agent': {
		height: 380,
		nodes: [
			{
				id: 'web',
				position: { x: 0, y: 40 },
				data: { label: 'Web / CLI\n(JWT)' },
				style: ACTOR,
				sourcePosition: Position.Right,
				targetPosition: Position.Left
			},
			{
				id: 'control',
				position: { x: 220, y: 40 },
				data: { label: 'Control server\n(Connect-RPC)' },
				style: SERVICE,
				sourcePosition: Position.Right,
				targetPosition: Position.Left
			},
			{
				id: 'pg',
				position: { x: 220, y: 240 },
				data: { label: 'PostgreSQL\nevents + projections' },
				style: STORE,
				sourcePosition: Position.Top,
				targetPosition: Position.Top
			},
			{
				id: 'valkey',
				position: { x: 440, y: 240 },
				data: { label: 'Valkey\nAsynq queues' },
				style: STORE,
				sourcePosition: Position.Top,
				targetPosition: Position.Top
			},
			{
				id: 'gateway',
				position: { x: 440, y: 40 },
				data: { label: 'Gateway\n(no DB)' },
				style: SERVICE,
				sourcePosition: Position.Right,
				targetPosition: Position.Left
			},
			{
				id: 'agent',
				position: { x: 680, y: 40 },
				data: { label: 'Agent\n(mTLS)' },
				style: ACTOR,
				sourcePosition: Position.Left,
				targetPosition: Position.Left
			}
		],
		edges: [
			{ id: 'a1', source: 'web', target: 'control', label: 'HTTPS + JWT' },
			{ id: 'a2', source: 'control', target: 'pg', label: 'sqlc' },
			{ id: 'a3', source: 'control', target: 'valkey', label: 'enqueue', animated: true },
			{ id: 'a4', source: 'valkey', target: 'gateway', label: 'dequeue', animated: true },
			{ id: 'a5', source: 'gateway', target: 'agent', label: 'bidi stream / mTLS', animated: true },
			{ id: 'a6', source: 'gateway', target: 'control', label: 'InternalService\nproxy', type: 'step' }
		]
	}
};
