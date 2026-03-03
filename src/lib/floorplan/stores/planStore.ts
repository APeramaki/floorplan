import { get, writable } from 'svelte/store';

import { polygonAreaMm2 } from '../geometry';
import type {
	Furniture,
	Plan,
	Point,
	RectFurniture,
	ReferenceImage,
	Room,
	WallSegment
} from '../models';

function newId(): string {
	// Browser crypto; Node also provides global crypto in modern runtimes.
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return Math.random().toString(16).slice(2);
}

export function createEmptyPlan(): Plan {
	return { walls: [], rooms: [], furniture: [] };
}

export const planStore = writable<Plan>(createEmptyPlan());

export function resetPlan() {
	planStore.set(createEmptyPlan());
}

export function setPlan(next: Plan) {
	planStore.set(next);
}

export function addWall(a: Point, b: Point, thicknessMm = 100) {
	const wall: WallSegment = { id: newId(), a, b, thicknessMm };
	planStore.update((p) => ({ ...p, walls: [...p.walls, wall] }));
	return wall.id;
}

export function addRoom(polygon: Point[], name?: string) {
	const room: Room = { id: newId(), polygon, name };
	planStore.update((p) => ({ ...p, rooms: [...p.rooms, room] }));
	return room.id;
}

export function addRectFurniture(input: {
	name?: string;
	x: number;
	y: number;
	widthMm: number;
	heightMm: number;
	rotationDeg?: number;
}) {
	const rect: RectFurniture = {
		kind: 'rect',
		id: newId(),
		name: input.name?.trim() ? input.name.trim() : 'Furniture',
		x: input.x,
		y: input.y,
		widthMm: Math.max(1, input.widthMm),
		heightMm: Math.max(1, input.heightMm),
		rotationDeg: input.rotationDeg ?? 0
	};

	planStore.update((p) => ({ ...p, furniture: [...p.furniture, rect] }));
	return rect.id;
}

export function updateRectFurniture(
	id: string,
	patch: Partial<Omit<RectFurniture, 'id' | 'kind'>>
) {
	planStore.update((p) => ({
		...p,
		furniture: p.furniture.map((f) => {
			if (f.id !== id) return f;
			if (f.kind !== 'rect') return f;
			return { ...f, ...patch };
		})
	}));
}

export function removeFurniture(id: string) {
	planStore.update((p) => ({ ...p, furniture: p.furniture.filter((f) => f.id !== id) }));
}

export function setReferenceImage(img: Omit<ReferenceImage, 'id'> & { id?: string }) {
	const next: ReferenceImage = { ...img, id: img.id ?? newId() };
	planStore.update((p) => ({ ...p, referenceImage: next }));
	return next.id;
}

export function updateReferenceImage(patch: Partial<Omit<ReferenceImage, 'id'>> & { id?: string }) {
	planStore.update((p) => {
		if (!p.referenceImage) return p;
		const { id, ...rest } = patch;
		if (id && id !== p.referenceImage.id) return p;
		return { ...p, referenceImage: { ...p.referenceImage, ...rest } };
	});
}

export function removeReferenceImage() {
	planStore.update((p) => ({ ...p, referenceImage: undefined }));
}

export function scaleRoomsToTargetAreaM2(targetM2: number) {
	if (!Number.isFinite(targetM2) || targetM2 <= 0) {
		throw new Error('Target area must be a number > 0');
	}

	const plan = get(planStore);
	const currentAreaMm2 = plan.rooms.reduce((acc, r) => acc + polygonAreaMm2(r.polygon), 0);
	if (currentAreaMm2 <= 0) {
		throw new Error('Current total room area is 0 — draw at least one room first');
	}

	const targetAreaMm2 = targetM2 * 1_000_000;
	const scale = Math.sqrt(targetAreaMm2 / currentAreaMm2);

	const allPoints = plan.rooms.flatMap((r) => r.polygon);
	if (allPoints.length === 0) {
		throw new Error('No room vertices found');
	}

	const anchor = allPoints.reduce(
		(acc, p) => ({ x: acc.x + p.x / allPoints.length, y: acc.y + p.y / allPoints.length }),
		{ x: 0, y: 0 }
	);

	planStore.update((p) => {
		const referenceImage = p.referenceImage
			? {
				...p.referenceImage,
				x: anchor.x + (p.referenceImage.x - anchor.x) * scale,
				y: anchor.y + (p.referenceImage.y - anchor.y) * scale,
				widthMm: p.referenceImage.widthMm * scale,
				heightMm: p.referenceImage.heightMm * scale
			}
			: undefined;

		return {
			...p,
			referenceImage,
			rooms: p.rooms.map((r) => ({
				...r,
				polygon: r.polygon.map((pt) => ({
					x: anchor.x + (pt.x - anchor.x) * scale,
					y: anchor.y + (pt.y - anchor.y) * scale
				}))
			}))
		};
	});

	return { scale, currentAreaMm2, targetAreaMm2 };
}

export function serializePlan(pretty = true): string {
	return JSON.stringify(get(planStore), null, pretty ? 2 : undefined);
}

