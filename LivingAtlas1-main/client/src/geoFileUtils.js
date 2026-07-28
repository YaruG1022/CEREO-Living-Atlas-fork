/**
 * Parse a user-uploaded file (GeoJSON, KML, or Shapefile ZIP) into a GeoJSON FeatureCollection.
 * @param {File} file
 * @returns {Promise<Object>} GeoJSON FeatureCollection
 */
export async function parseGeoFile(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.geojson') || name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        return normalizeToFeatureCollection(parsed);
    }

    if (name.endsWith('.kml')) {
        const text = await file.text();
        return kmlToGeoJSON(text);
    }

    if (name.endsWith('.zip')) {
        const buffer = await file.arrayBuffer();
        const shpjs = (await import('shpjs')).default;
        const result = await shpjs(buffer);
        // shpjs can return a single FeatureCollection or an array (multi-layer zip)
        if (Array.isArray(result)) {
            const allFeatures = result.flatMap(fc => fc.features || []);
            return { type: 'FeatureCollection', features: allFeatures };
        }
        return normalizeToFeatureCollection(result);
    }

    throw new Error('Unsupported format. Please upload a .geojson, .kml, or .zip (shapefile) file.');
}

function normalizeToFeatureCollection(geojson) {
    if (!geojson || typeof geojson !== 'object') throw new Error('Invalid GeoJSON');
    if (geojson.type === 'FeatureCollection') return geojson;
    if (geojson.type === 'Feature') return { type: 'FeatureCollection', features: [geojson] };
    // Bare geometry
    if (geojson.type && geojson.coordinates) {
        return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
    }
    throw new Error('Unrecognized GeoJSON structure');
}

function kmlToGeoJSON(kmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error('Invalid KML: ' + parseError.textContent.slice(0, 100));

    const features = [];
    const placemarks = doc.querySelectorAll('Placemark');

    placemarks.forEach(pm => {
        const name = pm.querySelector('name')?.textContent?.trim() || '';
        const properties = { name };

        // Collect ExtendedData simple values
        pm.querySelectorAll('SimpleData').forEach(sd => {
            properties[sd.getAttribute('name')] = sd.textContent;
        });

        const point = pm.querySelector('Point');
        const lineString = pm.querySelector('LineString');
        const polygon = pm.querySelector('Polygon');
        const multiGeometry = pm.querySelector('MultiGeometry');

        if (point) {
            const coords = parseKmlCoords(point.querySelector('coordinates')?.textContent);
            if (coords?.length) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords[0] }, properties });
        } else if (lineString) {
            const coords = parseKmlCoords(lineString.querySelector('coordinates')?.textContent);
            if (coords?.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties });
        } else if (polygon) {
            const outerRing = parseKmlPolygonRing(polygon.querySelector('outerBoundaryIs'));
            if (outerRing) {
                const innerRings = Array.from(polygon.querySelectorAll('innerBoundaryIs'))
                    .map(parseKmlPolygonRing).filter(Boolean);
                features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [outerRing, ...innerRings] }, properties });
            }
        } else if (multiGeometry) {
            // Simplified: collect points and lines from MultiGeometry
            const geoms = [];
            multiGeometry.querySelectorAll('Point').forEach(p => {
                const c = parseKmlCoords(p.querySelector('coordinates')?.textContent);
                if (c?.length) geoms.push({ type: 'Point', coordinates: c[0] });
            });
            multiGeometry.querySelectorAll('LineString').forEach(ls => {
                const c = parseKmlCoords(ls.querySelector('coordinates')?.textContent);
                if (c?.length >= 2) geoms.push({ type: 'LineString', coordinates: c });
            });
            if (geoms.length === 1) {
                features.push({ type: 'Feature', geometry: geoms[0], properties });
            } else if (geoms.length > 1) {
                features.push({ type: 'Feature', geometry: { type: 'GeometryCollection', geometries: geoms }, properties });
            }
        }
    });

    return { type: 'FeatureCollection', features };
}

function parseKmlCoords(text) {
    if (!text) return null;
    return text.trim().split(/\s+/)
        .map(p => p.split(',').map(Number))
        .filter(c => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1]))
        .map(c => [c[0], c[1]]);
}

function parseKmlPolygonRing(ringEl) {
    if (!ringEl) return null;
    const coords = parseKmlCoords(ringEl.querySelector('coordinates')?.textContent);
    return coords?.length >= 3 ? coords : null;
}
