import React, { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faLocationCrosshairs, faTrash, faSpinner } from '@fortawesome/free-solid-svg-icons';
import './WatershedPanel.css';

// USGS SS-Delineate service (same API the streamstats.usgs.gov site uses; CORS-enabled).
// The legacy /streamstatsservices API was decommissioned in January 2026.
const SS_DELINEATE_URL = 'https://streamstats.usgs.gov/ss-delineate/v1/delineate/sshydro';
const REQUEST_TIMEOUT_MS = 120000;
// StreamStats snaps the click to its 30m stream grid; below this zoom the click is too imprecise
const MIN_DELINEATION_ZOOM = 12;

const STATES = [
    { code: 'WA', label: 'Washington' },
    { code: 'ID', label: 'Idaho' },
    { code: 'OR', label: 'Oregon' },
];

const BASIN_SOURCE = 'streamstats-basin';
const POINT_SOURCE = 'streamstats-point';
const BASIN_FILL_LAYER = 'streamstats-basin-fill';
const BASIN_OUTLINE_LAYER = 'streamstats-basin-outline';
const POINT_LAYER = 'streamstats-point-circle';

// Walk any GeoJSON coordinates array and accumulate [minLng, minLat, maxLng, maxLat]
function extendBounds(coords, bounds) {
    if (typeof coords[0] === 'number') {
        bounds[0] = Math.min(bounds[0], coords[0]);
        bounds[1] = Math.min(bounds[1], coords[1]);
        bounds[2] = Math.max(bounds[2], coords[0]);
        bounds[3] = Math.max(bounds[3], coords[1]);
        return;
    }
    coords.forEach(c => extendBounds(c, bounds));
}

function geojsonBounds(geojson) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
    features.forEach(f => {
        if (f?.geometry?.coordinates) extendBounds(f.geometry.coordinates, bounds);
    });
    return Number.isFinite(bounds[0]) ? bounds : null;
}

