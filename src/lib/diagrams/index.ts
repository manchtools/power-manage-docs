import { Position, type Node, type Edge } from '@xyflow/svelte';
import dagre from '@dagrejs/dagre';

// Diagram registry. Author a diagram the way you'd write a Mermaid
// flowchart — list the nodes by id + label + kind, list the edges
// by [from, to], optionally pick a direction. Positions are computed
// by dagre at render time, so adding/removing a node never means
// re-tuning coordinates.
//
// To add a diagram:
//
//   'my-flow': {
//     direction: 'LR',                                  // or 'TB'
//     nodes: [
//       { id: 'a', label: 'Client', kind: 'actor' },
//       { id: 'b', label: 'Server', kind: 'service' },
//       { id: 'c', label: 'DB',     kind: 'store'   }
//     ],
//     edges: [
//       { from: 'a', to: 'b', label: 'request' },
//       { from: 'b', to: 'c', animated: true }
//     ]
//   }
//
// …then reference it from any .md page with
// {% flow name="my-flow" /%}.

export type NodeKind = 'service' | 'store' | 'actor';

export type SpecNode = {
	id: string;
	label: string;
	kind: NodeKind;
};

export type SpecEdge = {
	from: string;
	to: string;
	label?: string;
	animated?: boolean;
	// 'step' produces orthogonal routing; default is the bezier
	// curve. Use 'step' when an edge runs back to a node that's
	// already topologically upstream — bezier overlaps the layout.
	type?: 'bezier' | 'step';
};

export type DiagramSpec = {
	direction?: 'LR' | 'TB';
	nodes: SpecNode[];
	edges: SpecEdge[];
};

// Fixed node dimensions keep dagre's layout deterministic across
// re-renders and let us reserve the right amount of canvas height.
// Adjust here if labels start clipping.
const NODE_W = 180;
const NODE_H = 60;
const NODESEP = 50;
const RANKSEP = 80;
const PAD = 24;

// Per-kind styling pulls from shadcn theme tokens so light/dark
// modes track without any extra wiring — SvelteFlow's colorMode prop
// only flips the background grid; node fills are CSS.
const STYLES: Record<NodeKind, string> = {
	service:
		'background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line;',
	store:
		'background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line;',
	actor:
		'background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line;'
};

// layout runs dagre over the spec and produces SvelteFlow-shaped
// nodes/edges plus the canvas height needed to fit them with a
// margin on each side. Pure function — same spec in, same numbers
// out, so SSR and client agree on the layout.
export function layout(spec: DiagramSpec): { nodes: Node[]; edges: Edge[]; height: number } {
	const direction = spec.direction ?? 'LR';
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: direction, nodesep: NODESEP, ranksep: RANKSEP, marginx: PAD, marginy: PAD });
	g.setDefaultEdgeLabel(() => ({}));

	for (const n of spec.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
	for (const e of spec.edges) g.setEdge(e.from, e.to);
	dagre.layout(g);

	const horizontal = direction === 'LR';
	const sourceP = horizontal ? Position.Right : Position.Bottom;
	const targetP = horizontal ? Position.Left : Position.Top;

	const nodes: Node[] = spec.nodes.map((n) => {
		const { x, y } = g.node(n.id);
		return {
			id: n.id,
			// dagre returns the node *centre*; SvelteFlow expects the
			// top-left corner of the bounding box.
			position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
			data: { label: n.label },
			style: STYLES[n.kind],
			sourcePosition: sourceP,
			targetPosition: targetP,
			width: NODE_W,
			height: NODE_H,
			draggable: false,
			selectable: false,
			connectable: false
		};
	});

	const edges: Edge[] = spec.edges.map((e, i) => ({
		id: `${e.from}->${e.to}#${i}`,
		source: e.from,
		target: e.to,
		label: e.label,
		animated: e.animated,
		type: e.type === 'step' ? 'step' : undefined
	}));

	const graphLabel = g.graph();
	const height = (graphLabel.height ?? 0) + PAD * 2;

	return { nodes, edges, height };
}

export const diagrams: Record<string, DiagramSpec> = {
	'event-sourcing-write': {
		direction: 'LR',
		nodes: [
			{ id: 'client', label: 'Client\n(web / CLI)', kind: 'actor' },
			{ id: 'handler', label: 'RPC handler\n(internal/api)', kind: 'service' },
			{ id: 'append', label: 'AppendEvent\nWithVersion', kind: 'service' },
			{ id: 'events', label: 'events\n(append-only log)', kind: 'store' },
			{ id: 'listener', label: 'Projector listener\n(post-commit)', kind: 'service' },
			{ id: 'projection', label: '*_projection\n(read model)', kind: 'store' },
			{ id: 'read', label: 'Read query\n(handler)', kind: 'service' }
		],
		edges: [
			{ from: 'client', to: 'handler', label: 'Connect-RPC' },
			{ from: 'handler', to: 'append' },
			{ from: 'append', to: 'events', label: 'INSERT' },
			{ from: 'events', to: 'listener', label: 'commit', animated: true },
			{ from: 'listener', to: 'projection', label: 'UPSERT' },
			{ from: 'projection', to: 'read', label: 'SELECT' },
			{ from: 'read', to: 'client', label: 'response', type: 'step' }
		]
	},

	'control-gateway-agent': {
		direction: 'LR',
		nodes: [
			{ id: 'web', label: 'Web / CLI\n(JWT)', kind: 'actor' },
			{ id: 'control', label: 'Control server\n(Connect-RPC)', kind: 'service' },
			{ id: 'pg', label: 'PostgreSQL\nevents + projections', kind: 'store' },
			{ id: 'valkey', label: 'Valkey\nAsynq queues', kind: 'store' },
			{ id: 'gateway', label: 'Gateway\n(no DB)', kind: 'service' },
			{ id: 'agent', label: 'Agent\n(mTLS)', kind: 'actor' }
		],
		edges: [
			{ from: 'web', to: 'control', label: 'HTTPS + JWT' },
			{ from: 'control', to: 'pg', label: 'sqlc' },
			{ from: 'control', to: 'valkey', label: 'enqueue', animated: true },
			{ from: 'valkey', to: 'gateway', label: 'dequeue', animated: true },
			{ from: 'gateway', to: 'agent', label: 'bidi stream / mTLS', animated: true },
			{ from: 'gateway', to: 'control', label: 'InternalService proxy', type: 'step' }
		]
	}
};
