export type Mm = number;
export type Mm2 = number;

export type Id = string;

export type Point = {
	x: Mm;
	y: Mm;
};

export type WallSegment = {
	id: Id;
	a: Point;
	b: Point;
	/** Architectural thickness in mm (e.g. 100) */
	thicknessMm: Mm;
};

export type Room = {
	id: Id;
	name?: string;
	/** Orthogonal polygon vertices (axis-aligned edges) */
	polygon: Point[];
};

export type RectFurniture = {
	kind: 'rect';
	id: Id;
	name: string;
	x: Mm;
	y: Mm;
	widthMm: Mm;
	heightMm: Mm;
	rotationDeg: number;
	hidden?: boolean;
};

export type CircleFurniture = {
	kind: 'circle';
	id: Id;
	name: string;
	cx: Mm;
	cy: Mm;
	radiusMm: Mm;
	hidden?: boolean;
};

export type PolygonFurniture = {
	kind: 'polygon';
	id: Id;
	name: string;
	points: Point[];
	rotationDeg: number;
	hidden?: boolean;
};

export type Furniture = RectFurniture | CircleFurniture | PolygonFurniture;

export type ReferenceImage = {
	id: Id;
	dataUrl: string;
	x: Mm;
	y: Mm;
	widthMm: Mm;
	heightMm: Mm;
	/** height / width, derived from the image's natural pixel size */
	aspect?: number;
	opacity: number; // 0..1
};

export type Plan = {
	walls: WallSegment[];
	rooms: Room[];
	furniture: Furniture[];
	referenceImage?: ReferenceImage;
};

export type ViewBox = {
	x: number;
	y: number;
	w: number;
	h: number;
};

export type ToolMode =
	| 'select'
	| 'pan'
	| 'draw-wall'
	| 'draw-room'
	| 'place-rect'
	| 'place-circle'
	| 'place-polygon'
	| 'scale-rooms';