export function parsePlanJson(text: string): Plan {
	const raw: unknown = JSON.parse(text);
	return parsePlanObject(raw);
}

function parsePlanObject(raw: unknown): Plan {
	if (!raw || typeof raw !== 'object') throw new Error('Plan must be an object');
	const obj = raw as Record<string, unknown>;

	const walls = parseWalls(obj.walls);
	const rooms = parseRooms(obj.rooms);
	const referenceImage = parseReferenceImage(obj.referenceImage);
	const furniture = parseFurniture(obj.furniture);

	return { walls, rooms, furniture, referenceImage };
}

function parseWalls(raw: unknown): WallSegment[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((w, idx) => {
		if (!w || typeof w !== 'object') throw new Error(`walls[${idx}] must be an object`);
		const obj = w as Record<string, unknown>;
		return {
			id: asStringOptional(obj.id, `walls[${idx}].id`) ?? newId(),
			a: parsePoint(obj.a, `walls[${idx}].a`),
			b: parsePoint(obj.b, `walls[${idx}].b`),
			thicknessMm: asNumberOptional(obj.thicknessMm, `walls[${idx}].thicknessMm`) ?? 100
		};
	});
}

function parseFurniture(raw: unknown): Furniture[] {
	if (!Array.isArray(raw)) return [];

	return raw.map((f, idx) => {
		if (!f || typeof f !== 'object') throw new Error(`furniture[${idx}] must be an object`);
		const obj = f as Record<string, unknown>;
		const kind = asStringOptional(obj.kind, `furniture[${idx}].kind`);
		if (kind !== 'rect') throw new Error(`furniture[${idx}].kind must be 'rect' for now`);

		return {
			kind: 'rect',
			id: asStringOptional(obj.id, `furniture[${idx}].id`) ?? newId(),
			name: asStringOptional(obj.name, `furniture[${idx}].name`) ?? 'Furniture',
			x: asNumber(obj.x, `furniture[${idx}].x`),
			y: asNumber(obj.y, `furniture[${idx}].y`),
			widthMm: asNumber(obj.widthMm, `furniture[${idx}].widthMm`),
			heightMm: asNumber(obj.heightMm, `furniture[${idx}].heightMm`),
			rotationDeg: asNumberOptional(obj.rotationDeg, `furniture[${idx}].rotationDeg`) ?? 0
		} satisfies RectFurniture;
	});
}

function parseReferenceImage(raw: unknown): ReferenceImage | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== 'object') throw new Error('referenceImage must be an object');
	const obj = raw as Record<string, unknown>;

	const dataUrl = asStringOptional(obj.dataUrl, 'referenceImage.dataUrl');
	if (!dataUrl) throw new Error('referenceImage.dataUrl is required');

	const aspect = asNumberOptional(obj.aspect, 'referenceImage.aspect');
	if (aspect !== undefined && (!Number.isFinite(aspect) || aspect <= 0)) {
		throw new Error('referenceImage.aspect must be a number > 0');
	}

	return {
		id: asStringOptional(obj.id, 'referenceImage.id') ?? newId(),
		dataUrl,
		x: asNumber(obj.x, 'referenceImage.x'),
		y: asNumber(obj.y, 'referenceImage.y'),
		widthMm: asNumber(obj.widthMm, 'referenceImage.widthMm'),
		heightMm: asNumber(obj.heightMm, 'referenceImage.heightMm'),
		aspect,
		opacity: asNumberOptional(obj.opacity, 'referenceImage.opacity') ?? 0.5
	};
}

function parseRooms(raw: unknown): Room[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((r, idx) => {
		if (!r || typeof r !== 'object') throw new Error(`rooms[${idx}] must be an object`);
		const obj = r as Record<string, unknown>;
		const polygonRaw = obj.polygon;
		if (!Array.isArray(polygonRaw)) throw new Error(`rooms[${idx}].polygon must be an array`);
		const polygon = polygonRaw.map((p, pIdx) => parsePoint(p, `rooms[${idx}].polygon[${pIdx}]`));
		return {
			id: asStringOptional(obj.id, `rooms[${idx}].id`) ?? newId(),
			name: asStringOptional(obj.name, `rooms[${idx}].name`) ?? undefined,
			polygon
		};
	});
}

function parsePoint(raw: unknown, path: string): Point {
	if (!raw || typeof raw !== 'object') throw new Error(`${path} must be an object`);
	const obj = raw as Record<string, unknown>;
	return {
		x: asNumber(obj.x, `${path}.x`),
		y: asNumber(obj.y, `${path}.y`)
	};
}

function asNumber(v: unknown, path: string): number {
	if (v === undefined || v === null) throw new Error(`${path} is required`);
	if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${path} must be a number`);
	return v;
}

function asNumberOptional(v: unknown, path: string): number | undefined {
	if (v === undefined || v === null) return undefined;
	return asNumber(v, path);
}

function asStringOptional(v: unknown, path: string): string | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v !== 'string') throw new Error(`${path} must be a string`);
	return v;
}
