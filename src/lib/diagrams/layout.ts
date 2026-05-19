import { Position, type Node, type Edge } from '@xyflow/svelte';
import dagre from '@dagrejs/dagre';
import type { DiagramSpec, NodeKind, EdgeStyle } from './parse';

// Fixed node dimensions keep dagre's layout deterministic across
// re-renders and let us reserve the right canvas height. Adjust here
// if labels start clipping.
const NODE_W = 180;
const NODE_H = 60;
const NODESEP = 50;
const RANKSEP = 80;
const PAD = 24;

const STYLES: Record<NodeKind, string> = {
	service:
		'background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line;',
	store:
		'background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line;',
	actor:
		'background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); border: 1px solid hsl(var(--border)); border-radius: 9999px; padding: 8px 12px; font-size: 13px; line-height: 1.3; text-align: center; white-space: pre-line;'
};

function edgeProps(style: EdgeStyle): Partial<Edge> {
	switch (style) {
		case 'dashed':
			return { animated: true, style: 'stroke-dasharray: 5 5;' };
		case 'thick':
			return { style: 'stroke-width: 2.5px;' };
		default:
			return {};
	}
}

export type Laid = { nodes: Node[]; edges: Edge[]; height: number };

// layout runs dagre over a parsed Mermaid spec and produces
// SvelteFlow-shaped nodes/edges plus the canvas height needed to
// fit them with a margin on each side. Pure function — same spec
// in, same numbers out, so SSR and client agree on the layout.
export function layout(spec: DiagramSpec): Laid {
	const g = new dagre.graphlib.Graph();
	g.setGraph({
		rankdir: spec.direction,
		nodesep: NODESEP,
		ranksep: RANKSEP,
		marginx: PAD,
		marginy: PAD
	});
	g.setDefaultEdgeLabel(() => ({}));

	for (const n of spec.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
	for (const e of spec.edges) g.setEdge(e.from, e.to);
	dagre.layout(g);

	const horizontal = spec.direction === 'LR' || spec.direction === 'RL';
	const sourceP = horizontal ? Position.Right : Position.Bottom;
	const targetP = horizontal ? Position.Left : Position.Top;

	const nodes: Node[] = spec.nodes.map((n) => {
		const { x, y } = g.node(n.id);
		return {
			id: n.id,
			// dagre returns the node *centre*; SvelteFlow expects the
			// top-left of the bounding box.
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
		...edgeProps(e.style)
	}));

	const graphLabel = g.graph();
	const height = (graphLabel.height ?? 0) + PAD * 2;

	return { nodes, edges, height };
}
