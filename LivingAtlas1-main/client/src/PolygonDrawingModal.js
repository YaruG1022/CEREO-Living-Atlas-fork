import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHand, faRotate, faUpRightAndDownLeftFromCenter, faRotateLeft, faRotateRight, faTrash, faShapes, faPalette } from '@fortawesome/free-solid-svg-icons';
import './PolygonDrawingModal.css';

const BEZIER_STEPS = 24; // interpolation points per edge
const DEFAULT_POLYGON_COLOR = '#0077c0';
const MAX_MERCATOR_LAT = 85.0511287798066;

const LINE_STYLES = {
    solid: [],
    dashed: [6, 3],
    dotted: [1.5, 3],
    dashdot: [6, 3, 1.5, 3],
};

const PALETTE_COLORS = [
    '#0077c0', '#e74c3c', '#27ae60', '#f39c12', '#8e44ad',
    '#1abc9c', '#2c3e50', '#d35400', '#c0392b', '#2980b9',
];

function quadBezierSeg(p0, c, p1) {
    const p0Merc = lngLatToMercator(p0);
    const cMerc = lngLatToMercator(c);
    const p1Merc = lngLatToMercator(p1);
    const pts = [];
    for (let i = 0; i <= BEZIER_STEPS; i++) {
        const t = i / BEZIER_STEPS;
        const u = 1 - t;
        const point = mercatorToLngLat({
            x: u * u * p0Merc.x + 2 * u * t * cMerc.x + t * t * p1Merc.x,
            y: u * u * p0Merc.y + 2 * u * t * cMerc.y + t * t * p1Merc.y,
        });
        pts.push([point.lng, point.lat]);
    }
    return pts;
}

function clampMercatorLat(lat) {
    return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

function lngLatToMercator(point) {
    const clampedLat = clampMercatorLat(point.lat);
    const x = (point.lng + 180) / 360;
    const sinLat = Math.sin((clampedLat * Math.PI) / 180);
    const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
    return { x, y };
}

function mercatorToLngLat(point) {
    const lng = point.x * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y))) * 180) / Math.PI;
    return { lng, lat };
}

function buildBezierCoords(verts, ctrlPts) {
    const n = verts.length;
    const coords = [];
    for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const ctrl = ctrlPts[i] ?? {
            lat: (verts[i].lat + verts[next].lat) / 2,
            lng: (verts[i].lng + verts[next].lng) / 2,
        };
        const seg = quadBezierSeg(verts[i], ctrl, verts[next]);
        if (i === 0) coords.push(...seg);
        else coords.push(...seg.slice(1));
    }
    if (coords.length) coords.push(coords[0]);
    return coords;
}

function getDefaultCurveControlPoint(verts, edgeIdx) {
    const next = (edgeIdx + 1) % verts.length;
    const start = lngLatToMercator(verts[edgeIdx]);
    const end = lngLatToMercator(verts[next]);
    return mercatorToLngLat({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
    });
}

function getCurvePointAtHalf(verts, ctrlPts, edgeIdx) {
    const next = (edgeIdx + 1) % verts.length;
    const start = lngLatToMercator(verts[edgeIdx]);
    const end = lngLatToMercator(verts[next]);
    const ctrl = lngLatToMercator(ctrlPts[edgeIdx] ?? getDefaultCurveControlPoint(verts, edgeIdx));

    return mercatorToLngLat({
        x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x,
        y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y,
    });
}

function getControlPointFromCurvePoint(verts, edgeIdx, curvePoint) {
    const next = (edgeIdx + 1) % verts.length;
    const start = lngLatToMercator(verts[edgeIdx]);
    const end = lngLatToMercator(verts[next]);
    const curveMid = lngLatToMercator(curvePoint);

    return mercatorToLngLat({
        x: 2 * curveMid.x - 0.5 * (start.x + end.x),
        y: 2 * curveMid.y - 0.5 * (start.y + end.y),
    });
}

function cloneCurveControlPoints(ctrlPts = {}) {
    return Object.fromEntries(
        Object.entries(ctrlPts).map(([edgeIdx, point]) => [
            edgeIdx,
            { lat: point.lat, lng: point.lng }
        ])
    );
}

function createHistorySnapshot(vertices, curveControlPoints, fillColor, fillOpacity, lineStyle) {
    return {
        vertices: vertices.map(vertex => ({ ...vertex })),
        curveControlPoints: cloneCurveControlPoints(curveControlPoints),
        fillColor: fillColor ?? DEFAULT_POLYGON_COLOR,
        fillOpacity: fillOpacity ?? 0.15,
        lineStyle: lineStyle ?? 'solid',
    };
}

function normalizeHistorySnapshot(snapshot) {
    if (Array.isArray(snapshot)) {
        return createHistorySnapshot(snapshot, {}, DEFAULT_POLYGON_COLOR, 0.15, 'solid');
    }

    return createHistorySnapshot(
        snapshot?.vertices || [],
        snapshot?.curveControlPoints || {},
        snapshot?.fillColor,
        snapshot?.fillOpacity,
        snapshot?.lineStyle
    );
}