export default function WatershedPanel({ isOpen, onClose, splitBottom = false, mapInstance }) {
    const [stateCode, setStateCode] = useState('WA');
    const [isArmed, setIsArmed] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [clickedPoint, setClickedPoint] = useState(null);
    const [workspaceId, setWorkspaceId] = useState('');
    const [error, setError] = useState('');
    const [zoomHint, setZoomHint] = useState(false);
    const [hasResult, setHasResult] = useState(false);
    const abortRef = useRef(null);

    const getMap = () => (typeof mapInstance === 'function' ? mapInstance() : mapInstance);

    // Panel remounts each open; recover "result on map" state so Clear stays available
    useEffect(() => {
        const map = getMap();
        if (map && map.getSource(BASIN_SOURCE)) {
            setHasResult(true);
        }
        return () => {
            abortRef.current?.abort();
        };
        // eslint-disable-next-line
    }, []);

    // While armed: crosshair cursor + one delineation per map click
    useEffect(() => {
        if (!isArmed) return;
        const map = getMap();
        if (!map) {
            setIsArmed(false);
            setError('Map is not ready yet. Please try again.');
            return;
        }

        map.getCanvas().style.cursor = 'crosshair';
        const handler = (e) => {
            if (map.getZoom() < MIN_DELINEATION_ZOOM) {
                setZoomHint(true);
                return;
            }
            setZoomHint(false);
            setIsArmed(false);
            delineate(e.lngLat);
        };
        map.on('click', handler);

        return () => {
            map.off('click', handler);
            map.getCanvas().style.cursor = '';
        };
        // eslint-disable-next-line
    }, [isArmed, stateCode]);

    const renderResult = (map, basin, point) => {
        clearResultLayers(map);

        map.addSource(BASIN_SOURCE, { type: 'geojson', data: basin });
        map.addLayer({
            id: BASIN_FILL_LAYER,
            type: 'fill',
            source: BASIN_SOURCE,
            paint: { 'fill-color': '#f5c542', 'fill-opacity': 0.3 },
        });
        map.addLayer({
            id: BASIN_OUTLINE_LAYER,
            type: 'line',
            source: BASIN_SOURCE,
            paint: { 'line-color': '#b8860b', 'line-width': 2.5 },
        });

        if (point) {
            map.addSource(POINT_SOURCE, { type: 'geojson', data: point });
            map.addLayer({
                id: POINT_LAYER,
                type: 'circle',
                source: POINT_SOURCE,
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#d32f2f',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                },
            });
        }

        const bounds = geojsonBounds(basin);
        if (bounds) {
            map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60 });
        }
        setHasResult(true);
    };

    const clearResultLayers = (map) => {
        [BASIN_FILL_LAYER, BASIN_OUTLINE_LAYER, POINT_LAYER].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        [BASIN_SOURCE, POINT_SOURCE].forEach(id => {
            if (map.getSource(id)) map.removeSource(id);
        });
    };

    const delineate = async ({ lng, lat }) => {
        setError('');
        setWorkspaceId('');
        setClickedPoint({ lng, lat });
        setIsLoading(true);

        const controller = new AbortController();
        abortRef.current = controller;
        const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lng.toFixed(6) });
            const res = await fetch(`${SS_DELINEATE_URL}/${stateCode}?${params}`, { signal: controller.signal });
            if (!res.ok) throw new Error(`StreamStats returned HTTP ${res.status}. Please try again later.`);
            const data = await res.json();

            // featurecollection nests entry lists one level deep
            const entries = (data?.bcrequest?.wsresp?.featurecollection || []).flat(2);
            const basin = entries.find(f => f?.name === 'globalwatershed')?.feature;
            const point = entries.find(f => f?.name === 'globalwatershedpoint')?.feature;
            if (!basin) {
                throw new Error('No watershed was returned. Try clicking closer to a stream channel.');
            }

            const map = getMap();
            if (map) renderResult(map, basin, point);
            setWorkspaceId(data?.bcrequest?.wsresp?.workspace_id || '');
        } catch (err) {
            if (err.name === 'AbortError') {
                setError('The request timed out or was cancelled. StreamStats can be slow — please try again.');
            } else {
                setError(err.message || 'Delineation failed.');
            }
        } finally {
            clearTimeout(timeoutTimer);
            setIsLoading(false);
            abortRef.current = null;
        }
    };

    const handleArmToggle = () => {
        setError('');
        setZoomHint(false);
        setIsArmed(v => !v);
    };

    const handleCancel = () => {
        abortRef.current?.abort();
    };

    const handleClear = () => {
        const map = getMap();
        if (map) clearResultLayers(map);
        setHasResult(false);
        setClickedPoint(null);
        setWorkspaceId('');
        setError('');
    };

    if (!isOpen) return null;

    return (
        <div className={`watershed-panel${splitBottom ? ' watershed-panel--split-bottom' : ''}`}>
            <div className="watershed-panel-header">
                <span className="watershed-panel-title">Watershed Delineation</span>
                <div className="watershed-panel-header-actions">
                    <button className="watershed-panel-icon-btn" title="Close" onClick={onClose}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
            </div>

            <div className="watershed-panel-body">
                <p className="watershed-panel-intro">
                    Powered by USGS StreamStats. Zoom in to a stream, place a point on it, and the
                    upstream drainage basin is computed and drawn on the map.
                </p>

                <label className="watershed-panel-field">
                    <span>State</span>
                    <select
                        value={stateCode}
                        onChange={(e) => setStateCode(e.target.value)}
                        disabled={isArmed || isLoading}
                    >
                        {STATES.map(s => (
                            <option key={s.code} value={s.code}>{s.label} ({s.code})</option>
                        ))}
                    </select>
                </label>

                <button
                    className={`watershed-panel-arm-btn${isArmed ? ' watershed-panel-arm-btn--armed' : ''}`}
                    onClick={handleArmToggle}
                    disabled={isLoading}
                >
                    <FontAwesomeIcon icon={faLocationCrosshairs} />
                    {isArmed ? ' Cancel point selection' : ' Select point on map'}
                </button>

                {isArmed && (
                    <div className="watershed-panel-note">
                        Click a stream on the map to place the pour point.
                        {zoomHint && (
                            <div className="watershed-panel-warning">
                                Please zoom in further (zoom ≥ {MIN_DELINEATION_ZOOM}) so the point
                                snaps to the correct stream.
                            </div>
                        )}
                    </div>
                )}

                {isLoading && (
                    <div className="watershed-panel-loading">
                        <FontAwesomeIcon icon={faSpinner} spin />
                        <span>Delineating watershed… this can take up to 30 seconds.</span>
                        <button className="watershed-panel-cancel-btn" onClick={handleCancel}>Cancel</button>
                    </div>
                )}

                {error && <div className="watershed-panel-error">{error}</div>}

                {clickedPoint && !isLoading && !error && hasResult && (
                    <div className="watershed-panel-result">
                        <div><strong>Pour point:</strong> {clickedPoint.lat.toFixed(5)}, {clickedPoint.lng.toFixed(5)}</div>
                        {workspaceId && (
                            <div className="watershed-panel-result-workspace"><strong>Workspace:</strong> {workspaceId}</div>
                        )}
                    </div>
                )}

                {hasResult && !isLoading && (
                    <button className="watershed-panel-clear-btn" onClick={handleClear}>
                        <FontAwesomeIcon icon={faTrash} /> Clear result from map
                    </button>
                )}
            </div>
        </div>
    );
}
