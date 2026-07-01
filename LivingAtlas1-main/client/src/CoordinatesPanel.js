import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import mapboxgl from 'mapbox-gl';
import {
    MARKER_ICON_OPTIONS,
    DEFAULT_MARKER_ICON_KEY,
    MarkerIconGlyph,
    buildMarkerIconElement,
    MARKER_ICON_COLOR,
} from './markerIcons';
import './PolygonDrawingModal.css';
import './CoordinatesPanel.css';

const round6 = (n) => parseFloat(Number(n).toFixed(6));

/**
 * Side panel for building a one-or-many point card. Styled and positioned to
 * match the polygon drawing panel and the image placement panel (same portal
 * target into the map container, same `polygon-draw-modal` classes).
 * - Click the map to add points.
 * - Edit a point's position by typing latitude / longitude.
 * - Pick a FontAwesome icon per point.
 * Calls onSave(points) where points = [{ lat, lng, icon }].
 */
function CoordinatesPanel({ initialPoints = [], onSave, onCancel }) {
    const [points, setPoints] = useState(() =>
        initialPoints.map(p => ({
            lat: p.lat,
            lng: p.lng,
            icon: p.icon || DEFAULT_MARKER_ICON_KEY,
        }))
    );
    const [openIconPicker, setOpenIconPicker] = useState(null); // index whose picker is open

    const markersRef = useRef([]);
    const panelRef = useRef(null);

    const addPoint = useCallback((lat, lng) => {
        setPoints(prev => [
            ...prev,
            { lat: round6(lat), lng: round6(lng), icon: DEFAULT_MARKER_ICON_KEY },
        ]);
    }, []);

    const updatePoint = useCallback((index, patch) => {
        setPoints(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    }, []);

    const removePoint = useCallback((index) => {
        setPoints(prev => prev.filter((_, i) => i !== index));
        setOpenIconPicker(null);
    }, []);

    // Attach map click-to-add handler for the lifetime of the panel.
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map) return undefined;

        map.getCanvas().style.cursor = 'crosshair';
        const handleMapClick = (e) => {
            const { lat, lng } = e.lngLat;
            addPoint(lat, lng);
        };
        map.on('click', handleMapClick);

        return () => {
            map.off('click', handleMapClick);
            map.getCanvas().style.cursor = '';
        };
    }, [addPoint]);

    // Keep the on-map markers in sync with the points list.
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map) return;

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        points.forEach((p, index) => {
            const lat = parseFloat(p.lat);
            const lng = parseFloat(p.lng);
            if (isNaN(lat) || isNaN(lng)) {
                markersRef.current.push({ remove: () => {} });
                return;
            }
            const el = buildMarkerIconElement(p.icon, MARKER_ICON_COLOR);
            const marker = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'bottom' })
                .setLngLat([lng, lat])
                .addTo(map);
            marker.on('dragend', () => {
                const pos = marker.getLngLat();
                updatePoint(index, { lat: round6(pos.lat), lng: round6(pos.lng) });
            });
            markersRef.current.push(marker);
        });
    }, [points, updatePoint]);

    // Clean up all markers when the panel unmounts.
    useEffect(() => () => {
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
    }, []);

    // Align the panel's top with the "Add card from map" map control button so it
    // sits at the same height as the button that launches this flow (the button is
    // pushed down by the search control stacked above it, so top:10px looks too high).
    useEffect(() => {
        const map = window.atlasMapInstance;
        const panel = panelRef.current;
        if (!map || !panel) return undefined;
        const container = map.getContainer();

        const alignTop = () => {
            const btn = container.querySelector('.map-add-tools-btn');
            if (!btn) return;
            const top = btn.getBoundingClientRect().top - container.getBoundingClientRect().top;
            if (top > 0) panel.style.top = `${top}px`;
        };

        const raf = requestAnimationFrame(alignTop);
        return () => cancelAnimationFrame(raf);
    }, []);

    const handleLatChange = (index, value) => {
        const num = parseFloat(value);
        updatePoint(index, { lat: isNaN(num) ? value : round6(num) });
    };
    const handleLngChange = (index, value) => {
        const num = parseFloat(value);
        updatePoint(index, { lng: isNaN(num) ? value : round6(num) });
    };

    const handleSave = () => {
        const cleaned = points
            .map(p => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng), icon: p.icon || DEFAULT_MARKER_ICON_KEY }))
            .filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180);
        if (cleaned.length < 1) {
            alert('Add at least one valid point before saving.');
            return;
        }
        onSave?.(cleaned);
    };

    const mapContainer = window.atlasMapInstance?.getContainer();
    if (!mapContainer) return null;

    return ReactDOM.createPortal(
        <div className="polygon-draw-modal coordinates-panel" ref={panelRef}>
            <div className="polygon-draw-modal-header">
                <h3>Add Points</h3>
                <span className="polygon-draw-modal-hint">Click on the map to add points</span>
            </div>

            <div className="polygon-draw-modal-vertices">
                {points.length === 0 && (
                    <div className="polygon-draw-modal-empty">No points yet</div>
                )}

                {points.map((p, index) => (
                    <React.Fragment key={index}>
                        <div className="polygon-draw-modal-vertex-row">
                            <span className="polygon-draw-modal-vertex-num">{index + 1}</span>
                            <div className="polygon-draw-modal-vertex-coords polygon-draw-modal-vertex-inputs">
                                <input
                                    type="number"
                                    step="any"
                                    className="polygon-draw-vertex-input"
                                    value={p.lat}
                                    onChange={(e) => handleLatChange(index, e.target.value)}
                                    title="Latitude"
                                />
                                <span className="polygon-draw-vertex-comma">,</span>
                                <input
                                    type="number"
                                    step="any"
                                    className="polygon-draw-vertex-input"
                                    value={p.lng}
                                    onChange={(e) => handleLngChange(index, e.target.value)}
                                    title="Longitude"
                                />
                            </div>

                            <div className="coordinates-panel-icon-wrap">
                                <button
                                    type="button"
                                    className={`coordinates-panel-icon-btn${openIconPicker === index ? ' active' : ''}`}
                                    title="Choose icon"
                                    onClick={() => setOpenIconPicker(openIconPicker === index ? null : index)}
                                >
                                    <MarkerIconGlyph optionKey={p.icon} />
                                </button>
                            </div>

                            <button
                                type="button"
                                className="polygon-draw-modal-vertex-remove"
                                title="Remove"
                                onClick={() => removePoint(index)}
                            >
                                &times;
                            </button>
                        </div>

                        {openIconPicker === index && (
                            <div className="coordinates-panel-icon-grid">
                                {MARKER_ICON_OPTIONS.map(opt => (
                                    <button
                                        type="button"
                                        key={opt.key}
                                        className={`coordinates-panel-icon-option${opt.key === p.icon ? ' active' : ''}`}
                                        title={opt.label}
                                        onClick={() => {
                                            updatePoint(index, { icon: opt.key });
                                            setOpenIconPicker(null);
                                        }}
                                    >
                                        <MarkerIconGlyph optionKey={opt.key} />
                                    </button>
                                ))}
                            </div>
                        )}
                    </React.Fragment>
                ))}
            </div>

            <div className="polygon-draw-modal-actions">
                <button
                    type="button"
                    className="polygon-draw-modal-btn polygon-draw-modal-btn-save"
                    onClick={handleSave}
                    disabled={points.length === 0}
                >
                    Save
                </button>
                <button
                    type="button"
                    className="polygon-draw-modal-btn polygon-draw-modal-btn-cancel"
                    onClick={() => onCancel?.()}
                >
                    Cancel
                </button>
            </div>
        </div>,
        mapContainer
    );
}

export default CoordinatesPanel;
