import { showArcgisPopup } from './arcgisPopupUtils';

// Handler refs per uploaded service key, for event cleanup
const handlerRefs = {};

// Track currently hovered / clicked feature per source (same behavior as ArcGIS vector layers)
const hoveredFeatures = {};
const pinnedFeatures = {};

export const uploadedSourceId = (serviceKey) => `uploaded-source-${serviceKey}`;

export const uploadedLayerIds = (serviceKey) => [
    `uploaded-fill-${serviceKey}`,
    `uploaded-line-${serviceKey}`,
    `uploaded-circle-${serviceKey}`,
];

const hoverCase = (hoverValue, baseValue) =>
    ['case', ['boolean', ['feature-state', 'hover'], false], hoverValue, baseValue];

/**
 * Add a clickable vector layer for a user-uploaded file (GeoJSON/KML/Shapefile).
 * Mirrors addArcgisVectorLayer: hover highlight, click pins the feature and opens
 * the same in-map popup used by ArcGIS layers.
 * @param {mapboxgl.Map} map
 * @param {Object} service - Uploaded layer row ({ key, label })
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @param {number} opacity
 */
export function addUploadedVectorLayer(map, service, geojson, opacity) {
    const sourceId = uploadedSourceId(service.key);
    const [fillLayerId, lineLayerId, circleLayerId] = uploadedLayerIds(service.key);

    // Remove any previous layers/handlers for this service
    removeUploadedVectorLayer(map, service.key);

    // generateId gives every feature a numeric id so feature-state hover works
    map.addSource(sourceId, { type: 'geojson', data: geojson, generateId: true });

    map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
            'fill-color': '#3388ff',
            'fill-opacity': hoverCase(opacity * 0.65, opacity * 0.35),
        },
    });
    map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
            'line-color': '#1a66ff',
            'line-width': hoverCase(4, 2),
            'line-opacity': opacity,
        },
    });
    map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
            'circle-radius': hoverCase(8, 5),
            'circle-color': '#3388ff',
            'circle-opacity': opacity,
        },
    });

    function setHover(e) {
        // Clear previous hovered feature (but not the pinned one)
        if (hoveredFeatures[sourceId] != null && hoveredFeatures[sourceId] !== pinnedFeatures[sourceId]) {
            map.setFeatureState({ source: sourceId, id: hoveredFeatures[sourceId] }, { hover: false });
        }
        if (e.features.length > 0) {
            hoveredFeatures[sourceId] = e.features[0].id;
            map.setFeatureState({ source: sourceId, id: e.features[0].id }, { hover: true });
        }
        map.getCanvas().style.cursor = 'pointer';
    }

    function clearHover() {
        if (hoveredFeatures[sourceId] != null && hoveredFeatures[sourceId] !== pinnedFeatures[sourceId]) {
            map.setFeatureState({ source: sourceId, id: hoveredFeatures[sourceId] }, { hover: false });
        }
        hoveredFeatures[sourceId] = null;
        map.getCanvas().style.cursor = '';
    }

    function unpinFeature() {
        const pinnedId = pinnedFeatures[sourceId];
        if (pinnedId != null) {
            if (hoveredFeatures[sourceId] !== pinnedId) {
                map.setFeatureState({ source: sourceId, id: pinnedId }, { hover: false });
            }
            pinnedFeatures[sourceId] = null;
        }
    }

    const handlePopup = (e) => {
        // Prevent a duplicate popup when the click hits fill + line for the same feature
        if (e.originalEvent._arcgisPopupHandled) return;
        e.originalEvent._arcgisPopupHandled = true;

        const feature = e.features[0];
        if (feature) {
            pinnedFeatures[sourceId] = feature.id;
            map.setFeatureState({ source: sourceId, id: feature.id }, { hover: true });
        }
        showArcgisPopup(e, { id: service.key, name: service.label }).then(popup => {
            if (popup && popup.on) popup.on('close', () => unpinFeature());
        });
    };
    const handleMouseMove = (e) => setHover(e);
    const handleMouseLeave = () => clearHover();

    handlerRefs[service.key] = { handlePopup, handleMouseMove, handleMouseLeave };

    [fillLayerId, lineLayerId, circleLayerId].forEach(layerId => {
        map.on('click', layerId, handlePopup);
        map.on('mousemove', layerId, handleMouseMove);
        map.on('mouseleave', layerId, handleMouseLeave);
    });
}

/**
 * Remove an uploaded layer's map layers, source and event listeners.
 */
export function removeUploadedVectorLayer(map, serviceKey) {
    const sourceId = uploadedSourceId(serviceKey);
    const layerIds = uploadedLayerIds(serviceKey);

    const refs = handlerRefs[serviceKey];
    if (refs) {
        layerIds.forEach(layerId => {
            map.off('click', layerId, refs.handlePopup);
            map.off('mousemove', layerId, refs.handleMouseMove);
            map.off('mouseleave', layerId, refs.handleMouseLeave);
        });
        delete handlerRefs[serviceKey];
    }

    layerIds.forEach(layerId => {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
    });
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    delete hoveredFeatures[sourceId];
    delete pinnedFeatures[sourceId];
}

/**
 * Apply the opacity slider to every uploaded layer on the map, keeping the
 * hover-highlight expressions intact.
 */
export function setUploadedVectorOpacity(map, opacity) {
    const style = map.getStyle && map.getStyle();
    if (!style || !Array.isArray(style.layers)) return;
    style.layers.forEach(l => {
        if (l.id.startsWith('uploaded-fill-')) {
            map.setPaintProperty(l.id, 'fill-opacity', hoverCase(opacity * 0.65, opacity * 0.35));
        } else if (l.id.startsWith('uploaded-line-')) {
            map.setPaintProperty(l.id, 'line-opacity', opacity);
        } else if (l.id.startsWith('uploaded-circle-')) {
            map.setPaintProperty(l.id, 'circle-opacity', opacity);
        }
    });
}
