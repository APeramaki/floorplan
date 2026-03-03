import type { Mm, Mm2, Point } from './models';

export function distanceMm(a: Point, b: Point): Mm {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.hypot(dx, dy);
}

export function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Shoelace formula. Returns absolute area in mm^2.
 * Assumes a non-self-intersecting polygon.
 */
export function polygonAreaMm2(points: Point[]): Mm2 {
	if (points.length < 3) return 0;
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

export function polygonCentroid(points: Point[]): Point {
	// For orthogonal, non-self-intersecting polygons this is usually fine.
	// Falls back to average of vertices when area is ~0.
	const area2 = signedPolygonArea2(points);
	if (Math.abs(area2) < 1e-6) {
		const avg = points.reduce(
			(acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
			{ x: 0, y: 0 }
		);
		return avg;
	}

	let cx = 0;
	let cy = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		const cross = a.x * b.y - b.x * a.y;
		cx += (a.x + b.x) * cross;
		cy += (a.y + b.y) * cross;
	}
	const factor = 1 / (3 * area2);
	return { x: cx * factor, y: cy * factor };
}

function signedPolygonArea2(points: Point[]): number {
	// 2 * signed area
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum;
}

export function formatLengthLabel(mm: Mm): string {
	// mm -> cm with 1 decimal
	const cm = mm / 10;
	return `${cm.toFixed(1)} cm`;
}

export function formatAreaLabel(mm2: Mm2): string {
	const m2 = mm2 / 1_000_000;
	return `${m2.toFixed(2)} m²`;
}

export type SnapResult = {
	point: Point;
	isSnapped: boolean;
	snappedToIndex: number | null;
};

export function snapToPoints(p: Point, candidates: Point[], toleranceMm: Mm): SnapResult {
	let bestIndex: number | null = null;
	let bestDist = Infinity;

	for (let i = 0; i < candidates.length; i++) {
		const d = distanceMm(p, candidates[i]);
		if (d < bestDist) {
			bestDist = d;
			bestIndex = i;
		}
	}

	if (bestIndex !== null && bestDist <= toleranceMm) {
		return { point: candidates[bestIndex], isSnapped: true, snappedToIndex: bestIndex };
	}

	return { point: p, isSnapped: false, snappedToIndex: null };
}

export function closestPointOnSegmentMm(p: Point, a: Point, b: Point): Point {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const apx = p.x - a.x;
	const apy = p.y - a.y;
	const denom = abx * abx + aby * aby;
	if (denom <= 1e-9) return a;

	let t = (apx * abx + apy * aby) / denom;
	t = Math.max(0, Math.min(1, t));
	return { x: a.x + abx * t, y: a.y + aby * t };
}

export function distancePointToSegmentMm(p: Point, a: Point, b: Point): Mm {
	return distanceMm(p, closestPointOnSegmentMm(p, a, b));
}

/**
 * Enforces an axis-aligned (right-angle) step from `from` towards `to`.
 * Keeps whichever axis has the larger delta.
 */
export function orthogonalizeStep(from: Point, to: Point): Point {
	const dx = Math.abs(to.x - from.x);
	const dy = Math.abs(to.y - from.y);
	if (dx >= dy) return { x: to.x, y: from.y };
	return { x: from.x, y: to.y };
}
