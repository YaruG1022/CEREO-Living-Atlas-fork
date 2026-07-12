import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHand, faRotate, faUpRightAndDownLeftFromCenter, faRotateLeft, faRotateRight, faTrash, faPalette, faPlus } from '@fortawesome/free-solid-svg-icons';
import { HexColorPicker } from 'react-colorful';
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

const PALETTE_COLORS = [
    '#0077c0', '#e74c3c', '#27ae60', '#f39c12',
    '#8e44ad', '#1abc9c', '#2c3e50', '#000000',
];

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;
const normalizeHexColor = (value) => {
    if (typeof value !== 'string') return MARKER_ICON_COLOR;
    const v = value.trim();
    return HEX_COLOR_RE.test(v) ? v : MARKER_ICON_COLOR;
};

/**
 * Side panel for building a one-or-many point card. Styled and positioned to
 * match the polygon drawing panel and the image placement panel (same portal
 * target into the map container, same `polygon-draw-modal` classes).
 * - Click the map to add points.
 * - Edit a point's position by typing latitude / longitude.
 * - Pick a FontAwesome icon per point.
 * - Style toolbar (same as the polygon modal): marker color, opacity,
 *   move / rotate / scale all points, undo / redo, clear all.
 * Calls onSave(points) where points = [{ lat, lng, icon, color, opacity }].
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

    // Marker style shared by all points
    const [markerColor, setMarkerColor] = useState(() => normalizeHexColor(initialPoints[0]?.color || MARKER_ICON_COLOR));
    const [markerOpacity, setMarkerOpacity] = useState(() => {
        const o = parseFloat(initialPoints[0]?.opacity);
        return isNaN(o) ? 1 : Math.min(1, Math.max(0, o));
    });
    const [hexInput, setHexInput] = useState(() => normalizeHexColor(initialPoints[0]?.color || MARKER_ICON_COLOR));
    const [showColorMenu, setShowColorMenu] = useState(false);
    const [showOpacityMenu, setShowOpacityMenu] = useState(false);

    // Active tool mode (mutually exclusive): 'add' | 'move' | 'rotate' | 'scale' | null.
    // Points can only be added by clicking the map while 'add' is active; the
    // user must explicitly enable it via the toolbar's "Add Points" button.
    const [activeMode, setActiveMode] = useState(null);

    // Undo / redo stacks of { points, color, opacity }
    const [history, setHistory] = useState([]);
    const [future, setFuture] = useState([]);

    const markersRef = useRef([]);
    const panelRef = useRef(null);

    // Always-current refs, safe to read from stale closures / map handlers
    const pointsRef = useRef(points);
    pointsRef.current = points;
    const markerColorRef = useRef(markerColor);
    markerColorRef.current = markerColor;
    const markerOpacityRef = useRef(markerOpacity);
    markerOpacityRef.current = markerOpacity;
    const activeModeRef = useRef(activeMode);
    activeModeRef.current = activeMode;
    const transformDragRef = useRef(null); // in-progress transform drag state
    const handleUndoRef = useRef(null);
    const handleRedoRef = useRef(null);

    const saveToHistory = useCallback(() => {
        const snap = {
            points: pointsRef.current.map(p => ({ ...p })),
            color: markerColorRef.current,
            opacity: markerOpacityRef.current,
        };
        setHistory(h => [...h.slice(-49), snap]);
        setFuture([]);
    }, []);
    const saveToHistoryRef = useRef(saveToHistory);
    saveToHistoryRef.current = saveToHistory;

    const addPoint = useCallback((lat, lng) => {
        saveToHistoryRef.current?.();
        setPoints(prev => [
            ...prev,
            { lat: round6(lat), lng: round6(lng), icon: DEFAULT_MARKER_ICON_KEY },
        ]);
    }, []);

    const updatePoint = useCallback((index, patch) => {
        setPoints(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    }, []);

    const removePoint = useCallback((index) => {
        saveToHistoryRef.current?.();
        setPoints(prev => prev.filter((_, i) => i !== index));
        setOpenIconPicker(null);
    }, []);

    // Attach map click-to-add handler for the lifetime of the panel; it only
    // adds points while the "Add Points" tool is active.
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map) return undefined;

        const handleMapClick = (e) => {
            if (activeModeRef.current !== 'add') return;
            const { lat, lng } = e.lngLat;
            addPoint(lat, lng);
        };
        map.on('click', handleMapClick);

        return () => {
            map.off('click', handleMapClick);
        };
    }, [addPoint]);

    // Crosshair cursor while the "Add Points" tool is active.
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map || activeMode !== 'add') return undefined;
        map.getCanvas().style.cursor = 'crosshair';
        return () => {
            map.getCanvas().style.cursor = '';
        };
    }, [activeMode]);

    // Keep the on-map markers in sync with the points list and marker style.
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map) return;

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        points.forEach((p, index) => {
            const lat = parseFloat(p.lat);
            const lng = parseFloat(p.lng);
            if (isNaN(lat) || isNaN(lng)) {
                markersRef.current.push({ remove: () => {}, setDraggable: () => {}, setLngLat: () => {} });
                return;
            }
            const el = buildMarkerIconElement(p.icon, markerColor);
            el.style.opacity = markerOpacity;
            const isTransforming = activeMode && activeMode !== 'add';
            const marker = new mapboxgl.Marker({ element: el, draggable: !isTransforming, anchor: 'bottom' })
                .setLngLat([lng, lat])
                .addTo(map);
            marker.on('dragstart', () => {
                saveToHistoryRef.current?.();
            });
            marker.on('dragend', () => {
                const pos = marker.getLngLat();
                updatePoint(index, { lat: round6(pos.lat), lng: round6(pos.lng) });
            });
            markersRef.current.push(marker);
        });
    }, [points, updatePoint, markerColor, markerOpacity, activeMode]);

    // Clean up all markers when the panel unmounts.
    useEffect(() => () => {
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
    }, []);

    // ── Undo / Redo ──
    const applySnapshot = useCallback((snap) => {
        setPoints(snap.points.map(p => ({ ...p })));
        setMarkerColor(snap.color);
        setHexInput(normalizeHexColor(snap.color));
        setMarkerOpacity(snap.opacity);
        setOpenIconPicker(null);
    }, []);

    const handleUndo = useCallback(() => {
        if (history.length === 0) return;
        const snap = history[history.length - 1];
        setFuture(f => [...f, {
            points: pointsRef.current.map(p => ({ ...p })),
            color: markerColorRef.current,
            opacity: markerOpacityRef.current,
        }]);
        setHistory(h => h.slice(0, -1));
        applySnapshot(snap);
    }, [history, applySnapshot]);

    const handleRedo = useCallback(() => {
        if (future.length === 0) return;
        const snap = future[future.length - 1];
        setHistory(h => [...h.slice(-49), {
            points: pointsRef.current.map(p => ({ ...p })),
            color: markerColorRef.current,
            opacity: markerOpacityRef.current,
        }]);
        setFuture(f => f.slice(0, -1));
        applySnapshot(snap);
    }, [future, applySnapshot]);

    handleUndoRef.current = handleUndo;
    handleRedoRef.current = handleRedo;

    // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
    useEffect(() => {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                handleUndoRef.current?.();
            } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                e.preventDefault();
                handleRedoRef.current?.();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // ── Move / rotate / scale all points ──
    // Drag anywhere on the map: move translates every point, rotate spins them
    // around their centroid, scale grows/shrinks distances from the centroid.
    useEffect(() => {
        const map = window.atlasMapInstance;
        if (!map || !activeMode || activeMode === 'add') return undefined;
        const transformMode = activeMode;

        map.getCanvas().style.cursor = 'grab';

        const centroidOf = (pts) => {
            const valid = pts.filter(p => !isNaN(parseFloat(p.lat)) && !isNaN(parseFloat(p.lng)));
            const lat = valid.reduce((s, p) => s + parseFloat(p.lat), 0) / valid.length;
            const lng = valid.reduce((s, p) => s + parseFloat(p.lng), 0) / valid.length;
            return { lat, lng };
        };

        const transformPoints = (startPoints, drag, cur) => {
            if (transformMode === 'move') {
                const dLat = cur.lat - drag.origin.lat;
                const dLng = cur.lng - drag.origin.lng;
                return startPoints.map(p => ({
                    ...p,
                    lat: round6(parseFloat(p.lat) + dLat),
                    lng: round6(parseFloat(p.lng) + dLng),
                }));
            }
            const { centroid } = drag;
            const cosLat = Math.cos(centroid.lat * Math.PI / 180) || 1;
            if (transformMode === 'rotate') {
                const startAngle = Math.atan2(drag.origin.lat - centroid.lat, (drag.origin.lng - centroid.lng) * cosLat);
                const curAngle = Math.atan2(cur.lat - centroid.lat, (cur.lng - centroid.lng) * cosLat);
                const delta = curAngle - startAngle;
                const cosA = Math.cos(delta);
                const sinA = Math.sin(delta);
                return startPoints.map(p => {
                    const dx = (parseFloat(p.lng) - centroid.lng) * cosLat;
                    const dy = parseFloat(p.lat) - centroid.lat;
                    return {
                        ...p,
                        lng: round6(centroid.lng + (dx * cosA - dy * sinA) / cosLat),
                        lat: round6(centroid.lat + dx * sinA + dy * cosA),
                    };
                });
            }
            // scale
            const dist = (pt) => Math.hypot((pt.lng - centroid.lng) * cosLat, pt.lat - centroid.lat);
            const d0 = dist(drag.origin);
            const d1 = dist(cur);
            const factor = d0 > 1e-9 ? d1 / d0 : 1;
            return startPoints.map(p => ({
                ...p,
                lng: round6(centroid.lng + (parseFloat(p.lng) - centroid.lng) * factor),
                lat: round6(centroid.lat + (parseFloat(p.lat) - centroid.lat) * factor),
            }));
        };

        const onMouseDown = (e) => {
            e.preventDefault();
            saveToHistoryRef.current?.();
            transformDragRef.current = {
                origin: { lat: e.lngLat.lat, lng: e.lngLat.lng },
                centroid: centroidOf(pointsRef.current),
                startPoints: pointsRef.current.map(p => ({ ...p })),
            };
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
        };

        const onMouseMove = (e) => {
            if (!transformDragRef.current) return;
            const moved = transformPoints(transformDragRef.current.startPoints, transformDragRef.current, e.lngLat);
            moved.forEach((p, i) => {
                markersRef.current[i]?.setLngLat?.([p.lng, p.lat]);
            });
        };

        const onMouseUp = (e) => {
            if (!transformDragRef.current) return;
            const moved = transformPoints(transformDragRef.current.startPoints, transformDragRef.current, e.lngLat);
            transformDragRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = 'grab';
            setPoints(moved);
        };

        map.on('mousedown', onMouseDown);
        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);

        return () => {
            map.off('mousedown', onMouseDown);
            map.off('mousemove', onMouseMove);
            map.off('mouseup', onMouseUp);
            transformDragRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = '';
        };
    }, [activeMode]);

    const toggleMode = (mode) => {
        setShowColorMenu(false);
        setShowOpacityMenu(false);
        setOpenIconPicker(null);
        setActiveMode(prev => (prev === mode ? null : mode));
    };

    const handleClearAll = () => {
        if (pointsRef.current.length === 0) return;
        saveToHistoryRef.current?.();
        setPoints([]);
        setOpenIconPicker(null);
        setActiveMode(null);
    };

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
            .map(p => ({
                lat: parseFloat(p.lat),
                lng: parseFloat(p.lng),
                icon: p.icon || DEFAULT_MARKER_ICON_KEY,
                color: markerColor,
                opacity: markerOpacity,
            }))
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
                <span className="polygon-draw-modal-hint">
                    {activeMode === 'add'
                        ? 'Click on the map to add points'
                        : activeMode === 'move'
                            ? 'Drag to move all points'
                            : activeMode === 'rotate'
                                ? 'Drag to rotate points around their center'
                                : activeMode === 'scale'
                                    ? 'Drag to scale points from their center'
                                    : points.length > 0
                                        ? 'Drag points to adjust'
                                        : 'Use the + tool to add points'}
                </span>
            </div>

            {/* Style toolbar (same look as the polygon drawing modal) */}
            <div className="polygon-draw-style-toolbar">
                {/* Add points */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${activeMode === 'add' ? ' polygon-draw-drag-active' : ''}`}
                        title="Add Points"
                        onClick={() => toggleMode('add')}
                    >
                        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 15, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Marker color */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Marker Color"
                        onClick={() => { setShowColorMenu(v => !v); setShowOpacityMenu(false); }}
                    >
                        <FontAwesomeIcon icon={faPalette} style={{ fontSize: 14, width: 16, height: 16, color: markerColor }} />
                    </button>
                    {showColorMenu && (
                        <div className="polygon-draw-dropdown polygon-draw-color-menu">
                            <div className="polygon-draw-color-grid">
                                {PALETTE_COLORS.map(c => (
                                    <button
                                        key={c}
                                        type="button"
                                        className={`polygon-draw-color-option${markerColor === c ? ' active' : ''}`}
                                        style={{ background: c }}
                                        onClick={() => { saveToHistoryRef.current?.(); setMarkerColor(c); setHexInput(c); setShowColorMenu(false); }}
                                    />
                                ))}
                            </div>
                            <div className="polygon-draw-color-custom">
                                <HexColorPicker
                                    className="polygon-draw-color-picker"
                                    color={normalizeHexColor(markerColor)}
                                    onMouseDown={() => saveToHistoryRef.current?.()}
                                    onChange={(c) => { setMarkerColor(c); setHexInput(c); }}
                                />
                                <input
                                    type="text"
                                    className="polygon-draw-color-hex"
                                    value={hexInput}
                                    spellCheck={false}
                                    maxLength={7}
                                    placeholder="#RRGGBB"
                                    onChange={(e) => {
                                        let v = e.target.value;
                                        if (v && !v.startsWith('#')) v = '#' + v;
                                        setHexInput(v);
                                        if (HEX_COLOR_RE.test(v)) {
                                            saveToHistoryRef.current?.();
                                            setMarkerColor(v);
                                        }
                                    }}
                                    onBlur={() => {
                                        if (!HEX_COLOR_RE.test(hexInput)) setHexInput(normalizeHexColor(markerColor));
                                    }}
                                    aria-label="Hex color value"
                                />
                            </div>
                        </div>
                    )}
                </div>
                {/* Marker opacity */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn"
                        title="Marker Opacity"
                        onClick={() => { setShowOpacityMenu(v => !v); setShowColorMenu(false); }}
                    >
                        <span className="polygon-draw-opacity-swatch" style={{ opacity: markerOpacity * 0.85 + 0.15 }} />
                    </button>
                    {showOpacityMenu && (
                        <div className="polygon-draw-dropdown polygon-draw-opacity-dropdown">
                            <label className="polygon-draw-opacity-label">
                                Opacity: {Math.round(markerOpacity * 100)}%
                            </label>
                            <input
                                type="range"
                                className="polygon-draw-opacity-slider"
                                min="0.1"
                                max="1"
                                step="0.01"
                                value={markerOpacity}
                                onMouseDown={() => saveToHistoryRef.current?.()}
                                onChange={(e) => setMarkerOpacity(parseFloat(e.target.value))}
                            />
                        </div>
                    )}
                </div>
                {/* Move all points */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${activeMode === 'move' ? ' polygon-draw-drag-active' : ''}`}
                        title="Move Points"
                        disabled={points.length < 1}
                        onClick={() => toggleMode('move')}
                    >
                        <FontAwesomeIcon icon={faHand} style={{ fontSize: 16, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Rotate all points */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${activeMode === 'rotate' ? ' polygon-draw-rotate-active' : ''}`}
                        title="Rotate Points"
                        disabled={points.length < 2}
                        onClick={() => toggleMode('rotate')}
                    >
                        <FontAwesomeIcon icon={faRotate} style={{ fontSize: 16, width: 16, height: 16 }} />
                    </button>
                </div>
                {/* Scale all points */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className={`polygon-draw-style-btn${activeMode === 'scale' ? ' polygon-draw-resize-active' : ''}`}
                        title="Scale Points"
                        disabled={points.length < 2}
                        onClick={() => toggleMode('scale')}
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
                {/* Clear all */}
                <div className="polygon-draw-style-btn-wrap">
                    <button
                        type="button"
                        className="polygon-draw-style-btn polygon-draw-clear-btn"
                        title="Clear All"
                        disabled={points.length === 0}
                        onClick={handleClearAll}
                    >
                        <FontAwesomeIcon icon={faTrash} style={{ fontSize: 13, width: 15, height: 15 }} />
                    </button>
                </div>
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
                                    onFocus={() => saveToHistoryRef.current?.()}
                                    onChange={(e) => handleLatChange(index, e.target.value)}
                                    title="Latitude"
                                />
                                <span className="polygon-draw-vertex-comma">,</span>
                                <input
                                    type="number"
                                    step="any"
                                    className="polygon-draw-vertex-input"
                                    value={p.lng}
                                    onFocus={() => saveToHistoryRef.current?.()}
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
                                            saveToHistoryRef.current?.();
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