const PolygonDrawingModal = ({ onSave, onCancel, initialVertices, initialLineStyle, initialFillColor, mode = 'polygon', initialImageUrl, initialImageDimensions, title }) => {
    const isImageMode = mode === 'image';
    const minimumVertexCount = isImageMode ? 4 : 3;
    const modalTitle = title || (isImageMode ? 'Place Image' : 'Draw Polygon');
    const [vertices, setVertices] = useState(initialVertices || []);
    const [isDrawing, setIsDrawing] = useState(!isImageMode && !(initialVertices && initialVertices.length >= minimumVertexCount));
    const [lineStyle, setLineStyle] = useState(initialLineStyle || 'solid'); // 'solid', 'dashed', 'dotted'
    const [fillColor, setFillColor] = useState(initialFillColor || DEFAULT_POLYGON_COLOR);
    const [showLineMenu, setShowLineMenu] = useState(false);
    const [showColorMenu, setShowColorMenu] = useState(false);
    const [showShapeMenu, setShowShapeMenu] = useState(false);
    const [showOpacityMenu, setShowOpacityMenu] = useState(false);
    const [fillOpacity, setFillOpacity] = useState(0.15);
    const [showImageOpacityMenu, setShowImageOpacityMenu] = useState(false);
    const [imageOpacity, setImageOpacity] = useState(0.85);
    const [activeShape, setActiveShape] = useState(null); // 'triangle' | 'square' | 'rectangle' | 'circle' | 'dot' | 'pentagon' | 'hexagon' | null
    const [isDragMode, setIsDragMode] = useState(false);
    const [isRotateMode, setIsRotateMode] = useState(false);
    const [isResizeMode, setIsResizeMode] = useState(false);
    const [history, setHistory] = useState([]); // undo stack
    const [future, setFuture] = useState([]); // redo stack
    const shapePlacingRef = useRef(null); // { shape, origin: {lat,lng}, active: bool }
    const dragRef = useRef(null); // { origin: {lat,lng}, startVertices: [...] }
    const dragHandlersRef = useRef(null); // store bound handlers for cleanup
    const rotateRef = useRef(null); // { startAngle, centroid, startVertices }
    const rotateHandlersRef = useRef(null);
    const resizeHandlesRef = useRef([]); // 8 Mapbox markers for bounding-box handles
    const resizeStateRef = useRef(null); // { handleType, anchorLat, anchorLng, startVertices, startBBox }
    const circleMetaRef = useRef(null); // { center:{lat,lng}, radiusLat, radiusLng, segments } when current shape is circle/dot
    const markersRef = useRef([]);
    const linesSourceAdded = useRef(false);
    const fillSourceAdded = useRef(false);
    const imageSourceAdded = useRef(false);
    const mapClickHandlerRef = useRef(null);
    const modalRef = useRef(null);
    const verticesRef = useRef(vertices); // always-current vertices, safe for use inside stale closures
    verticesRef.current = vertices;
    const fillColorRef = useRef(fillColor); // always-current fillColor, safe for stale closures
    fillColorRef.current = fillColor;
    const fillOpacityRef = useRef(fillOpacity); // always-current fillOpacity, safe for stale closures
    fillOpacityRef.current = fillOpacity;
    const imageOpacityRef = useRef(imageOpacity);
    imageOpacityRef.current = imageOpacity;
    const lineStyleRef = useRef(lineStyle);
    lineStyleRef.current = lineStyle;
    const saveToHistoryRef = useRef(null); // updated each render to capture latest vertices
    const handleUndoRef = useRef(null);
    const handleRedoRef = useRef(null);
    const placeHandlesRef = useRef(null); // set while resize mode is active; cleared on exit
    const [isCurveMode, setIsCurveMode] = useState(false);
    const [curveControlPoints, setCurveControlPoints] = useState({}); // key: edgeIdx, value: {lat,lng}
    const isCurveModeRef = useRef(false);
    isCurveModeRef.current = isCurveMode;
    const curveControlPointsRef = useRef({});
    curveControlPointsRef.current = curveControlPoints;
    const curveVertexCountRef = useRef((initialVertices || []).length);
    const curveMarkersRef = useRef([]); // Mapbox markers for bezier control handles
    const rebuildCurveMarkersRef = useRef(null);
    const hasAutoStartedImagePlacementRef = useRef(false);
    const imageUrlRef = useRef(isImageMode ? (initialImageUrl || '') : '');

    const imageDimensionsRef = useRef(isImageMode ? (initialImageDimensions || null) : null);

    // ── Image mode multi-slot state ──────────────────────────────
    const nextImgIdRef = useRef(isImageMode && initialImageUrl ? 2 : 1);
    const imgFileInputRef = useRef(null);
    const [imgSlots, setImgSlots] = useState(() => {
        if (isImageMode && initialImageUrl) {
            return [{ id: 1, url: initialImageUrl, file: null, name: 'Image 1', vertices: initialVertices || [] }];
        }
        return [];
    });
    const [activeImgId, setActiveImgId] = useState(() =>
        isImageMode && initialImageUrl ? 1 : null
    );
    const imgSlotsRef = useRef(imgSlots);
    imgSlotsRef.current = imgSlots;
    const activeImgIdRef = useRef(activeImgId);
    activeImgIdRef.current = activeImgId;

    const POLYGON_LINE_SOURCE = 'card-polygon-draw-line';
    const POLYGON_LINE_LAYER = 'card-polygon-draw-line-layer';
    const POLYGON_FILL_SOURCE = 'card-polygon-draw-fill';
    const POLYGON_FILL_LAYER = 'card-polygon-draw-fill-layer';
    const IMAGE_SOURCE = 'card-polygon-draw-image';
    const IMAGE_LAYER = 'card-polygon-draw-image-layer';

    // Update line style on map when lineStyle changes
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (isImageMode) return;
        if (!map || !map.getLayer(POLYGON_LINE_LAYER)) return;
        const dash = LINE_STYLES[lineStyle] || [];
        map.setPaintProperty(POLYGON_LINE_LAYER, 'line-dasharray', dash.length ? dash : undefined);
    }, [lineStyle, isImageMode]);

    // Update fill color on map when fillColor changes
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (isImageMode) return;
        if (!map) return;
        const activeColor = fillColor || DEFAULT_POLYGON_COLOR;
        if (map.getLayer(POLYGON_LINE_LAYER)) {
            map.setPaintProperty(POLYGON_LINE_LAYER, 'line-color', activeColor);
        }
        if (map.getLayer(POLYGON_FILL_LAYER)) {
            map.setPaintProperty(POLYGON_FILL_LAYER, 'fill-color', activeColor);
        }
        // Update dot colors
        markersRef.current.forEach(m => {
            const dot = m.getElement().querySelector('.polygon-draw-vertex-dot');
            if (dot) dot.style.background = activeColor;
            const lbl = m.getElement().querySelector('.polygon-draw-vertex-label');
            if (lbl) lbl.style.color = activeColor;
        });
    }, [fillColor, isImageMode]);

    // Update fill opacity on map when fillOpacity changes
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (isImageMode) return;
        if (!map || !map.getLayer(POLYGON_FILL_LAYER)) return;
        map.setPaintProperty(POLYGON_FILL_LAYER, 'fill-opacity', fillOpacity);
    }, [fillOpacity, isImageMode]);

    // Update raster opacity on map when imageOpacity changes
    useEffect(() => {
        if (!isImageMode) return;
        const map = window.atlasMapInstance;
        if (!map || !map.getLayer(IMAGE_LAYER)) return;
        map.setPaintProperty(IMAGE_LAYER, 'raster-opacity', imageOpacity);
    }, [imageOpacity, isImageMode]);

    // Set crosshair cursor synchronously before paint whenever drawing mode is active.
    // useLayoutEffect runs before the browser paints, preventing the default 'grab'
    // cursor (from Mapbox's CSS) from briefly appearing when the modal first opens.
    useLayoutEffect(() => {
        const map = window.atlasMapInstance;
        if (!map || !isDrawing) return;
        map.getCanvas().style.cursor = 'crosshair';
    }, [isDrawing]);

    const updatePolygonOnMap = useCallback((verts) => {
        const map = window.atlasMapInstance;
        if (!map) return;

        const useCurve = !isImageMode && isCurveModeRef.current && verts.length >= 3;
        const lineCoords = useCurve
            ? buildBezierCoords(verts, curveControlPointsRef.current)
            : verts.map(v => [v.lng, v.lat]);
        if (!useCurve && lineCoords.length >= minimumVertexCount) lineCoords.push(lineCoords[0]);

        // Update line
        if (linesSourceAdded.current) {
            const src = map.getSource(POLYGON_LINE_SOURCE);
            if (src) {
                src.setData(
                    lineCoords.length >= 2
                        ? {
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                                coordinates: lineCoords
                            }
                        }
                        : { type: 'FeatureCollection', features: [] }
                );
            }
        }

        // Update fill (only if >= 3 points)
        if (!isImageMode && fillSourceAdded.current) {
            const src = map.getSource(POLYGON_FILL_SOURCE);
            if (src) {
                if (verts.length >= 3) {
                    const fillCoords = useCurve
                        ? buildBezierCoords(verts, curveControlPointsRef.current)
                        : [...verts.map(v => [v.lng, v.lat]), [verts[0].lng, verts[0].lat]];
                    src.setData({
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [fillCoords] }
                    });
                } else {
                    src.setData({ type: 'FeatureCollection', features: [] });
                }
            }
        }

        if (isImageMode) {
            const imageCoords = verts.slice(0, 4).map(v => [v.lng, v.lat]);
            if (imageCoords.length >= 4 && imageUrlRef.current) {
                if (!map.getSource(IMAGE_SOURCE)) {
                    map.addSource(IMAGE_SOURCE, {
                        type: 'image',
                        url: imageUrlRef.current,
                        coordinates: imageCoords
                    });
                    imageSourceAdded.current = true;
                } else {
                    const imageSource = map.getSource(IMAGE_SOURCE);
                    if (typeof imageSource.setCoordinates === 'function') {
                        imageSource.setCoordinates(imageCoords);
                    } else if (typeof imageSource.updateImage === 'function') {
                        imageSource.updateImage({ url: imageUrlRef.current, coordinates: imageCoords });
                    }
                }

                if (!map.getLayer(IMAGE_LAYER)) {
                    map.addLayer({
                        id: IMAGE_LAYER,
                        type: 'raster',
                        source: IMAGE_SOURCE,
                        paint: {
                            'raster-opacity': imageOpacityRef.current,
                            'raster-fade-duration': 0
                        }
                    });
                }
            } else if (map.getLayer(IMAGE_LAYER) || map.getSource(IMAGE_SOURCE)) {
                if (map.getLayer(IMAGE_LAYER)) map.removeLayer(IMAGE_LAYER);
                if (map.getSource(IMAGE_SOURCE)) map.removeSource(IMAGE_SOURCE);
                imageSourceAdded.current = false;
            }
        }
    }, [isImageMode, minimumVertexCount]);

    const syncCurveGeometry = useCallback((verts, options = {}) => {
        const { forceReset = false, rebuildHandles = false } = options;
        const vertexCountChanged = curveVertexCountRef.current !== verts.length;

        if (isImageMode) {
            if (rebuildHandles) {
                curveMarkersRef.current.forEach(m => m.remove());
                curveMarkersRef.current = [];
            }
            return {};
        }

        if (verts.length < 3) {
            curveVertexCountRef.current = verts.length;
            if (Object.keys(curveControlPointsRef.current).length > 0) {
                curveControlPointsRef.current = {};
                setCurveControlPoints({});
            }
            if (rebuildHandles) {
                curveMarkersRef.current.forEach(m => m.remove());
                curveMarkersRef.current = [];
            }
            return {};
        }

        const shouldReset = forceReset || vertexCountChanged;
        const nextCtrlPts = {};
        for (let i = 0; i < verts.length; i++) {
            const defaultCtrl = getDefaultCurveControlPoint(verts, i);
            nextCtrlPts[i] = shouldReset
                ? defaultCtrl
                : (curveControlPointsRef.current[i] ?? defaultCtrl);
        }

        curveVertexCountRef.current = verts.length;
        curveControlPointsRef.current = nextCtrlPts;
        setCurveControlPoints(nextCtrlPts);

        if (rebuildHandles && isCurveModeRef.current) {
            rebuildCurveMarkersRef.current?.(verts, nextCtrlPts);
        }

        return nextCtrlPts;
    }, [isImageMode]);

    const createDraggableMarker = useCallback((vertex, index, currentVertices) => {
        const map = window.atlasMapInstance;
        if (!map) return null;

        const el = document.createElement('div');
        el.className = 'polygon-draw-vertex-marker';

        const dot = document.createElement('div');
        dot.className = 'polygon-draw-vertex-dot';
        el.appendChild(dot);

        const label = document.createElement('span');
        label.className = 'polygon-draw-vertex-label';
        label.textContent = String(index + 1);
        el.appendChild(label);

        const marker = new mapboxgl.Marker({
            element: el,
            draggable: true,
            anchor: 'center'
        })
            .setLngLat([vertex.lng, vertex.lat])
            .addTo(map);

        marker.on('dragstart', () => { saveToHistoryRef.current?.(); });
        marker.on('dragend', () => {
            const lngLat = marker.getLngLat();
            setVertices(prev => {
                const updated = [...prev];
                updated[index] = { lat: parseFloat(lngLat.lat.toFixed(6)), lng: parseFloat(lngLat.lng.toFixed(6)) };
                updatePolygonOnMap(updated);
                return updated;
            });
        });

        marker.on('drag', () => {
            const lngLat = marker.getLngLat();
            setVertices(prev => {
                const updated = [...prev];
                updated[index] = { lat: parseFloat(lngLat.lat.toFixed(6)), lng: parseFloat(lngLat.lng.toFixed(6)) };
                updatePolygonOnMap(updated);
                return updated;
            });
        });

        return marker;
    }, [updatePolygonOnMap]);

    const rebuildMarkers = useCallback((verts) => {
        // Remove old markers
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        if (isImageMode) {
            if (verts.length < 4) return;
            const map = window.atlasMapInstance;
            if (!map) return;
            const lats = verts.map(v => v.lat);
            const lngs = verts.map(v => v.lng);
            const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
            const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
            circleMetaRef.current = { center: { lat: cLat, lng: cLng } };
            const el = document.createElement('div');
            el.className = 'polygon-draw-vertex-marker polygon-draw-image-center-hidden';
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            const dot = document.createElement('div');
            dot.className = 'polygon-draw-vertex-dot';
            el.appendChild(dot);
            let dragStartPos, dragStartVerts;
            const marker = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'center' })
                .setLngLat([cLng, cLat])
                .addTo(map);
            marker.on('dragstart', () => {
                saveToHistoryRef.current?.();
                dragStartPos = marker.getLngLat();
                dragStartVerts = [...verticesRef.current];
            });
            marker.on('drag', () => {
                const pos = marker.getLngLat();
                const dLat = pos.lat - dragStartPos.lat;
                const dLng = pos.lng - dragStartPos.lng;
                const newVerts = dragStartVerts.map(v => ({
                    lat: parseFloat((v.lat + dLat).toFixed(6)),
                    lng: parseFloat((v.lng + dLng).toFixed(6)),
                }));
                circleMetaRef.current = { center: { lat: pos.lat, lng: pos.lng } };
                setVertices(newVerts);
                updatePolygonOnMap(newVerts);
            });
            marker.on('dragend', () => {
                const pos = marker.getLngLat();
                const dLat = pos.lat - dragStartPos.lat;
                const dLng = pos.lng - dragStartPos.lng;
                const newVerts = dragStartVerts.map(v => ({
                    lat: parseFloat((v.lat + dLat).toFixed(6)),
                    lng: parseFloat((v.lng + dLng).toFixed(6)),
                }));
                circleMetaRef.current = { center: { lat: pos.lat, lng: pos.lng } };
                setVertices(newVerts);
                updatePolygonOnMap(newVerts);
            });
            markersRef.current.push(marker);
            return;
        }

        // Create new markers
        verts.forEach((v, i) => {
            const marker = createDraggableMarker(v, i, verts);
            if (marker) markersRef.current.push(marker);
        });
    }, [createDraggableMarker, isImageMode, updatePolygonOnMap]);

    const rebuildCurveMarkers = useCallback((verts, ctrlPts) => {
        const map = window.atlasMapInstance;
        if (!map) return;
        curveMarkersRef.current.forEach(m => m.remove());
        curveMarkersRef.current = [];
        if (!isCurveModeRef.current || verts.length < 3) return;
        const n = verts.length;
        for (let i = 0; i < n; i++) {
            const curvePoint = getCurvePointAtHalf(verts, ctrlPts, i);
            const el = document.createElement('div');
            el.className = 'polygon-draw-curve-handle';
            const edgeIdx = i;
            const marker = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'center' })
                .setLngLat([curvePoint.lng, curvePoint.lat])
                .addTo(map);
            marker.on('dragstart', () => { saveToHistoryRef.current?.(); });
            marker.on('drag', () => {
                const pos = marker.getLngLat();
                const updated = {
                    ...curveControlPointsRef.current,
                    [edgeIdx]: getControlPointFromCurvePoint(verts, edgeIdx, { lat: pos.lat, lng: pos.lng })
                };
                curveControlPointsRef.current = updated;
                setCurveControlPoints(updated);
                updatePolygonOnMap(verticesRef.current);
            });
            curveMarkersRef.current.push(marker);
        }
    }, [updatePolygonOnMap]);
    rebuildCurveMarkersRef.current = rebuildCurveMarkers;

    // Toggle label visibility on markers when drawing state changes
    const updateMarkerLabels = useCallback((show) => {
        markersRef.current.forEach(m => {
            const label = m.getElement().querySelector('.polygon-draw-vertex-label');
            if (label) {
                label.style.display = show ? '' : 'none';
            }
        });
    }, []);

    // ── Undo / Redo ──
    // saveToHistoryRef.current() always captures the latest polygon geometry state via refs.
    saveToHistoryRef.current = () => {
        const snap = createHistorySnapshot(verticesRef.current, curveControlPointsRef.current, fillColorRef.current, fillOpacityRef.current, lineStyleRef.current);
        setHistory(prev => [...prev.slice(-49), snap]);
        setFuture([]);
    };

    const restoreHistorySnapshot = useCallback((snapshot) => {
        const normalized = normalizeHistorySnapshot(snapshot);
        const restoredVertices = normalized.vertices;
        const restoredCurveControlPoints = restoredVertices.length >= 3
            ? normalized.curveControlPoints
            : {};

        setVertices(restoredVertices);
        curveVertexCountRef.current = restoredVertices.length;
        curveControlPointsRef.current = cloneCurveControlPoints(restoredCurveControlPoints);
        setCurveControlPoints(curveControlPointsRef.current);
        if (normalized.fillColor) setFillColor(normalized.fillColor);
        if (normalized.fillOpacity !== undefined) setFillOpacity(normalized.fillOpacity);
        if (normalized.lineStyle) setLineStyle(normalized.lineStyle);
        updatePolygonOnMap(restoredVertices);
        rebuildMarkers(restoredVertices);
        rebuildCurveMarkers(restoredVertices, curveControlPointsRef.current);
        circleMetaRef.current = null;
        // If resize mode is active, refresh the 8 handles to match restored vertices
        if (placeHandlesRef.current) placeHandlesRef.current(restoredVertices);
    }, [updatePolygonOnMap, rebuildMarkers, rebuildCurveMarkers]);

    const handleUndo = useCallback(() => {
        if (history.length === 0) return;
        const prevSnapshot = history[history.length - 1];
        setFuture(f => [createHistorySnapshot(vertices, curveControlPointsRef.current, fillColorRef.current, fillOpacityRef.current), ...f.slice(0, 49)]);
        setHistory(h => h.slice(0, -1));
        restoreHistorySnapshot(prevSnapshot);
    }, [history, vertices, restoreHistorySnapshot]);

    const handleRedo = useCallback(() => {
        if (future.length === 0) return;
        const nextSnapshot = future[0];
        setHistory(h => [...h.slice(-49), createHistorySnapshot(vertices, curveControlPointsRef.current, fillColorRef.current, fillOpacityRef.current)]);
        setFuture(f => f.slice(1));
        restoreHistorySnapshot(nextSnapshot);
    }, [future, vertices, restoreHistorySnapshot]);

    handleUndoRef.current = handleUndo;
    handleRedoRef.current = handleRedo;

    // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
    useEffect(() => {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                handleUndoRef.current?.();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                handleRedoRef.current?.();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // ── Shape preset helpers ──
    const generateShapeVertices = useCallback((shape, center, dx, dy) => {
        // dx/dy are lng/lat offsets from center to the drag point
        // Compensate for Mercator distortion: 1° lng is visually cos(lat) × 1° lat
        const cosLat = Math.cos(center.lat * Math.PI / 180);
        const lngScale = cosLat > 0.0001 ? 1 / cosLat : 1;
        // Normalize dx to lat-equivalent units for radius computation
        const dxNorm = dx * cosLat;

        if (shape === 'triangle') {
            // Equilateral-ish triangle inscribed in the drag radius
            const r = Math.sqrt(dxNorm * dxNorm + dy * dy);
            if (r < 0.00001) return [];
            return [
                { lat: center.lat + r,        lng: center.lng },                          // top
                { lat: center.lat - r * 0.5,  lng: center.lng - r * 0.866 * lngScale },   // bottom-left
                { lat: center.lat - r * 0.5,  lng: center.lng + r * 0.866 * lngScale },   // bottom-right
            ];
        }
        if (shape === 'square') {
            const r = Math.sqrt(dxNorm * dxNorm + dy * dy);
            if (r < 0.00001) return [];
            const s = r / Math.SQRT2; // half-side so corners land on the circle
            return [
                { lat: center.lat + s, lng: center.lng - s * lngScale },
                { lat: center.lat + s, lng: center.lng + s * lngScale },
                { lat: center.lat - s, lng: center.lng + s * lngScale },
                { lat: center.lat - s, lng: center.lng - s * lngScale },
            ];
        }
        if (shape === 'rectangle') {
            const halfW = Math.abs(dx);
            const halfH = Math.abs(dy);
            if (halfW < 0.00001 && halfH < 0.00001) return [];
            return [
                { lat: center.lat + halfH, lng: center.lng - halfW },
                { lat: center.lat + halfH, lng: center.lng + halfW },
                { lat: center.lat - halfH, lng: center.lng + halfW },
                { lat: center.lat - halfH, lng: center.lng - halfW },
            ];
        }
        if (shape === 'circle') {
            const r = Math.sqrt(dxNorm * dxNorm + dy * dy);
            if (r < 0.00001) return [];
            const segments = 36;
            const verts = [];
            for (let i = 0; i < segments; i++) {
                const angle = (2 * Math.PI * i) / segments;
                verts.push({
                    lat: center.lat + r * Math.cos(angle),
                    lng: center.lng + r * Math.sin(angle) * lngScale,
                });
            }
            return verts;
        }
        if (shape === 'dot') {
            const r = Math.sqrt(dxNorm * dxNorm + dy * dy);
            // Dot uses a small fixed radius (clamp to a minimum)
            const dotR = Math.max(r, 0.0005);
            const segments = 24;
            const verts = [];
            for (let i = 0; i < segments; i++) {
                const angle = (2 * Math.PI * i) / segments;
                verts.push({
                    lat: center.lat + dotR * Math.cos(angle),
                    lng: center.lng + dotR * Math.sin(angle) * lngScale,
                });
            }
            return verts;
        }
        if (shape === 'pentagon') {
            const r = Math.sqrt(dxNorm * dxNorm + dy * dy);
            if (r < 0.00001) return [];
            return Array.from({ length: 5 }, (_, i) => {
                const angle = (2 * Math.PI * i) / 5 - Math.PI / 2;
                return { lat: center.lat + r * Math.cos(angle), lng: center.lng + r * Math.sin(angle) * lngScale };
            });
        }
        if (shape === 'hexagon') {
            const r = Math.sqrt(dxNorm * dxNorm + dy * dy);
            if (r < 0.00001) return [];
            return Array.from({ length: 6 }, (_, i) => {
                const angle = (2 * Math.PI * i) / 6 - Math.PI / 2;
                return { lat: center.lat + r * Math.cos(angle), lng: center.lng + r * Math.sin(angle) * lngScale };
            });
        }
        return [];
    }, []);

    // ── Whole-polygon drag mode ──
    const stopDragMode = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) return;
        if (dragHandlersRef.current) {
            map.off('mousedown', dragHandlersRef.current.onMouseDown);
            map.off('mousemove', dragHandlersRef.current.onMouseMove);
            map.off('mouseup', dragHandlersRef.current.onMouseUp);
            dragHandlersRef.current = null;
        }
        dragRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        // Re-enable individual vertex dragging
        markersRef.current.forEach(m => m.setDraggable(true));
    }, []);

    const startDragMode = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) return;

        // Disable vertex click handler
        if (mapClickHandlerRef.current) {
            map.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
        }
        setIsDrawing(false);

        // Disable individual vertex dragging while in drag mode
        markersRef.current.forEach(m => m.setDraggable(false));

        map.getCanvas().style.cursor = 'grab';

        const onMouseDown = (e) => {
            e.preventDefault();
            const { lat, lng } = e.lngLat;
            saveToHistoryRef.current?.();
            setVertices(currentVerts => {
                dragRef.current = { origin: { lat, lng }, startVertices: currentVerts.map(v => ({ ...v })) };
                return currentVerts;
            });
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
        };

        const onMouseMove = (e) => {
            if (!dragRef.current) return;
            const { origin, startVertices } = dragRef.current;
            const dLat = e.lngLat.lat - origin.lat;
            const dLng = e.lngLat.lng - origin.lng;
            const moved = startVertices.map(v => ({
                lat: parseFloat((v.lat + dLat).toFixed(6)),
                lng: parseFloat((v.lng + dLng).toFixed(6)),
            }));
            syncCurveGeometry(moved, { rebuildHandles: isCurveModeRef.current && !isImageMode });
            updatePolygonOnMap(moved);
            if (isImageMode && circleMetaRef.current && markersRef.current.length === 1) {
                const rLats = moved.map(v => v.lat);
                const rLngs = moved.map(v => v.lng);
                const cLat = (Math.min(...rLats) + Math.max(...rLats)) / 2;
                const cLng = (Math.min(...rLngs) + Math.max(...rLngs)) / 2;
                circleMetaRef.current = { center: { lat: cLat, lng: cLng } };
                markersRef.current[0].setLngLat([cLng, cLat]);
            } else {
                moved.forEach((v, i) => {
                    if (markersRef.current[i]) {
                        markersRef.current[i].setLngLat([v.lng, v.lat]);
                    }
                });
            }
        };

        const onMouseUp = (e) => {
            if (!dragRef.current) return;
            const { origin, startVertices } = dragRef.current;
            const dLat = e.lngLat.lat - origin.lat;
            const dLng = e.lngLat.lng - origin.lng;
            const moved = startVertices.map(v => ({
                lat: parseFloat((v.lat + dLat).toFixed(6)),
                lng: parseFloat((v.lng + dLng).toFixed(6)),
            }));
            dragRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = 'grab';
            syncCurveGeometry(moved, { rebuildHandles: isCurveModeRef.current && !isImageMode });
            setVertices(moved);
            updatePolygonOnMap(moved);
            if (isImageMode && circleMetaRef.current && markersRef.current.length === 1) {
                const rLats = moved.map(v => v.lat);
                const rLngs = moved.map(v => v.lng);
                const cLat = (Math.min(...rLats) + Math.max(...rLats)) / 2;
                const cLng = (Math.min(...rLngs) + Math.max(...rLngs)) / 2;
                circleMetaRef.current = { center: { lat: cLat, lng: cLng } };
                markersRef.current[0].setLngLat([cLng, cLat]);
            } else {
                moved.forEach((v, i) => {
                    if (markersRef.current[i]) {
                        markersRef.current[i].setLngLat([v.lng, v.lat]);
                    }
                });
            }
        };

        dragHandlersRef.current = { onMouseDown, onMouseMove, onMouseUp };
        map.on('mousedown', onMouseDown);
        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);
    }, [updatePolygonOnMap, syncCurveGeometry, isImageMode]);

    // ── Whole-polygon rotate mode ──
    const stopRotateMode = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) return;
        if (rotateHandlersRef.current) {
            map.off('mousedown', rotateHandlersRef.current.onMouseDown);
            map.off('mousemove', rotateHandlersRef.current.onMouseMove);
            map.off('mouseup', rotateHandlersRef.current.onMouseUp);
            rotateHandlersRef.current = null;
        }
        rotateRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        markersRef.current.forEach(m => m.setDraggable(true));
    }, []);

    const startRotateMode = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) return;

        if (mapClickHandlerRef.current) {
            map.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
        }
        setIsDrawing(false);
        markersRef.current.forEach(m => m.setDraggable(false));
        map.getCanvas().style.cursor = 'grab';

        const onMouseDown = (e) => {
            e.preventDefault();
            const { lat, lng } = e.lngLat;
            saveToHistoryRef.current?.();
            setVertices(currentVerts => {
                const cx = currentVerts.reduce((s, v) => s + v.lng, 0) / currentVerts.length;
                const cy = currentVerts.reduce((s, v) => s + v.lat, 0) / currentVerts.length;
                const startAngle = Math.atan2(lat - cy, lng - cx);
                rotateRef.current = {
                    startAngle,
                    centroid: { lat: cy, lng: cx },
                    startVertices: currentVerts.map(v => ({ ...v })),
                };
                return currentVerts;
            });
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
        };

        const rotateVertices = (startVerts, centroid, angle) => {
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const cosLat = Math.cos(centroid.lat * Math.PI / 180);
            return startVerts.map(v => {
                const dx = (v.lng - centroid.lng) * cosLat;
                const dy = v.lat - centroid.lat;
                return {
                    lng: parseFloat((centroid.lng + (dx * cosA - dy * sinA) / cosLat).toFixed(6)),
                    lat: parseFloat((centroid.lat + dx * sinA + dy * cosA).toFixed(6)),
                };
            });
        };

        const onMouseMove = (e) => {
            if (!rotateRef.current) return;
            const { startAngle, centroid, startVertices } = rotateRef.current;
            const curAngle = Math.atan2(e.lngLat.lat - centroid.lat, e.lngLat.lng - centroid.lng);
            const delta = curAngle - startAngle;
            const rotated = rotateVertices(startVertices, centroid, delta);
            syncCurveGeometry(rotated, { rebuildHandles: isCurveModeRef.current && !isImageMode });
            updatePolygonOnMap(rotated);
            if (isImageMode && markersRef.current.length === 1) {
                const cLat = rotated.reduce((s, v) => s + v.lat, 0) / rotated.length;
                const cLng = rotated.reduce((s, v) => s + v.lng, 0) / rotated.length;
                circleMetaRef.current = { center: { lat: cLat, lng: cLng } };
                markersRef.current[0].setLngLat([cLng, cLat]);
            } else {
                rotated.forEach((v, i) => {
                    if (markersRef.current[i]) markersRef.current[i].setLngLat([v.lng, v.lat]);
                });
            }
        };

        const onMouseUp = (e) => {
            if (!rotateRef.current) return;
            const { startAngle, centroid, startVertices } = rotateRef.current;
            const curAngle = Math.atan2(e.lngLat.lat - centroid.lat, e.lngLat.lng - centroid.lng);
            const delta = curAngle - startAngle;
            const rotated = rotateVertices(startVertices, centroid, delta);
            rotateRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = 'grab';
            syncCurveGeometry(rotated, { rebuildHandles: isCurveModeRef.current && !isImageMode });
            setVertices(rotated);
            updatePolygonOnMap(rotated);
            if (isImageMode && markersRef.current.length === 1) {
                const cLat = rotated.reduce((s, v) => s + v.lat, 0) / rotated.length;
                const cLng = rotated.reduce((s, v) => s + v.lng, 0) / rotated.length;
                circleMetaRef.current = { center: { lat: cLat, lng: cLng } };
                markersRef.current[0].setLngLat([cLng, cLat]);
            } else {
                rotated.forEach((v, i) => {
                    if (markersRef.current[i]) markersRef.current[i].setLngLat([v.lng, v.lat]);
                });
            }
        };

        rotateHandlersRef.current = { onMouseDown, onMouseMove, onMouseUp };
        map.on('mousedown', onMouseDown);
        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);
    }, [updatePolygonOnMap, syncCurveGeometry, isImageMode]);

    // ── Bounding-box resize mode ──
    const stopResizeMode = useCallback(() => {
        resizeHandlesRef.current.forEach(m => m.remove());
        resizeHandlesRef.current = [];
        resizeStateRef.current = null;
        placeHandlesRef.current = null;
        markersRef.current.forEach(m => m.setDraggable(true));
    }, []);

    const startResizeMode = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) return;

        if (mapClickHandlerRef.current) {
            map.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
        }
        setIsDrawing(false);
        markersRef.current.forEach(m => m.setDraggable(false));

        // Compute bounding box
        const buildBBox = (verts) => {
            const lats = verts.map(v => v.lat);
            const lngs = verts.map(v => v.lng);
            return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
        };

        const computeHandles = (bbox) => {
            const { minLat, maxLat, minLng, maxLng } = bbox;
            const midLat = (minLat + maxLat) / 2;
            const midLng = (minLng + maxLng) / 2;
            return [
                // corners: type, lat, lng, cursor
                { type: 'corner-tl', lat: maxLat, lng: minLng, cursor: 'nwse-resize' },
                { type: 'corner-tr', lat: maxLat, lng: maxLng, cursor: 'nesw-resize' },
                { type: 'corner-br', lat: minLat, lng: maxLng, cursor: 'nwse-resize' },
                { type: 'corner-bl', lat: minLat, lng: minLng, cursor: 'nesw-resize' },
                // edges: top, right, bottom, left
                { type: 'edge-t', lat: maxLat, lng: midLng, cursor: 'ns-resize' },
                { type: 'edge-r', lat: midLat, lng: maxLng, cursor: 'ew-resize' },
                { type: 'edge-b', lat: minLat, lng: midLng, cursor: 'ns-resize' },
                { type: 'edge-l', lat: midLat, lng: minLng, cursor: 'ew-resize' },
            ];
        };

        const applyResize = (startVerts, startBBox, handleType, newLat, newLng) => {
            const { minLat, maxLat, minLng, maxLng } = startBBox;

            // Corner drag → uniform scale (preserve shape) with cos(lat) compensation
            if (handleType.startsWith('corner')) {
                // Determine anchor (opposite corner) and original corner
                let anchorLat, anchorLng, origLat, origLng;
                if (handleType === 'corner-tl') { anchorLat = minLat; anchorLng = maxLng; origLat = maxLat; origLng = minLng; }
                else if (handleType === 'corner-tr') { anchorLat = minLat; anchorLng = minLng; origLat = maxLat; origLng = maxLng; }
                else if (handleType === 'corner-br') { anchorLat = maxLat; anchorLng = minLng; origLat = minLat; origLng = maxLng; }
                else { /* corner-bl */ anchorLat = maxLat; anchorLng = maxLng; origLat = minLat; origLng = minLng; }

                const centerLat = (minLat + maxLat) / 2;
                const cosLat = Math.cos(centerLat * Math.PI / 180);
                const oDx = (origLng - anchorLng) * cosLat;
                const oDy = origLat - anchorLat;
                const origDist = Math.sqrt(oDx * oDx + oDy * oDy);
                const nDx = (newLng - anchorLng) * cosLat;
                const nDy = newLat - anchorLat;
                const newDist = Math.sqrt(nDx * nDx + nDy * nDy);
                const s = origDist > 1e-9 ? newDist / origDist : 1;

                return startVerts.map(v => ({
                    lng: parseFloat((anchorLng + (v.lng - anchorLng) * s).toFixed(6)),
                    lat: parseFloat((anchorLat + (v.lat - anchorLat) * s).toFixed(6)),
                }));
            }

            // Edge drag → stretch single axis
            let nMinLat = minLat, nMaxLat = maxLat, nMinLng = minLng, nMaxLng = maxLng;
            if (handleType === 'edge-t') { nMaxLat = newLat; }
            else if (handleType === 'edge-b') { nMinLat = newLat; }
            else if (handleType === 'edge-r') { nMaxLng = newLng; }
            else if (handleType === 'edge-l') { nMinLng = newLng; }

            const oW = maxLng - minLng;
            const oH = maxLat - minLat;
            const nW = nMaxLng - nMinLng;
            const nH = nMaxLat - nMinLat;
            const sX = oW > 1e-9 ? nW / oW : 1;
            const sY = oH > 1e-9 ? nH / oH : 1;

            return startVerts.map(v => ({
                lng: parseFloat((nMinLng + (v.lng - minLng) * sX).toFixed(6)),
                lat: parseFloat((nMinLat + (v.lat - minLat) * sY).toFixed(6)),
            }));
        };

        const placeHandles = (verts) => {
            // Remove old handles
            resizeHandlesRef.current.forEach(m => m.remove());
            resizeHandlesRef.current = [];

            const bbox = buildBBox(verts);
            const handles = computeHandles(bbox);

            handles.forEach(h => {
                const el = document.createElement('div');
                el.className = 'polygon-draw-resize-handle';
                if (h.type.startsWith('corner')) el.classList.add('polygon-draw-resize-handle-corner');
                else el.classList.add('polygon-draw-resize-handle-edge');
                el.style.cursor = h.cursor;

                const marker = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'center' })
                    .setLngLat([h.lng, h.lat])
                    .addTo(map);

                marker._resizeType = h.type;

                marker.on('dragstart', () => {
                    saveToHistoryRef.current?.();
                    setVertices(currentVerts => {
                        resizeStateRef.current = {
                            handleType: h.type,
                            startVertices: currentVerts.map(v => ({ ...v })),
                            startBBox: buildBBox(currentVerts),
                        };
                        return currentVerts;
                    });
                });

                marker.on('drag', () => {
                    if (!resizeStateRef.current) return;
                    const { handleType, startVertices, startBBox } = resizeStateRef.current;
                    const pos = marker.getLngLat();
                    const resized = applyResize(startVertices, startBBox, handleType, pos.lat, pos.lng);
                    syncCurveGeometry(resized, { rebuildHandles: isCurveModeRef.current && !isImageMode });
                    updatePolygonOnMap(resized);
                    // For circle/dot: update center marker position
                    if (circleMetaRef.current && markersRef.current.length === 1) {
                        const rLats = resized.map(v => v.lat);
                        const rLngs = resized.map(v => v.lng);
                        const cLat = (Math.min(...rLats) + Math.max(...rLats)) / 2;
                        const cLng = (Math.min(...rLngs) + Math.max(...rLngs)) / 2;
                        markersRef.current[0].setLngLat([cLng, cLat]);
                    } else {
                        resized.forEach((v, i) => {
                            if (markersRef.current[i]) markersRef.current[i].setLngLat([v.lng, v.lat]);
                        });
                    }
                    // Update other handle positions
                    const newBBox = buildBBox(resized);
                    const newPositions = computeHandles(newBBox);
                    resizeHandlesRef.current.forEach(rm => {
                        if (rm === marker) return;
                        const np = newPositions.find(p => p.type === rm._resizeType);
                        if (np) rm.setLngLat([np.lng, np.lat]);
                    });
                });

                marker.on('dragend', () => {
                    if (!resizeStateRef.current) return;
                    const { handleType, startVertices, startBBox } = resizeStateRef.current;
                    const pos = marker.getLngLat();
                    const resized = applyResize(startVertices, startBBox, handleType, pos.lat, pos.lng);
                    resizeStateRef.current = null;
                    syncCurveGeometry(resized, { rebuildHandles: isCurveModeRef.current && !isImageMode });
                    setVertices(resized);
                    updatePolygonOnMap(resized);
                    // For circle/dot: update center marker and metadata
                    if (circleMetaRef.current) {
                        const rLats = resized.map(v => v.lat);
                        const rLngs = resized.map(v => v.lng);
                        const cLat = (Math.min(...rLats) + Math.max(...rLats)) / 2;
                        const cLng = (Math.min(...rLngs) + Math.max(...rLngs)) / 2;
                        circleMetaRef.current = {
                            ...circleMetaRef.current,
                            center: { lat: cLat, lng: cLng },
                            radiusLat: (Math.max(...rLats) - Math.min(...rLats)) / 2,
                            radiusLng: (Math.max(...rLngs) - Math.min(...rLngs)) / 2,
                        };
                        if (markersRef.current.length === 1) {
                            markersRef.current[0].setLngLat([cLng, cLat]);
                        }
                    } else {
                        resized.forEach((v, i) => {
                            if (markersRef.current[i]) markersRef.current[i].setLngLat([v.lng, v.lat]);
                        });
                    }
                    // Rebuild all handles at final bbox positions (ensures clean drag state for next resize)
                    placeHandles(resized);
                });

                resizeHandlesRef.current.push(marker);
            });
        };

        setVertices(currentVerts => {
            placeHandles(currentVerts);
            return currentVerts;
        });
        placeHandlesRef.current = placeHandles;
    }, [updatePolygonOnMap, syncCurveGeometry, isImageMode]);

    const handleToggleDragMode = useCallback(() => {
        // Exit rotate/resize mode if active
        if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
        if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
        setIsDragMode(prev => {
            if (!prev) {
                startDragMode();
            } else {
                stopDragMode();
            }
            return !prev;
        });
    }, [startDragMode, stopDragMode, isRotateMode, stopRotateMode, isResizeMode, stopResizeMode]);

    const handleToggleRotateMode = useCallback(() => {
        setIsRotateMode(prev => {
            if (!prev) {
                if (isDragMode) { stopDragMode(); setIsDragMode(false); }
                if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
                startRotateMode();
            } else {
                stopRotateMode();
            }
            return !prev;
        });
    }, [startRotateMode, stopRotateMode, isDragMode, stopDragMode, isResizeMode, stopResizeMode]);

    const handleToggleResizeMode = useCallback(() => {
        setIsResizeMode(prev => {
            if (!prev) {
                if (isDragMode) { stopDragMode(); setIsDragMode(false); }
                if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
                startResizeMode();
            } else {
                stopResizeMode();
            }
            return !prev;
        });
    }, [startResizeMode, stopResizeMode, isDragMode, stopDragMode, isRotateMode, stopRotateMode]);

    // Clean up drag/rotate/resize mode on unmount
    useEffect(() => {
        return () => {
            stopDragMode();
            stopRotateMode();
            stopResizeMode();
            curveMarkersRef.current.forEach(m => m.remove());
            curveMarkersRef.current = [];
        };
    }, [stopDragMode, stopRotateMode, stopResizeMode]);

    // Rebuild curve markers and re-render when curve mode toggles
    useEffect(() => {
        if (isCurveMode) {
            syncCurveGeometry(verticesRef.current, { forceReset: curveVertexCountRef.current !== verticesRef.current.length });
            rebuildCurveMarkers(verticesRef.current, curveControlPointsRef.current);
        } else {
            curveMarkersRef.current.forEach(m => m.remove());
            curveMarkersRef.current = [];
        }
        updatePolygonOnMap(verticesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCurveMode, syncCurveGeometry, rebuildCurveMarkers, updatePolygonOnMap]);

    // Click-to-place for image mode (single click, aspect-ratio-aware)
    const startImageClickPlacement = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) return;
        if (isDragMode) { stopDragMode(); setIsDragMode(false); }
        if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
        if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
        if (mapClickHandlerRef.current) {
            map.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
        }
        setIsDrawing(true);
        setShowShapeMenu(false);
        map.getCanvas().style.cursor = 'crosshair';

        const onMapClick = (e) => {
            const { lat, lng } = e.lngLat;
            const bounds = map.getBounds();
            const viewLngSpan = bounds.getEast() - bounds.getWest();
            const halfW = viewLngSpan * 0.2;
            const dims = imageDimensionsRef.current;
            const aspect = dims && dims.height > 0 ? dims.width / dims.height : 1;
            const cosLat = Math.cos(lat * Math.PI / 180) || 1;
            const halfH = (halfW * cosLat) / aspect;
            const finalVerts = [
                { lat: parseFloat((lat + halfH).toFixed(6)), lng: parseFloat((lng - halfW).toFixed(6)) },
                { lat: parseFloat((lat + halfH).toFixed(6)), lng: parseFloat((lng + halfW).toFixed(6)) },
                { lat: parseFloat((lat - halfH).toFixed(6)), lng: parseFloat((lng + halfW).toFixed(6)) },
                { lat: parseFloat((lat - halfH).toFixed(6)), lng: parseFloat((lng - halfW).toFixed(6)) },
            ];
            map.off('click', onMapClick);
            mapClickHandlerRef.current = null;
            map.getCanvas().style.cursor = '';
            saveToHistoryRef.current?.();
            setVertices(finalVerts);
            syncCurveGeometry(finalVerts, { forceReset: true });
            updatePolygonOnMap(finalVerts);
            rebuildMarkers(finalVerts);
            setIsDrawing(false);
        };
        mapClickHandlerRef.current = onMapClick;
        map.on('click', onMapClick);
    }, [isDragMode, stopDragMode, isRotateMode, stopRotateMode, isResizeMode, stopResizeMode, syncCurveGeometry, updatePolygonOnMap, rebuildMarkers]);

    // Start shape placement mode
    const startShapePlacement = useCallback((shape) => {
        // Exit drag mode if active
        if (isDragMode) { stopDragMode(); setIsDragMode(false); }
        if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
        if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
        const map = window.atlasMapInstance;
        if (!map) return;

        // Disable normal vertex-click while placing shape
        if (mapClickHandlerRef.current) {
            map.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
        }

        setActiveShape(shape);
        setShowShapeMenu(false);
        map.getCanvas().style.cursor = 'crosshair';

        const onMouseDown = (e) => {
            e.preventDefault();
            const { lat, lng } = e.lngLat;
            shapePlacingRef.current = { shape, origin: { lat, lng }, active: true };
            map.getCanvas().style.cursor = 'nwse-resize';

            // Prevent map panning while dragging
            map.dragPan.disable();
        };

        const onMouseMove = (e) => {
            if (!shapePlacingRef.current?.active) return;
            const { origin } = shapePlacingRef.current;
            const dx = e.lngLat.lng - origin.lng;
            const dy = e.lngLat.lat - origin.lat;
            const preview = generateShapeVertices(shapePlacingRef.current.shape, origin, dx, dy);
            if (preview.length >= 3) {
                updatePolygonOnMap(preview);
            }
        };

        const onMouseUp = (e) => {
            if (!shapePlacingRef.current?.active) return;
            const { origin } = shapePlacingRef.current;
            const dx = e.lngLat.lng - origin.lng;
            const dy = e.lngLat.lat - origin.lat;
            const finalVerts = generateShapeVertices(shapePlacingRef.current.shape, origin, dx, dy);

            // Re-enable map panning
            map.dragPan.enable();
            shapePlacingRef.current = null;

            // Clean up listeners
            map.off('mousedown', onMouseDown);
            map.off('mousemove', onMouseMove);
            map.off('mouseup', onMouseUp);

            if (finalVerts.length >= 3) {
                saveToHistoryRef.current?.();
                // Round vertices
                const rounded = finalVerts.map(v => ({
                    lat: parseFloat(v.lat.toFixed(6)),
                    lng: parseFloat(v.lng.toFixed(6)),
                }));
                setVertices(rounded);
                syncCurveGeometry(rounded, { forceReset: true });
                updatePolygonOnMap(rounded);
                // For circle/dot: store metadata and show only a center marker
                const placedShape = shape;
                if (placedShape === 'circle' || placedShape === 'dot') {
                    // Compute circle metadata from the placed vertices
                    const lats = rounded.map(v => v.lat);
                    const lngs = rounded.map(v => v.lng);
                    const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
                    const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
                    circleMetaRef.current = {
                        center: { lat: cLat, lng: cLng },
                        radiusLat: (Math.max(...lats) - Math.min(...lats)) / 2,
                        radiusLng: (Math.max(...lngs) - Math.min(...lngs)) / 2,
                        segments: rounded.length,
                    };
                    // Show single center marker
                    markersRef.current.forEach(m => m.remove());
                    markersRef.current = [];
                    const el = document.createElement('div');
                    el.className = 'polygon-draw-vertex-marker';
                    const dot = document.createElement('div');
                    dot.className = 'polygon-draw-vertex-dot';
                    el.appendChild(dot);
                    const label = document.createElement('span');
                    label.className = 'polygon-draw-vertex-label';
                    label.textContent = '●';
                    label.style.display = 'none';
                    el.appendChild(label);
                    const centerMarker = new mapboxgl.Marker({ element: el, draggable: false, anchor: 'center' })
                        .setLngLat([cLng, cLat])
                        .addTo(window.atlasMapInstance);
                    markersRef.current.push(centerMarker);
                } else {
                    circleMetaRef.current = null;
                    rebuildMarkers(rounded);
                    rebuildCurveMarkers(rounded, curveControlPointsRef.current);
                }
                setIsDrawing(false);
                updateMarkerLabels(false);
            }
            setActiveShape(null);
            map.getCanvas().style.cursor = '';
        };

        map.on('mousedown', onMouseDown);
        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);
    }, [generateShapeVertices, updatePolygonOnMap, rebuildMarkers, rebuildCurveMarkers, syncCurveGeometry, updateMarkerLabels, isDragMode, stopDragMode, isRotateMode, stopRotateMode, isResizeMode, stopResizeMode]);

    // Clear all drawn vertices and shapes
    const handleClearAll = useCallback(() => {
        saveToHistoryRef.current?.();
        // Exit drag/rotate mode if active
        if (isDragMode) { stopDragMode(); setIsDragMode(false); }
        if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
        if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
        setVertices([]);
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
        curveMarkersRef.current.forEach(m => m.remove());
        curveMarkersRef.current = [];
        setCurveControlPoints({});
        curveControlPointsRef.current = {};
        curveVertexCountRef.current = 0;
        circleMetaRef.current = null;
        updatePolygonOnMap([]);
        setIsDrawing(!isImageMode);

        if (isImageMode) {
            // Clear the active slot's placement only
            setImgSlots(prev => prev.map(s =>
                s.id === activeImgIdRef.current ? { ...s, vertices: [] } : s
            ));
            updatePolygonOnMap([]);
            if (imageUrlRef.current) startImageClickPlacement();
            return;
        }

        // Re-attach click handler if not already present
        const map = window.atlasMapInstance;
        if (map && !mapClickHandlerRef.current) {
            const handleMapClick = (e) => {
                const { lat, lng } = e.lngLat;
                const newVertex = { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
                setVertices(prev => {
                    const updated = [...prev, newVertex];
                    syncCurveGeometry(updated, { rebuildHandles: true });
                    updatePolygonOnMap(updated);
                    rebuildMarkers(updated);
                    return updated;
                });
            };
            mapClickHandlerRef.current = handleMapClick;
            map.on('click', handleMapClick);
            map.getCanvas().style.cursor = 'crosshair';
        }
    }, [updatePolygonOnMap, isDragMode, stopDragMode, isRotateMode, stopRotateMode, isResizeMode, stopResizeMode, syncCurveGeometry, rebuildMarkers, isImageMode, startShapePlacement]);


    // Position modal flush with the draw control bar
    useEffect(() => {
        const modal = modalRef.current;
        const mapContainer = window.atlasMapInstance?.getContainer();
        if (!modal || !mapContainer) return;

        const drawGroup = mapContainer.querySelector('.mapboxgl-ctrl-top-right .mapboxgl-ctrl-group');
        if (!drawGroup) return;

        const mapRect = mapContainer.getBoundingClientRect();
        const barRect = drawGroup.getBoundingClientRect();

        modal.style.top = (barRect.top - mapRect.top) + 'px';
        modal.style.right = (mapRect.right - barRect.left) + 'px';
    }, []);

    // Initialize map layers and click handler
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map) return;

        // Add line source/layer
        if (!map.getSource(POLYGON_LINE_SOURCE)) {
            map.addSource(POLYGON_LINE_SOURCE, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            linesSourceAdded.current = true;
        }
        if (!isImageMode && !map.getLayer(POLYGON_LINE_LAYER)) {
            map.addLayer({
                id: POLYGON_LINE_LAYER,
                type: 'line',
                source: POLYGON_LINE_SOURCE,
                paint: {
                    'line-color': fillColor || DEFAULT_POLYGON_COLOR,
                    'line-width': 1.5,
                    'line-dasharray': LINE_STYLES[lineStyle] || []
                }
            });
        }

        // Add fill source/layer
        if (!isImageMode) {
            if (!map.getSource(POLYGON_FILL_SOURCE)) {
                map.addSource(POLYGON_FILL_SOURCE, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
                fillSourceAdded.current = true;
            }
            if (!map.getLayer(POLYGON_FILL_LAYER)) {
                map.addLayer({
                    id: POLYGON_FILL_LAYER,
                    type: 'fill',
                    source: POLYGON_FILL_SOURCE,
                    paint: {
                        'fill-color': fillColor || DEFAULT_POLYGON_COLOR,
                        'fill-opacity': fillOpacity
                    }
                });
            }
        }

        // Render initial vertices if provided (edit mode)
        if (initialVertices && initialVertices.length >= minimumVertexCount) {
            syncCurveGeometry(initialVertices, { forceReset: true });
            updatePolygonOnMap(initialVertices);
            rebuildMarkers(initialVertices);
            updateMarkerLabels(false); // editing mode: hide labels initially
        }

        // Click handler for adding vertices
        const handleMapClick = (e) => {
            const { lat, lng } = e.lngLat;
            const newVertex = { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };

            saveToHistoryRef.current?.();
            setVertices(prev => {
                const updated = [...prev, newVertex];
                syncCurveGeometry(updated, { rebuildHandles: true });
                updatePolygonOnMap(updated);
                rebuildMarkers(updated);
                return updated;
            });
        };

        // If editing existing polygon, start in drag/edit mode (not drawing)
        if (!isImageMode && !(initialVertices && initialVertices.length >= minimumVertexCount)) {
            mapClickHandlerRef.current = handleMapClick;
            map.on('click', handleMapClick);
            map.getCanvas().style.cursor = 'crosshair';
        }

        // Curve mode: hovering over the polygon line shows grab cursor and allows dragging to adjust curve
        const onCurveLineEnter = () => { if (isCurveModeRef.current) map.getCanvas().style.cursor = 'grab'; };
        const onCurveLineLeave = () => { if (isCurveModeRef.current && !shapePlacingRef.current) map.getCanvas().style.cursor = ''; };
        map.on('mouseenter', POLYGON_LINE_LAYER, onCurveLineEnter);
        map.on('mouseleave', POLYGON_LINE_LAYER, onCurveLineLeave);

        let curveDragCleanup = null;
        const onCurveLineMouseDown = (e) => {
            if (!isCurveModeRef.current) return;
            e.preventDefault();
            saveToHistoryRef.current?.();
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
            // Find the nearest edge midpoint to determine which control point to drag
            const verts = verticesRef.current;
            const n = verts.length;
            if (n < 3) { map.dragPan.enable(); return; }
            const clickPoint = lngLatToMercator({ lat: e.lngLat.lat, lng: e.lngLat.lng });
            let bestEdge = 0, bestDist = Infinity;
            for (let i = 0; i < n; i++) {
                const curvePoint = getCurvePointAtHalf(verts, curveControlPointsRef.current, i);
                const projectedCurvePoint = lngLatToMercator(curvePoint);
                const d = Math.hypot(clickPoint.x - projectedCurvePoint.x, clickPoint.y - projectedCurvePoint.y);
                if (d < bestDist) { bestDist = d; bestEdge = i; }
            }
            const onMove = (e2) => {
                const updated = {
                    ...curveControlPointsRef.current,
                    [bestEdge]: getControlPointFromCurvePoint(verts, bestEdge, { lat: e2.lngLat.lat, lng: e2.lngLat.lng })
                };
                curveControlPointsRef.current = updated;
                setCurveControlPoints(updated);
                updatePolygonOnMap(verticesRef.current);
                if (curveMarkersRef.current[bestEdge]) {
                    curveMarkersRef.current[bestEdge].setLngLat([e2.lngLat.lng, e2.lngLat.lat]);
                }
            };
            const onUp = () => {
                map.dragPan.enable();
                map.getCanvas().style.cursor = isCurveModeRef.current ? 'grab' : '';
                map.off('mousemove', onMove);
                map.off('mouseup', onUp);
                curveDragCleanup = null;
            };
            map.on('mousemove', onMove);
            map.on('mouseup', onUp);
            curveDragCleanup = () => { map.off('mousemove', onMove); map.off('mouseup', onUp); };
        };
        map.on('mousedown', POLYGON_LINE_LAYER, onCurveLineMouseDown);

        return () => {
            // Clean up
            if (mapClickHandlerRef.current) {
                map.off('click', mapClickHandlerRef.current);
            }
            map.off('mouseenter', POLYGON_LINE_LAYER, onCurveLineEnter);
            map.off('mouseleave', POLYGON_LINE_LAYER, onCurveLineLeave);
            map.off('mousedown', POLYGON_LINE_LAYER, onCurveLineMouseDown);
            if (curveDragCleanup) curveDragCleanup();
            map.getCanvas().style.cursor = '';

            // Cancel any in-progress shape placement
            if (shapePlacingRef.current) {
                map.dragPan.enable();
                shapePlacingRef.current = null;
            }

            // Remove markers
            markersRef.current.forEach(m => m.remove());
            markersRef.current = [];

            // Remove layers and sources
            if (map.getLayer(POLYGON_LINE_LAYER)) map.removeLayer(POLYGON_LINE_LAYER);
            if (map.getSource(POLYGON_LINE_SOURCE)) map.removeSource(POLYGON_LINE_SOURCE);
            if (map.getLayer(POLYGON_FILL_LAYER)) map.removeLayer(POLYGON_FILL_LAYER);
            if (map.getSource(POLYGON_FILL_SOURCE)) map.removeSource(POLYGON_FILL_SOURCE);
            if (map.getLayer(IMAGE_LAYER)) map.removeLayer(IMAGE_LAYER);
            if (map.getSource(IMAGE_SOURCE)) map.removeSource(IMAGE_SOURCE);
            linesSourceAdded.current = false;
            fillSourceAdded.current = false;
            imageSourceAdded.current = false;
        };
    }, [initialVertices, updateMarkerLabels, updatePolygonOnMap, rebuildMarkers, syncCurveGeometry, isImageMode, minimumVertexCount, fillColor, fillOpacity, lineStyle]); // eslint-disable-line react-hooks/exhaustive-deps
    // Note: fillColor, fillOpacity, lineStyle are intentionally excluded — they are handled by
    // their own dedicated useEffects above via setPaintProperty, so they must NOT trigger a
    // full teardown/reinit of the layer setup (which would make markers invisible).

    // Auto-start image placement when the initial slot has no vertices yet
    useEffect(() => {
        if (!isImageMode) return;
        if (imgSlots.length === 0 || activeImgId === null) return;
        const activeSlot = imgSlots.find(s => s.id === activeImgId);
        if (!activeSlot || activeSlot.vertices.length >= minimumVertexCount) return;
        if (hasAutoStartedImagePlacementRef.current) return;
        if (!imageUrlRef.current) return;

        hasAutoStartedImagePlacementRef.current = true;
        startImageClickPlacement();
    }, [isImageMode, imgSlots, activeImgId, minimumVertexCount, startImageClickPlacement]);

    // Manage static overlays for non-active placed image slots
    const prevStaticIdsRef = useRef(new Set());
    useEffect(() => {
        if (!isImageMode) return;
        const map = window.atlasMapInstance;
        if (!map) return;

        const currentIds = new Set();
        imgSlots.forEach(slot => {
            if (slot.id === activeImgId) return;
            if (slot.vertices.length < 4) return;
            currentIds.add(slot.id);
            const srcId = `place-img-static-${slot.id}`;
            const layId = `place-img-static-layer-${slot.id}`;
            const coords = slot.vertices.slice(0, 4).map(v => [v.lng, v.lat]);
            if (!map.getSource(srcId)) {
                map.addSource(srcId, { type: 'image', url: slot.url, coordinates: coords });
                map.addLayer({ id: layId, type: 'raster', source: srcId, paint: { 'raster-opacity': imageOpacityRef.current, 'raster-fade-duration': 0 } });
            }
        });

        // Remove stale sources
        prevStaticIdsRef.current.forEach(id => {
            if (!currentIds.has(id)) {
                const srcId = `place-img-static-${id}`;
                const layId = `place-img-static-layer-${id}`;
                if (map.getLayer(layId)) map.removeLayer(layId);
                if (map.getSource(srcId)) map.removeSource(srcId);
            }
        });
        prevStaticIdsRef.current = currentIds;

        return () => {
            prevStaticIdsRef.current.forEach(id => {
                const srcId = `place-img-static-${id}`;
                const layId = `place-img-static-layer-${id}`;
                if (map.getLayer(layId)) map.removeLayer(layId);
                if (map.getSource(srcId)) map.removeSource(srcId);
            });
        };
    }, [isImageMode, imgSlots, activeImgId]);

    // \u2500\u2500 Image slot management callbacks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const handleImgFileInput = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
        if (!allowed.includes((file.type || '').toLowerCase()) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name || '')) {
            alert('Supports PNG, JPG, GIF, WebP only.');
            e.target.value = '';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            alert('Image exceeds 5 MB limit.');
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const url = reader.result;
            const img = new window.Image();
            img.onload = () => {
                const dims = { width: img.naturalWidth, height: img.naturalHeight };
                const currentSlots = imgSlotsRef.current;
                const id = nextImgIdRef.current++;
                const name = `Image ${currentSlots.length + 1}`;
                // Save current vertices to the current active slot
                if (activeImgIdRef.current !== null) {
                    setImgSlots(prev => prev.map(s =>
                        s.id === activeImgIdRef.current ? { ...s, vertices: verticesRef.current } : s
                    ));
                }
                const newSlot = { id, url, file, name, vertices: [] };
                setImgSlots(prev => [...prev, newSlot]);
                setActiveImgId(id);
                imageUrlRef.current = url;
                imageDimensionsRef.current = dims;
                // Clear vertices and start new placement
                setVertices([]);
                markersRef.current.forEach(m => m.remove());
                markersRef.current = [];
                updatePolygonOnMap([]);
                startImageClickPlacement();
            };
            img.src = url;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }, [startImageClickPlacement, updatePolygonOnMap]);

    const handleSwitchImgSlot = useCallback((id) => {
        if (id === activeImgIdRef.current) return;
        // Save current vertices back to active slot
        if (activeImgIdRef.current !== null) {
            setImgSlots(prev => prev.map(s =>
                s.id === activeImgIdRef.current ? { ...s, vertices: verticesRef.current } : s
            ));
        }
        const slot = imgSlotsRef.current.find(s => s.id === id);
        if (!slot) return;
        setActiveImgId(id);
        imageUrlRef.current = slot.url;
        imageDimensionsRef.current = null;
        const newVerts = slot.vertices || [];
        setVertices(newVerts);
        updatePolygonOnMap(newVerts);
        rebuildMarkers(newVerts);
        if (isDragMode) { stopDragMode(); setIsDragMode(false); }
        if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
        if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
        if (mapClickHandlerRef.current) {
            window.atlasMapInstance?.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
            const mc = window.atlasMapInstance;
            if (mc) mc.getCanvas().style.cursor = '';
        }
        if (newVerts.length < 4) {
            startImageClickPlacement();
        } else {
            setIsDrawing(false);
        }
    }, [updatePolygonOnMap, rebuildMarkers, isDragMode, stopDragMode, isRotateMode, stopRotateMode, isResizeMode, stopResizeMode, startImageClickPlacement]);

    const handleRemoveImgSlot = useCallback((id, e) => {
        e.stopPropagation();
        const map = window.atlasMapInstance;
        // Remove static overlay if it exists
        if (map) {
            const srcId = `place-img-static-${id}`;
            const layId = `place-img-static-layer-${id}`;
            if (map.getLayer(layId)) map.removeLayer(layId);
            if (map.getSource(srcId)) map.removeSource(srcId);
            prevStaticIdsRef.current.delete(id);
        }
        const currentSlots = imgSlotsRef.current;
        const slotIdx = currentSlots.findIndex(s => s.id === id);
        if (slotIdx < 0) return;
        const newSlots = currentSlots.filter(s => s.id !== id);
        setImgSlots(newSlots);

        if (activeImgIdRef.current === id) {
            if (newSlots.length > 0) {
                const newActive = newSlots[Math.min(slotIdx, newSlots.length - 1)];
                setActiveImgId(newActive.id);
                imageUrlRef.current = newActive.url;
                imageDimensionsRef.current = null;
                const newVerts = newActive.vertices || [];
                setVertices(newVerts);
                updatePolygonOnMap(newVerts);
                rebuildMarkers(newVerts);
                if (isDragMode) { stopDragMode(); setIsDragMode(false); }
                if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
                if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
                if (mapClickHandlerRef.current) {
                    window.atlasMapInstance?.off('click', mapClickHandlerRef.current);
                    mapClickHandlerRef.current = null;
                    const mc2 = window.atlasMapInstance;
                    if (mc2) mc2.getCanvas().style.cursor = '';
                }
                if (newVerts.length < 4) {
                    startImageClickPlacement();
                } else {
                    setIsDrawing(false);
                }
            } else {
                setActiveImgId(null);
                imageUrlRef.current = '';
                setVertices([]);
                updatePolygonOnMap([]);
                markersRef.current.forEach(m => m.remove());
                markersRef.current = [];
                setIsDrawing(false);
                if (mapClickHandlerRef.current) {
                    window.atlasMapInstance?.off('click', mapClickHandlerRef.current);
                    mapClickHandlerRef.current = null;
                    const mc3 = window.atlasMapInstance;
                    if (mc3) mc3.getCanvas().style.cursor = '';
                }
            }
        }
    }, [updatePolygonOnMap, rebuildMarkers, isDragMode, stopDragMode, isRotateMode, stopRotateMode, isResizeMode, stopResizeMode, startImageClickPlacement]);

    // Stop drawing mode (finish polygon)
    const handleFinishDrawing = () => {
        const map = window.atlasMapInstance;
        if (map && mapClickHandlerRef.current) {
            map.off('click', mapClickHandlerRef.current);
            mapClickHandlerRef.current = null;
            map.getCanvas().style.cursor = '';
        }
        setIsDrawing(false);
        updateMarkerLabels(false);
    };

    // Resume drawing
    const handleResumeDrawing = () => {
        if (isImageMode) {
            startImageClickPlacement();
            return;
        }
        // Exit drag/rotate mode if active
        if (isDragMode) { stopDragMode(); setIsDragMode(false); }
        if (isRotateMode) { stopRotateMode(); setIsRotateMode(false); }
        if (isResizeMode) { stopResizeMode(); setIsResizeMode(false); }
        const map = window.atlasMapInstance;
        if (!map) return;setShowShapeMenu(false); 

        const handleMapClick = (e) => {
            const { lat, lng } = e.lngLat;
            const newVertex = { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };

            saveToHistoryRef.current?.();
            setVertices(prev => {
                const updated = [...prev, newVertex];
                syncCurveGeometry(updated, { rebuildHandles: true });
                updatePolygonOnMap(updated);
                rebuildMarkers(updated);
                return updated;
            });
        };

        mapClickHandlerRef.current = handleMapClick;
        map.on('click', handleMapClick);
        map.getCanvas().style.cursor = 'crosshair';
        setIsDrawing(true);
        updateMarkerLabels(true);
    };

    const handleRemoveVertex = (index) => {
        saveToHistoryRef.current?.();
        setVertices(prev => {
            const updated = prev.filter((_, i) => i !== index);
            syncCurveGeometry(updated, { forceReset: true, rebuildHandles: true });
            updatePolygonOnMap(updated);
            rebuildMarkers(updated);
            return updated;
        });
    };

    const handleSave = () => {
        if (isImageMode) {
            // Sync current active slot's live vertices
            const updatedSlots = imgSlotsRef.current.map(s =>
                s.id === activeImgIdRef.current ? { ...s, vertices: verticesRef.current } : s
            );
            const placedSlots = updatedSlots.filter(s => s.vertices.length >= 4);
            if (placedSlots.length === 0) {
                alert('Please add and place at least one image (click the map to position it).');
                return;
            }
            const firstVerts = placedSlots[0].vertices;
            const centroid = firstVerts.reduce(
                (acc, v) => ({ lat: acc.lat + v.lat / firstVerts.length, lng: acc.lng + v.lng / firstVerts.length }),
                { lat: 0, lng: 0 }
            );
            onSave(firstVerts, centroid, { lineStyle, fillColor, fillOpacity, imageOpacity }, placedSlots);
            return;
        }
        if (vertices.length < minimumVertexCount) {
            alert('A polygon needs at least 3 points.');
            return;
        }
        // Compute centroid for lat/lng fields
        const centroid = vertices.reduce(
            (acc, v) => ({ lat: acc.lat + v.lat / vertices.length, lng: acc.lng + v.lng / vertices.length }),
            { lat: 0, lng: 0 }
        );
        onSave(vertices, centroid, { lineStyle, fillColor, fillOpacity });
    };

    const handleCancel = () => {
        onCancel();
    };

    const mapContainer = window.atlasMapInstance?.getContainer();
    if (!mapContainer) return null;

    return ReactDOM.createPortal(
        <div className="polygon-draw-modal" ref={modalRef}>
            <div className="polygon-draw-modal-header">
                <h3>{modalTitle}</h3>
                <span className="polygon-draw-modal-hint">
                    {isResizeMode
                        ? 'Drag corner to scale, edge to stretch'
                        : isRotateMode
                            ? 'Drag to rotate the polygon'
                            : isDragMode
                                ? `Drag to move the entire ${isImageMode ? 'image' : 'polygon'}`
                                : activeShape
                                    ? `Click & drag on map to place ${activeShape}`
                                    : isImageMode
                                        ? (isDrawing ? 'Click on the map to place the image' : 'Use toolbar to move, resize, or rotate')
                                        : isDrawing ? 'Click on the map to add points' : 'Drag points to adjust'}
                </span>
            </div>

            {/* Style toolbar */}
            <div className="polygon-draw-style-toolbar">
                {!isImageMode && (
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Line Style"
                        onClick={() => { setShowLineMenu(v => !v); setShowColorMenu(false); setShowOpacityMenu(false); }}
                    >
                        <svg width="18" height="10" viewBox="0 0 18 10">
                            {lineStyle === 'solid' && <line x1="0" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="2"/>}
                            {lineStyle === 'dashed' && <line x1="0" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2"/>}
                            {lineStyle === 'dotted' && <line x1="0" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray="1 3" strokeLinecap="round"/>}
                            {lineStyle === 'dashdot' && <line x1="0" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2 1 2"/>}
                        </svg>
                    </button>
                    {showLineMenu && (
                        <div className="polygon-draw-dropdown">
                            {Object.keys(LINE_STYLES).map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`polygon-draw-dropdown-item${lineStyle === key ? ' active' : ''}`}
                                    onClick={() => { saveToHistoryRef.current?.(); setLineStyle(key); setShowLineMenu(false); }}
                                >
                                    <svg width="32" height="8" viewBox="0 0 32 8">
                                        {key === 'solid' && <line x1="0" y1="4" x2="32" y2="4" stroke="currentColor" strokeWidth="2"/>}
                                        {key === 'dashed' && <line x1="0" y1="4" x2="32" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 3"/>}
                                        {key === 'dotted' && <line x1="0" y1="4" x2="32" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="1.5 3" strokeLinecap="round"/>}
                                        {key === 'dashdot' && <line x1="0" y1="4" x2="32" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 3 1.5 3"/>}
                                    </svg>
                                    <span>{key}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                )}
                {!isImageMode && (
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${isCurveMode ? ' polygon-draw-curve-active' : ''}`}
                        title="Curve Mode"
                        onClick={() => { setIsCurveMode(v => !v); setShowLineMenu(false); setShowColorMenu(false); setShowOpacityMenu(false); setShowShapeMenu(false); }}
                    >
                        <svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M1,10 C5,1.5 13,1.5 17,10"/>
                        </svg>
                    </button>
                </div>
                )}
                {!isImageMode && (
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Fill Color"
                        onClick={() => { setShowColorMenu(v => !v); setShowLineMenu(false); setShowOpacityMenu(false); }}
                    >
                        <FontAwesomeIcon icon={faPalette} className="polygon-draw-fill-color-icon" style={{ fontSize: 14, width: 16, height: 16 }} />
                    </button>
                    {showColorMenu && (
                        <div className="polygon-draw-dropdown polygon-draw-color-grid">
                            {PALETTE_COLORS.map(c => (
                                <button
                                    key={c}
                                    type="button"
                                    className={`polygon-draw-color-option${fillColor === c ? ' active' : ''}`}
                                    style={{ background: c }}
                                    onClick={() => { saveToHistoryRef.current?.(); setFillColor(c); setShowColorMenu(false); }}
                                />
                            ))}
                        </div>
                    )}
                </div>
                )}
                {!isImageMode && (
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Fill Opacity"
                        onClick={() => { setShowOpacityMenu(v => !v); setShowLineMenu(false); setShowColorMenu(false); setShowShapeMenu(false); }}
                    >
                        <span className="polygon-draw-opacity-swatch" style={{ opacity: fillOpacity + 0.25 }} />
                    </button>
                    {showOpacityMenu && (
                        <div className="polygon-draw-dropdown polygon-draw-opacity-dropdown">
                            <label className="polygon-draw-opacity-label">
                                Opacity: {Math.round(fillOpacity * 100)}%
                            </label>
                            <input
                                type="range"
                                className="polygon-draw-opacity-slider"
                                min="0"
                                max="1"
                                step="0.01"
                                value={fillOpacity}
                                onMouseDown={() => saveToHistoryRef.current?.()}
                                onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
                            />
                        </div>
                    )}
                </div>
                )}
                {!isImageMode && (
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${activeShape ? ' polygon-draw-shape-active' : ''}`}
                        title="Shape Presets"
                        onClick={() => { setShowShapeMenu(v => !v); setShowLineMenu(false); setShowColorMenu(false); setShowOpacityMenu(false); }}
                    >
                        <FontAwesomeIcon icon={faShapes} style={{ fontSize: 14, width: 16, height: 16 }} />
                    </button>
                    {showShapeMenu && (
                        <div className="polygon-draw-dropdown polygon-draw-shape-dropdown">
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('triangle')}>
                                <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.4"><polygon points="10,1 1,17 19,17"/></svg>
                                <span>Triangle</span>
                            </button>
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('square')}>
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="16" height="16"/></svg>
                                <span>Square</span>
                            </button>
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('rectangle')}>
                                <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="22" height="14"/></svg>
                                <span>Rectangle</span>
                            </button>
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('circle')}>
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="9" cy="9" r="8"/></svg>
                                <span>Circle</span>
                            </button>
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('dot')}>
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" stroke="none"><circle cx="9" cy="9" r="5"/></svg>
                                <span>Dot</span>
                            </button>
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('pentagon')}>
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><polygon points="9,1 17,6.6 14,16 4,16 1,6.6"/></svg>
                                <span>Pentagon</span>
                            </button>
                            <button type="button" className="polygon-draw-dropdown-item" onClick={() => startShapePlacement('hexagon')}>
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><polygon points="9,1 16.7,5 16.7,13 9,17 1.3,13 1.3,5"/></svg>
                                <span>Hexagon</span>
                            </button>
                        </div>
                    )}
                </div>
                )}
                {isImageMode && (
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Image Opacity"
                        onClick={() => { setShowImageOpacityMenu(v => !v); }}
                    >
                        <span className="polygon-draw-opacity-swatch" style={{ opacity: imageOpacity * 0.85 + 0.15 }} />
                    </button>
                    {showImageOpacityMenu && (
                        <div className="polygon-draw-dropdown polygon-draw-opacity-dropdown">
                            <label className="polygon-draw-opacity-label">
                                Opacity: {Math.round(imageOpacity * 100)}%
                            </label>
                            <input
                                type="range"
                                className="polygon-draw-opacity-slider"
                                min="0"
                                max="1"
                                step="0.01"
                                value={imageOpacity}
                                onChange={(e) => setImageOpacity(parseFloat(e.target.value))}
                            />
                        </div>
                    )}
                </div>
                )}
                {/* Move / drag whole polygon */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${isDragMode ? ' polygon-draw-drag-active' : ''}`}
                        title={isImageMode ? 'Move Image' : 'Move Polygon'}
                        disabled={vertices.length < minimumVertexCount}
                        onClick={handleToggleDragMode}
                    >
                        <FontAwesomeIcon icon={faHand} style={{ fontSize: 16, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Rotate polygon */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${isRotateMode ? ' polygon-draw-rotate-active' : ''}`}
                        title={isImageMode ? 'Rotate Image' : 'Rotate Polygon'}
                        disabled={vertices.length < minimumVertexCount}
                        onClick={handleToggleRotateMode}
                    >
                        <FontAwesomeIcon icon={faRotate} style={{ fontSize: 16, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Resize polygon */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${isResizeMode ? ' polygon-draw-resize-active' : ''}`}
                        title={isImageMode ? 'Resize Image' : 'Resize Polygon'}
                        disabled={vertices.length < minimumVertexCount}
                        onClick={handleToggleResizeMode}
                    >
                        <FontAwesomeIcon icon={faUpRightAndDownLeftFromCenter} style={{ fontSize: 14, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Undo */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Undo (Ctrl+Z)"
                        disabled={history.length === 0}
                        onClick={handleUndo}
                    >
                        <FontAwesomeIcon icon={faRotateLeft} style={{ fontSize: 14, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Redo */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Redo (Ctrl+Y)"
                        disabled={future.length === 0}
                        onClick={handleRedo}
                    >
                        <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: 14, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Clear all (delete) */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn polygon-draw-clear-btn"
                        title="Clear All"
                        disabled={isImageMode ? vertices.length === 0 : vertices.length === 0}
                        onClick={handleClearAll}
                    >
                        <FontAwesomeIcon icon={faTrash} style={{ fontSize: 13, width: 15, height: 15 }} />
                    </button>
                </div>
            </div>

            {isImageMode ? (
                <div className="polygon-draw-modal-images">
                    {imgSlots.length === 0 && (
                        <div className="polygon-draw-modal-empty">Click "Add Image" to start</div>
                    )}
                    {imgSlots.map((slot) => {
                        const isActive = slot.id === activeImgId;
                        const placed = isActive ? vertices.length >= 4 : slot.vertices.length >= 4;
                        return (
                            <div
                                key={slot.id}
                                className={`polygon-draw-image-slot${isActive ? ' polygon-draw-image-slot--active' : ''}`}
                                onClick={() => handleSwitchImgSlot(slot.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') handleSwitchImgSlot(slot.id); }}
                            >
                                <div className="polygon-draw-image-slot-preview">
                                    {slot.url && <img src={slot.url} alt={slot.name} />}
                                </div>
                                <div className="polygon-draw-image-slot-info">
                                    <span className="polygon-draw-image-slot-name">{slot.name}</span>
                                    <span className={`polygon-draw-image-slot-status${placed ? ' placed' : ''}`}>
                                        {placed ? '✓ Placed' : 'Not placed'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="polygon-draw-image-slot-remove"
                                    onClick={(ev) => handleRemoveImgSlot(slot.id, ev)}
                                    title="Remove image"
                                    aria-label="Remove image"
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                    <button
                        type="button"
                        className="polygon-draw-image-add-btn"
                        onClick={() => imgFileInputRef.current?.click()}
                    >
                        + Add Image
                    </button>
                    <input
                        ref={imgFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleImgFileInput}
                    />
                </div>
            ) : (
            <div className="polygon-draw-modal-vertices">
                {vertices.length === 0 && (
                    <div className="polygon-draw-modal-empty">No points yet</div>
                )}
                {circleMetaRef.current ? (
                    (() => {
                        const cLat = circleMetaRef.current.center.lat;
                        const cLng = circleMetaRef.current.center.lng;
                        return (
                    <div className="polygon-draw-modal-vertex-row">
                        <span className="polygon-draw-modal-vertex-num">●</span>
                        <div className="polygon-draw-modal-vertex-coords polygon-draw-modal-vertex-inputs">
                            <input
                                type="number"
                                step="any"
                                className="polygon-draw-vertex-input"
                                value={parseFloat(cLat.toFixed(6))}
                                onChange={(e) => {
                                    const newLat = parseFloat(e.target.value);
                                    if (isNaN(newLat)) return;
                                    const dLat = newLat - cLat;
                                    setVertices(prev => {
                                        const updated = prev.map(v => ({ ...v, lat: parseFloat((v.lat + dLat).toFixed(6)) }));
                                        updatePolygonOnMap(updated);
                                        return updated;
                                    });
                                    if (circleMetaRef.current) circleMetaRef.current = { ...circleMetaRef.current, center: { ...circleMetaRef.current.center, lat: newLat } };
                                    if (markersRef.current[0]) markersRef.current[0].setLngLat([cLng, newLat]);
                                }}
                                title="Latitude"
                            />
                            <span className="polygon-draw-vertex-comma">,</span>
                            <input
                                type="number"
                                step="any"
                                className="polygon-draw-vertex-input"
                                value={parseFloat(cLng.toFixed(6))}
                                onChange={(e) => {
                                    const newLng = parseFloat(e.target.value);
                                    if (isNaN(newLng)) return;
                                    const dLng = newLng - cLng;
                                    setVertices(prev => {
                                        const updated = prev.map(v => ({ ...v, lng: parseFloat((v.lng + dLng).toFixed(6)) }));
                                        updatePolygonOnMap(updated);
                                        return updated;
                                    });
                                    if (circleMetaRef.current) circleMetaRef.current = { ...circleMetaRef.current, center: { ...circleMetaRef.current.center, lng: newLng } };
                                    if (markersRef.current[0]) markersRef.current[0].setLngLat([newLng, cLat]);
                                }}
                                title="Longitude"
                            />
                        </div>
                    </div>
                        );
                    })()
                ) : (
                    vertices.map((v, i) => (
                        <div key={i} className="polygon-draw-modal-vertex-row">
                            <span className="polygon-draw-modal-vertex-num">{i + 1}</span>
                            <div className="polygon-draw-modal-vertex-coords polygon-draw-modal-vertex-inputs">
                                <input
                                    type="number"
                                    step="any"
                                    className="polygon-draw-vertex-input"
                                    value={v.lat}
                                    onChange={(e) => {
                                        const newLat = parseFloat(e.target.value);
                                        if (isNaN(newLat)) return;
                                        setVertices(prev => {
                                            const updated = [...prev];
                                            updated[i] = { ...updated[i], lat: parseFloat(newLat.toFixed(6)) };
                                            updatePolygonOnMap(updated);
                                            if (markersRef.current[i]) markersRef.current[i].setLngLat([updated[i].lng, updated[i].lat]);
                                            return updated;
                                        });
                                    }}
                                    title="Latitude"
                                />
                                <span className="polygon-draw-vertex-comma">,</span>
                                <input
                                    type="number"
                                    step="any"
                                    className="polygon-draw-vertex-input"
                                    value={v.lng}
                                    onChange={(e) => {
                                        const newLng = parseFloat(e.target.value);
                                        if (isNaN(newLng)) return;
                                        setVertices(prev => {
                                            const updated = [...prev];
                                            updated[i] = { ...updated[i], lng: parseFloat(newLng.toFixed(6)) };
                                            updatePolygonOnMap(updated);
                                            if (markersRef.current[i]) markersRef.current[i].setLngLat([updated[i].lng, updated[i].lat]);
                                            return updated;
                                        });
                                    }}
                                    title="Longitude"
                                />
                            </div>
                            <button
                                type="button"
                                className="polygon-draw-modal-vertex-remove"
                                onClick={() => handleRemoveVertex(i)}
                                title="Remove"
                            >
                                &times;
                            </button>
                        </div>
                    ))
                )}
            </div>
            )}

            <div className="polygon-draw-modal-actions">
                {!isImageMode && isDrawing && vertices.length >= 3 && (
                    <button
                        type="button"
                        className="polygon-draw-modal-btn polygon-draw-modal-btn-finish"
                        onClick={handleFinishDrawing}
                    >
                        Finish Drawing
                    </button>
                )}
                {!isImageMode && !isDrawing && (
                    <button
                        type="button"
                        className="polygon-draw-modal-btn polygon-draw-modal-btn-resume"
                        onClick={handleResumeDrawing}
                    >
                        Add More Points
                    </button>
                )}
                <button
                    type="button"
                    className="polygon-draw-modal-btn polygon-draw-modal-btn-save"
                    onClick={handleSave}
                    disabled={isImageMode
                        ? imgSlots.filter(s => (s.id === activeImgId ? vertices : s.vertices).length >= 4).length === 0
                        : vertices.length < minimumVertexCount}
                >
                    Save
                </button>
                <button
                    type="button"
                    className="polygon-draw-modal-btn polygon-draw-modal-btn-cancel"
                    onClick={handleCancel}
                >
                    Cancel
                </button>
            </div>
        </div>,
        mapContainer
    );
};

export default PolygonDrawingModal;
