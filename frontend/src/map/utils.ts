import proj4 from "proj4";

// 32638 → 4326
const EPSG32638 = "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs +type=crs";
const EPSG4326  = "+proj=longlat +datum=WGS84 +no_defs +type=crs";

// اگر GeoJSON میدان crs داشت و 32638 بود، همه مختصات را به 4326 تبدیل می‌کنیم
export function reprojectTo4326<T extends GeoJSON.GeoJSON>(gj: T): T {
  // @ts-ignore
  const crsName = (gj as any)?.crs?.properties?.name ?? "";
  const is32638 = /EPSG(?::|::)32638$/.test(crsName);
  if (!is32638) return gj;

  const tr = (x: number, y: number) => proj4(EPSG32638, EPSG4326, [x, y]) as [number, number];

  const transformCoords = (coords: any, type: string): any => {
    if (type === "Point") return tr(coords[0], coords[1]);
    if (type === "LineString" || type === "MultiPoint") return coords.map((c: any) => tr(c[0], c[1]));
    if (type === "Polygon" || type === "MultiLineString") return coords.map((ring: any) => ring.map((c: any) => tr(c[0], c[1])));
    if (type === "MultiPolygon")
      return coords.map((poly: any) => poly.map((ring: any) => ring.map((c: any) => tr(c[0], c[1]))));
    return coords;
  };

  const clone: any = structuredClone(gj);
  if (clone.type === "FeatureCollection") {
    for (const f of clone.features) {
      f.geometry.coordinates = transformCoords(f.geometry.coordinates, f.geometry.type);
    }
  } else if (clone.type === "Feature") {
    clone.geometry.coordinates = transformCoords(clone.geometry.coordinates, clone.geometry.type);
  }
  delete clone.crs;
  return clone;
}

export async function fetchGeoJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  const gj = await r.json();
  return reprojectTo4326(gj);
}

export function getFeatureCollectionBounds(fc: GeoJSON.FeatureCollection) {
  // بستن محدوده برای FitBounds
  let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;
  const push = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const f of fc.features) {
    const g = f.geometry;
    const scan = (coords: any, type: string) => {
      if (type === "Point") push(coords[0], coords[1]);
      else if (type === "LineString" || type === "MultiPoint") coords.forEach((c: any) => push(c[0], c[1]));
      else if (type === "Polygon" || type === "MultiLineString")
        coords.forEach((ring: any) => ring.forEach((c: any) => push(c[0], c[1])));
      else if (type === "MultiPolygon")
        coords.forEach((poly: any) => poly.forEach((ring: any) => ring.forEach((c: any) => push(c[0], c[1]))));
    };
    scan((g as any).coordinates, g.type);
  }
  return [[minY, minX], [maxY, maxX]] as [[number, number], [number, number]];
}
