// Shared Service Info & Layer Info modals used by both the ArcGIS upload panel
// ("GIS Services") and the Custom Layers panel.
//
// Map layer/source ids differ between the panels only by a namespace prefix:
//   upload panel:  arcgis-raster-layer-{key}-…   / arcgis-raster-{key}-…
//   custom panel:  arcgis-raster-layer-custom-{key}-… / arcgis-raster-custom-{key}-…
// The `mapKeyPrefix` prop ('' or 'custom-') selects the namespace.
//
// Both components must stay mounted while the panel is mounted (they return
// null when closed) so their per-service/per-layer UI state persists across
// open/close, matching the panels' previous behavior.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFloppyDisk, faSquare, faDownload, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { getArcgisTileUrl } from './arcgisDataUtils';
import { applyArcgisVectorLayerFilter } from './arcgisVectorUtils';

export const EARLIEST_TIMELINE_YEAR = 2000;
const MONTH_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Module-level cache so per-service/per-layer UI values (opacity, time filter,
// zoom range) survive modal/panel close & reopen, matching the previous
// behavior where this state lived at the always-mounted panel level.
const PERSISTED_UI_STATE = {};
function usePersistentState(nsKey, name, initial) {
    const ns = PERSISTED_UI_STATE[nsKey] || (PERSISTED_UI_STATE[nsKey] = {});
    const [value, setValue] = useState(name in ns ? ns[name] : initial);
    const set = (updater) => {
        setValue(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            ns[name] = next;
            return next;
        });
    };
    return [value, set];
}

// Convert HTML to plain text (for descriptions / copyright)
export function toPlainText(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || '';
    return text.replace(/\u00A0/g, ' ').trim();
}

// ---------- map-side helpers (namespace-aware) ----------

function setLayerTypeOpacity(map, mapLayer, newOpacity) {
    if (mapLayer.type === 'raster') {
        map.setPaintProperty(mapLayer.id, 'raster-opacity', newOpacity);
    } else if (mapLayer.type === 'fill') {
        map.setPaintProperty(mapLayer.id, 'fill-opacity', newOpacity);
    } else if (mapLayer.type === 'line') {
        map.setPaintProperty(mapLayer.id, 'line-opacity', newOpacity);
    } else if (mapLayer.type === 'circle') {
        map.setPaintProperty(mapLayer.id, 'circle-opacity', newOpacity);
    }
}

// All mapbox layers belonging to a service in the given namespace.
function getMapLayersForService(map, mapKey) {
    const style = map.getStyle();
    if (!style || !Array.isArray(style.layers)) return [];
    return style.layers.filter(l =>
        l.id.startsWith(`arcgis-raster-layer-${mapKey}-`) ||
        l.id.startsWith(`arcgis-vector-layer-${mapKey}-`)
    );
}

// All mapbox layers rendering one specific ArcGIS layer (incl. sublayer /
// outline / circle variants).
function getMapLayersForArcgisLayer(map, mapKey, arcgisLayerId) {
    const style = map.getStyle();
    if (!style || !Array.isArray(style.layers)) return [];
    const bases = [
        `arcgis-raster-layer-${mapKey}-${arcgisLayerId}`,
        `arcgis-vector-layer-${mapKey}-${arcgisLayerId}`,
    ];
    return style.layers.filter(l =>
        bases.some(b => l.id === b || l.id.startsWith(`${b}-`))
    );
}

function applyServiceOpacityOnMap(map, mapKey, newOpacity) {
    getMapLayersForService(map, mapKey).forEach(l => setLayerTypeOpacity(map, l, newOpacity));
}

function applyLayerOpacityOnMap(map, mapKey, arcgisLayerId, newOpacity) {
    getMapLayersForArcgisLayer(map, mapKey, arcgisLayerId).forEach(l => setLayerTypeOpacity(map, l, newOpacity));
}

function applyLayerZoomRangeOnMap(map, mapKey, arcgisLayerId, minZoom, maxZoom) {
    getMapLayersForArcgisLayer(map, mapKey, arcgisLayerId).forEach(l => {
        map.setLayerZoomRange(l.id, minZoom, maxZoom);
    });
}

// Swap the layerDefs param on an export tile URL (string manipulation — the
// URL contains the literal {bbox-epsg-3857} template, so the URL API would
// break it by percent-encoding the braces).
function withLayerDefs(tileUrl, arcgisLayerId, whereClause) {
    let url = tileUrl.replace(/&layerDefs=[^&]*/, '');
    if (whereClause && whereClause !== '1=1') {
        url += `&layerDefs=${encodeURIComponent(JSON.stringify({ [arcgisLayerId]: whereClause }))}`;
    }
    return url;
}

// Apply a where-clause filter to the raster tiles of a layer by re-creating
// its sources with an ArcGIS `layerDefs` export param, so the server only
// renders matching features. Pass '1=1' (or null) to clear.
function applyLayerRasterFilterOnMap(map, mapKey, arcgisLayerId, whereClause) {
    const style = map.getStyle();
    if (!style || !Array.isArray(style.layers)) return;
    const layerBase = `arcgis-raster-layer-${mapKey}-${arcgisLayerId}`;
    style.layers
        .filter(l => l.id === layerBase || l.id.startsWith(`${layerBase}-`))
        .forEach(mapLayer => {
            const sourceId = mapLayer.source;
            const sourceDef = style.sources?.[sourceId];
            if (!map.getLayer(mapLayer.id) || !map.getSource(sourceId)) return;
            if (!sourceDef || sourceDef.type !== 'raster' || !Array.isArray(sourceDef.tiles) || sourceDef.tiles.length === 0) return;

            const newTiles = sourceDef.tiles.map(t => withLayerDefs(t, arcgisLayerId, whereClause));
            if (newTiles.every((t, i) => t === sourceDef.tiles[i])) return; // no change

            const layerId = mapLayer.id;
            const opacity = map.getPaintProperty(layerId, 'raster-opacity');
            map.removeLayer(layerId);
            map.removeSource(sourceId);
            map.addSource(sourceId, { ...sourceDef, tiles: newTiles });
            const layerSpec = { id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': opacity ?? 1 } };
            if (mapLayer.minzoom != null) layerSpec.minzoom = mapLayer.minzoom;
            if (mapLayer.maxzoom != null) layerSpec.maxzoom = mapLayer.maxzoom;
            map.addLayer(layerSpec);
        });
}

// Re-create the raster sources of a service with a time-range parameter.
// timeRange = { startMs, endMs } or null to clear.
function applyServiceTimeFilterOnMap(map, mapKey, service, timeRange, fallbackOpacity) {
    const style = map.getStyle();
    if (!style || !Array.isArray(style.layers) || !service?.url) return;

    const sourcePrefix = `arcgis-raster-${mapKey}-`;
    const layerPrefix = `arcgis-raster-layer-${mapKey}-`;

    style.layers
        .filter(l => l.id.startsWith(layerPrefix))
        .forEach(mapLayer => {
            const layerId = mapLayer.id;
            const sourceId = mapLayer.source;
            if (!map.getLayer(layerId) || !map.getSource(sourceId)) return;

            // Extract ArcGIS numeric layer id from source id, e.g. "arcgis-raster-svc-5" → 5
            const suffix = sourceId.slice(sourcePrefix.length); // "5" or "5-sub-0"
            const arcgisLayerId = parseInt(suffix.split('-')[0], 10);
            if (isNaN(arcgisLayerId)) return;

            const opacity = map.getPaintProperty(layerId, 'raster-opacity') ?? fallbackOpacity;
            // Preserve any active layerDefs (field filter) from the old tile URL
            const oldTile = (style.sources?.[sourceId]?.tiles || [])[0] || '';
            const layerDefsMatch = oldTile.match(/&layerDefs=[^&]*/);
            const newTile = getArcgisTileUrl(service.url, [arcgisLayerId], timeRange) + (layerDefsMatch ? layerDefsMatch[0] : '');
            map.removeLayer(layerId);
            map.removeSource(sourceId);
            map.addSource(sourceId, {
                type: 'raster',
                tiles: [newTile],
                tileSize: 256,
                minzoom: 6,
                maxzoom: 12
            });
            map.addLayer({ id: layerId, type: 'raster', source: sourceId, minzoom: 6, paint: { 'raster-opacity': opacity } });
        });
}

const SAVE_BTN_STYLE = {
    padding: '6px 10px',
    backgroundColor: '#1976d2',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    whiteSpace: 'nowrap',
};

// Centered confirmation modal shown after a successful save (auto-dismisses).
function SaveSuccessModal({ message, onClose }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 2600);
        return () => clearTimeout(timer);
    }, [onClose]);
    return createPortal(
        <div className="arcgis-save-success-overlay" onClick={onClose}>
            <div className="arcgis-save-success-modal" role="alertdialog" onClick={e => e.stopPropagation()}>
                <FontAwesomeIcon icon={faCircleCheck} className="arcgis-save-success-icon" />
                <div className="arcgis-save-success-text">{message}</div>
                <button type="button" className="arcgis-save-success-btn" onClick={onClose}>OK</button>
            </div>
        </div>,
        document.body
    );
}

// =====================================================================
// Service Info Modal
// =====================================================================
export function ServiceInfoModal({
    serviceKey,          // open service key, or null when closed
    service,             // resolved service object ({ key, label, url }) or null
    info,                // fetched service info (may be undefined/empty)
    loading,
    getStyle,            // () => positioning style
    onboardingPrefix,    // 'arcgis' | 'custom-layers'
    onClose,
    mapInstance,         // () => mapboxgl.Map
    mapKeyPrefix = '',   // '' | 'custom-'
    defaultOpacity,      // panel-level fallback opacity
    renderLayerLinks,    // (service) => node
    onSave,              // save the current service to custom layers
    onTimeFilterApplied, // optional (serviceKey, timeRangeOrNull) bookkeeping callback
}) {
    // Per-service UI state (persists across open/close via module cache)
    const [opacityByKey, setOpacityByKey] = usePersistentState(onboardingPrefix, 'serviceOpacityByKey', {});
    const [timeTabByKey, setTimeTabByKey] = usePersistentState(onboardingPrefix, 'timeTabByKey', {});
    const [timeInputByKey, setTimeInputByKey] = usePersistentState(onboardingPrefix, 'timeInputByKey', {});
    const [timelineByKey, setTimelineByKey] = usePersistentState(onboardingPrefix, 'timelineByKey', {});
    const [timeFilterByKey, setTimeFilterByKey] = usePersistentState(onboardingPrefix, 'timeFilterByKey', {});
    const [saveSuccessMsg, setSaveSuccessMsg] = useState(null);

    if (!serviceKey) return null;

    const mapKey = `${mapKeyPrefix}${serviceKey}`;
    const getMap = () => (mapInstance && mapInstance());

    // onSave resolves to a success message string (or falsy on failure)
    const handleSaveClick = async () => {
        const msg = await onSave?.();
        if (msg) setSaveSuccessMsg(typeof msg === 'string' ? msg : 'Saved to Custom Layers');
    };

    const applyTimeFilter = (timeRange) => {
        setTimeFilterByKey(prev => ({ ...prev, [serviceKey]: timeRange || null }));
        const map = getMap();
        if (map && map.getStyle) {
            applyServiceTimeFilterOnMap(map, mapKey, service, timeRange, defaultOpacity);
        }
        onTimeFilterApplied?.(serviceKey, timeRange || null);
    };

    const currentOpacity = opacityByKey[serviceKey] ?? defaultOpacity;

    const renderActions = (targetSuffix) => service && service.url && (
        <div data-onboarding-target={`${onboardingPrefix}-service-info-${targetSuffix}`} style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #ddd' }}>
            <button
                type="button"
                className="arcgis-service-info-save-btn"
                onClick={handleSaveClick}
                title="Save this service to Custom Layers"
                style={{ ...SAVE_BTN_STYLE, marginBottom: '12px' }}
            >
                <FontAwesomeIcon icon={faFloppyDisk} style={{ fontSize: '12px' }} />
                Save Service
            </button>
            <a
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#1976d2', textDecoration: 'none', fontSize: '13px' }}
            >
                View ArcGIS Service Page →
            </a>
        </div>
    );

    return (
        <div className="arcgis-service-info-modal" style={getStyle()} data-onboarding-target={`${onboardingPrefix}-service-info-modal`}>
            {saveSuccessMsg && <SaveSuccessModal message={saveSuccessMsg} onClose={() => setSaveSuccessMsg(null)} />}
            <div className="arcgis-service-info-modal-header">
                <strong>Service info</strong>
                <button
                    className="arcgis-service-info-modal-close"
                    onClick={onClose}
                    aria-label="Close"
                >
                    &times;
                </button>
            </div>
            <div className="arcgis-service-info-modal-content">
                {loading && <div>Loading service info…</div>}
                {!loading && (() => {
                    const serviceInfo = info || {};

                    if (!serviceInfo || Object.keys(serviceInfo).length === 0) {
                        return (
                            <div>
                                <div className="arcgis-service-info-empty">No information available.</div>
                                {renderActions('empty-actions')}
                            </div>
                        );
                    }

                    const sr = serviceInfo.spatialReference || {};
                    const srText = sr.latestWkid
                        ? `WKID ${sr.latestWkid}`
                        : (sr.wkid ? `WKID ${sr.wkid}` : (sr.wkt ? 'WKT' : '—'));

                    return (
                        <div>
                            <div className="arcgis-service-info-row">
                                <strong>Service Name:</strong> {(service && service.label) || serviceInfo.mapName || serviceInfo.name || '—'}
                            </div>
                            {serviceInfo.serviceDescription || serviceInfo.description ? (
                                <div className="arcgis-service-info-row">
                                    <strong>Service Description:</strong>
                                    <div className="arcgis-service-info-description">
                                        {toPlainText(serviceInfo.serviceDescription || serviceInfo.description)}
                                    </div>
                                </div>
                            ) : null}
                            <div className="arcgis-service-info-row">
                                <strong>Service Item Id:</strong> {serviceInfo.serviceItemId || serviceInfo.itemId || '—'}
                            </div>
                            <div className="arcgis-service-info-row">
                                <strong>Copyright Text:</strong> {toPlainText(serviceInfo.copyrightText) || '—'}
                            </div>
                            <div className="arcgis-service-info-row">
                                <strong>Spatial Reference:</strong> {srText}
                            </div>

                            <div className="arcgis-service-info-row service-info-opacity-row" data-onboarding-target={`${onboardingPrefix}-service-info-opacity`}>
                                <strong>Service Opacity:</strong>
                                <div className="service-info-opacity-controls">
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentOpacity}
                                        onChange={(e) => {
                                            const value = parseFloat(e.target.value);
                                            setOpacityByKey(prev => ({ ...prev, [serviceKey]: value }));
                                            const map = getMap();
                                            if (map && map.getStyle) applyServiceOpacityOnMap(map, mapKey, value);
                                        }}
                                        className="service-info-opacity-slider"
                                        style={{ background: `linear-gradient(to right, #27425d ${currentOpacity * 100}%, #d8e1ea ${currentOpacity * 100}%)` }}
                                    />
                                    <span className="service-info-opacity-value">{Math.round(currentOpacity * 100)}%</span>
                                </div>
                            </div>

                            {service && (() => {
                                const sKey = serviceKey;
                                const activeTab = timeTabByKey[sKey] || 'range';
                                const tl = timelineByKey[sKey] || {};
                                const nowYear = new Date().getFullYear();
                                const yearValues = Array.from(
                                    { length: nowYear - EARLIEST_TIMELINE_YEAR + 1 },
                                    (_, i) => EARLIEST_TIMELINE_YEAR + i
                                );
                                const tlYear = tl.year != null ? tl.year : null;
                                const tlMonth = tl.month != null ? tl.month : null; // 1-based
                                const yearForSlider = tlYear != null ? tlYear : nowYear;
                                const monthForSlider = tlMonth != null ? tlMonth : 1;
                                const yearSpan = Math.max(1, nowYear - EARLIEST_TIMELINE_YEAR);
                                const yearPointerPct = ((yearForSlider - EARLIEST_TIMELINE_YEAR) / yearSpan) * 100;
                                const monthPointerPct = ((monthForSlider - 1) / 11) * 100;

                                const applyTimeline = (year, month) => {
                                    if (year == null) { applyTimeFilter(null); return; }
                                    const startMs = month != null
                                        ? new Date(year, month - 1, 1).getTime()
                                        : new Date(year, 0, 1).getTime();
                                    const endMs = month != null
                                        ? new Date(year, month, 0, 23, 59, 59).getTime()
                                        : new Date(year, 11, 31, 23, 59, 59).getTime();
                                    applyTimeFilter({ startMs, endMs });
                                };

                                const startTimelineIconDrag = (startEvent, wrapEl, min, max, onValue) => {
                                    if (!wrapEl) return;

                                    const clamp = (val, low, high) => Math.min(high, Math.max(low, val));
                                    const resolveClientX = (evt) => {
                                        if (evt.touches && evt.touches.length > 0) return evt.touches[0].clientX;
                                        if (evt.changedTouches && evt.changedTouches.length > 0) return evt.changedTouches[0].clientX;
                                        return evt.clientX;
                                    };

                                    const updateFromClientX = (clientX) => {
                                        const rect = wrapEl.getBoundingClientRect();
                                        if (!rect.width) return;
                                        const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
                                        const nextValue = Math.round(min + ratio * (max - min));
                                        onValue(clamp(nextValue, min, max));
                                    };

                                    const onMouseMove = (moveEvent) => {
                                        moveEvent.preventDefault();
                                        updateFromClientX(resolveClientX(moveEvent));
                                    };

                                    const onTouchMove = (moveEvent) => {
                                        moveEvent.preventDefault();
                                        updateFromClientX(resolveClientX(moveEvent));
                                    };

                                    const stopDrag = () => {
                                        window.removeEventListener('mousemove', onMouseMove);
                                        window.removeEventListener('mouseup', stopDrag);
                                        window.removeEventListener('touchmove', onTouchMove);
                                        window.removeEventListener('touchend', stopDrag);
                                    };

                                    updateFromClientX(resolveClientX(startEvent));

                                    window.addEventListener('mousemove', onMouseMove);
                                    window.addEventListener('mouseup', stopDrag);
                                    window.addEventListener('touchmove', onTouchMove, { passive: false });
                                    window.addEventListener('touchend', stopDrag);
                                };

                                const setTimelineValue = (year, month) => {
                                    setTimelineByKey(prev => ({
                                        ...prev,
                                        [sKey]: { ...(prev[sKey] || {}), year, ...(month != null ? { month } : {}) }
                                    }));
                                };

                                return (
                                    <div className="arcgis-service-info-row" data-onboarding-target={`${onboardingPrefix}-service-info-time-filter`}>
                                        <strong>Historical View:</strong>
                                        <div className="service-info-time-filter">
                                            {/* ── Tabs ── */}
                                            <div className="service-info-time-tabs">
                                                <button
                                                    className={`service-info-time-tab${activeTab === 'range' ? ' active' : ''}`}
                                                    onClick={() => setTimeTabByKey(prev => ({ ...prev, [sKey]: 'range' }))}
                                                >Date Range</button>
                                                <button
                                                    className={`service-info-time-tab${activeTab === 'timeline' ? ' active' : ''}`}
                                                    onClick={() => setTimeTabByKey(prev => ({ ...prev, [sKey]: 'timeline' }))}
                                                >Timeline</button>
                                            </div>

                                            {/* ── Date Range tab ── */}
                                            {activeTab === 'range' && (<>
                                                <div className="service-info-time-row">
                                                    <label className="service-info-time-label">From</label>
                                                    <input
                                                        type="date"
                                                        className="service-info-time-input"
                                                        value={(timeInputByKey[sKey] || {}).startDate || ''}
                                                        onChange={e => setTimeInputByKey(prev => ({
                                                            ...prev,
                                                            [sKey]: { ...(prev[sKey] || {}), startDate: e.target.value }
                                                        }))}
                                                    />
                                                    <label className="service-info-time-label">To</label>
                                                    <input
                                                        type="date"
                                                        className="service-info-time-input"
                                                        value={(timeInputByKey[sKey] || {}).endDate || ''}
                                                        onChange={e => setTimeInputByKey(prev => ({
                                                            ...prev,
                                                            [sKey]: { ...(prev[sKey] || {}), endDate: e.target.value }
                                                        }))}
                                                    />
                                                </div>
                                                <div className="service-info-time-actions">
                                                    <button
                                                        className="service-info-time-btn"
                                                        onClick={() => {
                                                            const inp = timeInputByKey[sKey] || {};
                                                            if (!inp.startDate || !inp.endDate) return;
                                                            const startMs = new Date(inp.startDate).getTime();
                                                            const endMs = new Date(inp.endDate + 'T23:59:59').getTime();
                                                            if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) return;
                                                            applyTimeFilter({ startMs, endMs });
                                                        }}
                                                    >Apply</button>
                                                    <button
                                                        className="service-info-time-btn service-info-time-btn-clear"
                                                        onClick={() => {
                                                            setTimeInputByKey(prev => ({ ...prev, [sKey]: {} }));
                                                            applyTimeFilter(null);
                                                        }}
                                                    >Clear</button>
                                                </div>
                                            </>)}

                                            {/* ── Timeline tab ── */}
                                            {activeTab === 'timeline' && (
                                                <div className="service-info-timeline">
                                                    {/* Year slider */}
                                                    <div className="service-info-timeline-row">
                                                        <span className="service-info-timeline-label">Year</span>
                                                        <div className="service-info-timeline-slider-wrap">
                                                            <input
                                                                type="range"
                                                                className="service-info-timeline-slider"
                                                                min={EARLIEST_TIMELINE_YEAR}
                                                                max={nowYear}
                                                                step={1}
                                                                value={yearForSlider}
                                                                onChange={e => {
                                                                    const y = parseInt(e.target.value, 10);
                                                                    setTimelineValue(y);
                                                                    applyTimeline(y, tlMonth);
                                                                }}
                                                                style={{
                                                                    background: `linear-gradient(to right, #27425d ${yearPointerPct}%, #d8e1ea ${yearPointerPct}%)`
                                                                }}
                                                            />
                                                            <span
                                                                className="service-info-timeline-handle-icon"
                                                                style={{ left: `calc(${yearPointerPct}% - 6px)` }}
                                                                onMouseDown={(e) => {
                                                                    e.preventDefault();
                                                                    startTimelineIconDrag(
                                                                        e,
                                                                        e.currentTarget.closest('.service-info-timeline-slider-wrap'),
                                                                        EARLIEST_TIMELINE_YEAR,
                                                                        nowYear,
                                                                        (y) => { setTimelineValue(y); applyTimeline(y, tlMonth); }
                                                                    );
                                                                }}
                                                                onTouchStart={(e) => {
                                                                    e.preventDefault();
                                                                    startTimelineIconDrag(
                                                                        e,
                                                                        e.currentTarget.closest('.service-info-timeline-slider-wrap'),
                                                                        EARLIEST_TIMELINE_YEAR,
                                                                        nowYear,
                                                                        (y) => { setTimelineValue(y); applyTimeline(y, tlMonth); }
                                                                    );
                                                                }}
                                                                aria-hidden="true"
                                                            >
                                                                <FontAwesomeIcon icon={faSquare} />
                                                            </span>
                                                        </div>
                                                        <span className="service-info-timeline-value">{tlYear != null ? tlYear : nowYear}</span>
                                                    </div>
                                                    <div
                                                        className="service-info-timeline-ticks"
                                                        style={{ gridTemplateColumns: `repeat(${yearValues.length}, minmax(0, 1fr))` }}
                                                        aria-hidden="true"
                                                    >
                                                        {yearValues.map(y => (
                                                            <span key={`year-tick-${y}`} className="service-info-timeline-tick" />
                                                        ))}
                                                    </div>
                                                    <div
                                                        className="service-info-timeline-year-labels"
                                                        style={{ gridTemplateColumns: `repeat(${yearValues.length}, minmax(0, 1fr))` }}
                                                    >
                                                        {yearValues.map(y => (
                                                            <span key={`year-label-${y}`}>
                                                                {(y === EARLIEST_TIMELINE_YEAR || y % 5 === 0) ? y : ''}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    {/* Month slider — always visible once in timeline tab */}
                                                    <div className="service-info-timeline-row" style={{ marginTop: 8 }}>
                                                        <span className="service-info-timeline-label">Month</span>
                                                        <div className="service-info-timeline-slider-wrap">
                                                            <input
                                                                type="range"
                                                                className="service-info-timeline-slider"
                                                                min={1}
                                                                max={12}
                                                                step={1}
                                                                value={monthForSlider}
                                                                onChange={e => {
                                                                    const m = parseInt(e.target.value, 10);
                                                                    const y = tlYear != null ? tlYear : nowYear;
                                                                    setTimelineValue(y, m);
                                                                    applyTimeline(y, m);
                                                                }}
                                                                style={{
                                                                    background: `linear-gradient(to right, #27425d ${monthPointerPct}%, #d8e1ea ${monthPointerPct}%)`
                                                                }}
                                                            />
                                                            <span
                                                                className="service-info-timeline-handle-icon"
                                                                style={{ left: `calc(${monthPointerPct}% - 6px)` }}
                                                                onMouseDown={(e) => {
                                                                    e.preventDefault();
                                                                    startTimelineIconDrag(
                                                                        e,
                                                                        e.currentTarget.closest('.service-info-timeline-slider-wrap'),
                                                                        1,
                                                                        12,
                                                                        (m) => {
                                                                            const y = tlYear != null ? tlYear : nowYear;
                                                                            setTimelineValue(y, m);
                                                                            applyTimeline(y, m);
                                                                        }
                                                                    );
                                                                }}
                                                                onTouchStart={(e) => {
                                                                    e.preventDefault();
                                                                    startTimelineIconDrag(
                                                                        e,
                                                                        e.currentTarget.closest('.service-info-timeline-slider-wrap'),
                                                                        1,
                                                                        12,
                                                                        (m) => {
                                                                            const y = tlYear != null ? tlYear : nowYear;
                                                                            setTimelineValue(y, m);
                                                                            applyTimeline(y, m);
                                                                        }
                                                                    );
                                                                }}
                                                                aria-hidden="true"
                                                            >
                                                                <FontAwesomeIcon icon={faSquare} />
                                                            </span>
                                                        </div>
                                                        <span className="service-info-timeline-value">{tlMonth != null ? tlMonth : 1}</span>
                                                    </div>
                                                    <div className="service-info-timeline-months">
                                                        {MONTH_VALUES.map((m, i) => (
                                                            <div key={m} className="service-info-timeline-month-item" style={{ left: `calc(${i} / 11 * 100%)` }}>
                                                                <div className="service-info-timeline-month-tick" />
                                                                <span className="service-info-timeline-month-label">{m}</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="service-info-time-actions" style={{ marginTop: 6 }}>
                                                        <button
                                                            className="service-info-time-btn service-info-time-btn-clear"
                                                            onClick={() => {
                                                                setTimelineByKey(prev => ({ ...prev, [sKey]: {} }));
                                                                applyTimeFilter(null);
                                                            }}
                                                        >Clear</button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* ── Shared active-filter indicator ── */}
                                            {timeFilterByKey[sKey] && (
                                                <div className="service-info-time-active">
                                                    Time filter active: {new Date(timeFilterByKey[sKey].startMs).toLocaleDateString()} – {new Date(timeFilterByKey[sKey].endMs).toLocaleDateString()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {service && (
                                <div className="arcgis-service-info-row" data-onboarding-target={`${onboardingPrefix}-service-info-layer-links`}>
                                    <strong>Layers / Sublayers:</strong>
                                    {renderLayerLinks(service)}
                                </div>
                            )}

                            {renderActions('actions')}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}

// =====================================================================
// Layer Info Modal
// =====================================================================
export function LayerInfoModal({
    layerInfo,           // { serviceKey, layerId, layerName, serviceUrl, service } or null
    info,                // fetched layer info
    loading,
    getStyle,
    onboardingPrefix,    // 'arcgis' | 'custom-layers'
    onClose,
    mapInstance,
    mapKeyPrefix = '',
    defaultOpacity,
    rawLayers,           // serviceLayers[serviceKey] || []
    legend,              // serviceLegends[serviceKey]
    onOpenLayerInfo,     // (service, { id, name }) parent/child navigation
    onSave,              // save this layer to custom layers
    showMessage,         // (text) status message callback
}) {
    // Per-layer UI state (persists across open/close via module cache)
    const [opacityByKey, setOpacityByKey] = usePersistentState(onboardingPrefix, 'layerOpacityByKey', {});
    const [zoomRangeByKey, setZoomRangeByKey] = usePersistentState(onboardingPrefix, 'layerZoomRangeByKey', {});
    const [layerFilter, setLayerFilter] = useState(null);
    const [saveSuccessMsg, setSaveSuccessMsg] = useState(null);

    // Reset the filter inputs whenever the target layer changes / modal closes
    const filterResetKey = layerInfo ? `${layerInfo.serviceKey}-${layerInfo.layerId}` : null;
    useEffect(() => {
        setLayerFilter(null);
    }, [filterResetKey]);

    if (!layerInfo) return null;

    const cacheKey = `${layerInfo.serviceKey}-${layerInfo.layerId}`;
    const mapKey = `${mapKeyPrefix}${layerInfo.serviceKey}`;
    const getMap = () => (mapInstance && mapInstance());

    // onSave resolves to a success message string (or falsy on failure)
    const handleSaveClick = async () => {
        const msg = await onSave?.();
        if (msg) setSaveSuccessMsg(typeof msg === 'string' ? msg : 'Saved to Custom Layers');
    };

    // Download the layer's raster image (ArcGIS export) for the current map view
    const handleDownloadLayerImage = async () => {
        const map = getMap();
        if (!map) return;
        const bounds = map.getBounds();
        const container = map.getContainer();
        const width = Math.min(2048, container?.clientWidth || 1024);
        const height = Math.min(2048, container?.clientHeight || 768);
        const params = new URLSearchParams({
            bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
            bboxSR: '4326',
            imageSR: '3857',
            size: `${width},${height}`,
            layers: `show:${layerInfo.layerId}`,
            format: 'png32',
            transparent: 'true',
            f: 'image',
        });
        const exportUrl = `${layerInfo.serviceUrl}/export?${params.toString()}`;
        try {
            const res = await fetch(exportUrl);
            if (!res.ok) throw new Error(`Export request failed: ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(layerInfo.layerName || 'layer').replace(/[\\/:*?"<>|]+/g, '_')}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.warn('[ArcgisInfoModals] Layer image download failed, opening in new tab:', err);
            window.open(exportUrl, '_blank', 'noopener');
        }
    };

    return (
        <div className="arcgis-service-info-modal" style={getStyle()} data-onboarding-target={`${onboardingPrefix}-layer-info-modal`}>
            {saveSuccessMsg && <SaveSuccessModal message={saveSuccessMsg} onClose={() => setSaveSuccessMsg(null)} />}
            <div className="arcgis-service-info-modal-header">
                <strong>Layer Info: {layerInfo.layerName}</strong>
                <button
                    className="arcgis-service-info-modal-close"
                    onClick={onClose}
                    aria-label="Close"
                >
                    &times;
                </button>
            </div>
            <div className="arcgis-service-info-modal-content">
                {loading && <div>Loading layer info…</div>}
                {!loading && (() => {
                    const layerData = info;

                    if (!layerData || Object.keys(layerData).length === 0) {
                        return (
                            <div>
                                <div className="arcgis-service-info-empty">No layer information available.</div>
                                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #ddd' }}>
                                    <a
                                        href={`${layerInfo.serviceUrl}/${layerInfo.layerId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#1976d2', textDecoration: 'none' }}
                                    >
                                        View ArcGIS Layer Page →
                                    </a>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div>
                            {/* Display various layer info fields if they exist */}
                            {layerData.description && (
                                <div className="arcgis-service-info-row">
                                    <strong>Description:</strong>
                                    <div className="arcgis-service-info-description">
                                        {toPlainText(layerData.description)}
                                    </div>
                                </div>
                            )}

                            {layerData.name && (
                                <div className="arcgis-service-info-row">
                                    <strong>Layer Name:</strong> {layerData.name}
                                </div>
                            )}

                            {layerData.type && (
                                <div className="arcgis-service-info-row">
                                    <strong>Geometry Type:</strong> {layerData.type}
                                </div>
                            )}

                            {layerData.copyrightText && (
                                <div className="arcgis-service-info-row">
                                    <strong>Copyright Text:</strong> {toPlainText(layerData.copyrightText)}
                                </div>
                            )}

                            {layerData.minScale && (
                                <div className="arcgis-service-info-row">
                                    <strong>Min Scale:</strong> {layerData.minScale.toLocaleString()}
                                </div>
                            )}

                            {layerData.maxScale && (
                                <div className="arcgis-service-info-row">
                                    <strong>Max Scale:</strong> {layerData.maxScale.toLocaleString()}
                                </div>
                            )}

                            {layerData.defaultVisibility !== undefined && (
                                <div className="arcgis-service-info-row">
                                    <strong>Default Visibility:</strong> {layerData.defaultVisibility ? 'Visible' : 'Hidden'}
                                </div>
                            )}

                            {layerData.hasAttachments !== undefined && (
                                <div className="arcgis-service-info-row">
                                    <strong>Has Attachments:</strong> {layerData.hasAttachments ? 'Yes' : 'No'}
                                </div>
                            )}

                            {layerData.fields && layerData.fields.length > 0 && (
                                <div className="arcgis-service-info-row">
                                    <strong>Fields:</strong> {layerData.fields.length} field(s)
                                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                        {layerData.fields.slice(0, 5).map(field => field.name).join(', ')}
                                        {layerData.fields.length > 5 && '...'}
                                    </div>
                                </div>
                            )}

                            {/* Legend display */}
                            {(() => {
                                if (legend && legend.layers) {
                                    const legendLayer = legend.layers.find(l => l.layerId === layerInfo.layerId);
                                    if (legendLayer && legendLayer.legend && legendLayer.legend.length > 0) {
                                        return (
                                            <div className="arcgis-service-info-row">
                                                <strong>Legend:</strong>
                                                <div style={{ marginTop: '8px', paddingLeft: '12px' }}>
                                                    {legendLayer.legend.map((item, idx) => (
                                                        <div key={idx} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            {item.imageData && (
                                                                <img src={`data:image/png;base64,${item.imageData}`} alt={item.label} style={{ width: '20px', height: '20px' }} />
                                                            )}
                                                            <span style={{ fontSize: '13px' }}>{item.label || item.value || 'N/A'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    }
                                }
                                return null;
                            })()}

                            {/* Parent layer link */}
                            {layerData.parentLayerId !== undefined && layerData.parentLayerId !== -1 && (() => {
                                const parentLayer = (rawLayers || []).find(l => l.id === layerData.parentLayerId);
                                if (parentLayer) {
                                    return (
                                        <div className="arcgis-service-info-row">
                                            <strong>Parent Layer:</strong>
                                            <button
                                                type="button"
                                                className="arcgis-service-info-layer-link"
                                                onClick={() => onOpenLayerInfo(layerInfo.service, { id: parentLayer.id, name: parentLayer.name })}
                                                style={{ marginLeft: '8px' }}
                                            >
                                                {parentLayer.name}
                                            </button>
                                        </div>
                                    );
                                }
                                return null;
                            })()}

                            {/* Child layers links */}
                            {(() => {
                                const layers = rawLayers || [];
                                const childFromIds = Array.isArray(layerData.subLayerIds)
                                    ? layerData.subLayerIds
                                        .map(id => layers.find(l => l.id === id) || { id, name: `Layer ${id}` })
                                    : [];
                                const childFromSubLayers = Array.isArray(layerData.subLayers)
                                    ? layerData.subLayers
                                        .map(sl => {
                                            const subId = sl?.id;
                                            if (subId === undefined || subId === null) return null;
                                            return layers.find(l => l.id === subId) || { id: subId, name: sl?.name || `Layer ${subId}` };
                                        })
                                        .filter(Boolean)
                                    : [];
                                const dedupMap = new Map();
                                [...childFromIds, ...childFromSubLayers].forEach((layer) => {
                                    dedupMap.set(layer.id, layer);
                                });
                                const childLayers = Array.from(dedupMap.values());

                                if (childLayers.length > 0) {
                                    return (
                                        <div className="arcgis-service-info-row">
                                            <strong>Child Layers:</strong>
                                            <div style={{ marginTop: '8px', paddingLeft: '12px', maxHeight: '180px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '4px', padding: '8px 8px 2px 12px' }}>
                                                {childLayers.map(child => (
                                                    <div key={child.id} style={{ marginBottom: '6px' }}>
                                                        <button
                                                            type="button"
                                                            className="arcgis-service-info-layer-link"
                                                            onClick={() => onOpenLayerInfo(layerInfo.service, { id: child.id, name: child.name })}
                                                        >
                                                            {child.name}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}

                            {/* Layer opacity (same control as the service info modal, scoped to this layer) */}
                            <div className="arcgis-service-info-row service-info-opacity-row" data-onboarding-target={`${onboardingPrefix}-layer-info-opacity`}>
                                <strong>Layer Opacity:</strong>
                                <div className="service-info-opacity-controls">
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={opacityByKey[cacheKey] ?? defaultOpacity}
                                        onChange={(e) => {
                                            const value = parseFloat(e.target.value);
                                            setOpacityByKey(prev => ({ ...prev, [cacheKey]: value }));
                                            const map = getMap();
                                            if (map && map.getStyle) applyLayerOpacityOnMap(map, mapKey, layerInfo.layerId, value);
                                        }}
                                        className="service-info-opacity-slider"
                                        style={{ background: `linear-gradient(to right, #27425d ${(opacityByKey[cacheKey] ?? defaultOpacity) * 100}%, #d8e1ea ${(opacityByKey[cacheKey] ?? defaultOpacity) * 100}%)` }}
                                    />
                                    <span className="service-info-opacity-value">{Math.round((opacityByKey[cacheKey] ?? defaultOpacity) * 100)}%</span>
                                </div>
                            </div>

                            {/* Zoom visibility range (dual-handle slider: min & max zoom level) */}
                            {(() => {
                                const zr = zoomRangeByKey[cacheKey] || { min: 6, max: 22 };
                                const minPct = (zr.min / 22) * 100;
                                const maxPct = (zr.max / 22) * 100;
                                const setZoomRange = (next) => {
                                    setZoomRangeByKey(prev => ({ ...prev, [cacheKey]: next }));
                                    const map = getMap();
                                    if (map && map.getStyle) applyLayerZoomRangeOnMap(map, mapKey, layerInfo.layerId, next.min, next.max);
                                };
                                return (
                                    <div className="arcgis-service-info-row service-info-opacity-row" data-onboarding-target={`${onboardingPrefix}-layer-info-zoom-range`}>
                                        <strong>Zoom Range:</strong>
                                        <div className="layer-info-zoom-controls">
                                            <div className="layer-info-zoom-track-wrap">
                                                <div className="layer-info-zoom-track" />
                                                <div
                                                    className="layer-info-zoom-track-fill"
                                                    style={{ left: `${minPct}%`, width: `${Math.max(0, maxPct - minPct)}%` }}
                                                />
                                                <input
                                                    type="range"
                                                    className="layer-info-zoom-input"
                                                    min="0"
                                                    max="22"
                                                    step="1"
                                                    value={zr.min}
                                                    onChange={(e) => {
                                                        const v = Math.min(parseInt(e.target.value, 10), zr.max);
                                                        setZoomRange({ min: v, max: zr.max });
                                                    }}
                                                    aria-label="Minimum zoom level"
                                                />
                                                <input
                                                    type="range"
                                                    className="layer-info-zoom-input"
                                                    min="0"
                                                    max="22"
                                                    step="1"
                                                    value={zr.max}
                                                    onChange={(e) => {
                                                        const v = Math.max(parseInt(e.target.value, 10), zr.min);
                                                        setZoomRange({ min: zr.min, max: v });
                                                    }}
                                                    aria-label="Maximum zoom level"
                                                />
                                            </div>
                                            <span className="layer-info-zoom-value">z{zr.min}–z{zr.max}</span>
                                        </div>
                                        <div className="layer-info-zoom-hint">Layer is only shown between the min and max zoom levels.</div>
                                    </div>
                                );
                            })()}

                            {/* Filter UI */}
                            {layerData.fields && layerData.fields.length > 0 && (
                                <div className="arcgis-service-info-row" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #ddd' }} data-onboarding-target={`${onboardingPrefix}-layer-info-filter`}>
                                    <strong>Filter by Field:</strong>
                                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {/* Field selector */}
                                        <select
                                            value={layerFilter?.field || ''}
                                            onChange={(e) => setLayerFilter({ ...layerFilter, field: e.target.value })}
                                            style={{
                                                padding: '6px 8px',
                                                borderRadius: '4px',
                                                border: '1px solid #ddd',
                                                fontSize: '13px',
                                                fontFamily: 'inherit'
                                            }}
                                        >
                                            <option value="">Select a field...</option>
                                            {layerData.fields.map((field) => (
                                                <option key={field.name} value={field.name}>
                                                    {field.alias || field.name} ({field.type})
                                                </option>
                                            ))}
                                        </select>

                                        {/* Operator selector */}
                                        {layerFilter?.field && (
                                            <select
                                                value={layerFilter?.operator || '='}
                                                onChange={(e) => setLayerFilter({ ...layerFilter, operator: e.target.value })}
                                                style={{
                                                    padding: '6px 8px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #ddd',
                                                    fontSize: '13px',
                                                    fontFamily: 'inherit'
                                                }}
                                            >
                                                <option value="=">=</option>
                                                <option value="!=">!=</option>
                                                <option value=">">&gt;</option>
                                                <option value=">=">&gt;=</option>
                                                <option value="<">&lt;</option>
                                                <option value="<=">&lt;=</option>
                                                <option value="LIKE">LIKE</option>
                                                <option value="IN">IN</option>
                                            </select>
                                        )}

                                        {/* Value input */}
                                        {layerFilter?.field && (
                                            <input
                                                type="text"
                                                placeholder={layerFilter?.operator === 'IN' ? 'Comma-separated values' : 'Enter value...'}
                                                value={layerFilter?.value || ''}
                                                onChange={(e) => setLayerFilter({ ...layerFilter, value: e.target.value })}
                                                style={{
                                                    padding: '6px 8px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #ddd',
                                                    fontSize: '13px',
                                                    fontFamily: 'inherit'
                                                }}
                                            />
                                        )}

                                        {/* Apply/Clear buttons */}
                                        {layerFilter?.field && layerFilter?.value && (
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    type="button"
                                                    style={{
                                                        flex: 1,
                                                        padding: '6px 10px',
                                                        backgroundColor: '#28a745',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '13px',
                                                        fontWeight: '500'
                                                    }}
                                                    onClick={() => {
                                                        const field = layerFilter.field;
                                                        const operator = layerFilter.operator || '=';
                                                        let value = layerFilter.value;

                                                        // Build where clause
                                                        let whereClause = '';
                                                        if (operator === 'IN') {
                                                            const values = value.split(',').map(v => `'${v.trim()}'`).join(',');
                                                            whereClause = `${field} IN (${values})`;
                                                        } else if (operator === 'LIKE') {
                                                            whereClause = `${field} LIKE '%${value}%'`;
                                                        } else if (['<', '>', '<=', '>=', '=', '!='].includes(operator)) {
                                                            // Check if value is numeric
                                                            if (!isNaN(value) && value.trim() !== '') {
                                                                whereClause = `${field}${operator}${value}`;
                                                            } else {
                                                                whereClause = `${field}${operator}'${value}'`;
                                                            }
                                                        }

                                                        if (whereClause) {
                                                            const map = getMap();
                                                            if (map) {
                                                                applyArcgisVectorLayerFilter(
                                                                    map,
                                                                    layerInfo.serviceUrl,
                                                                    layerInfo.layerId,
                                                                    mapKey,
                                                                    whereClause
                                                                );
                                                                // Also filter the raster tiles server-side (layerDefs)
                                                                applyLayerRasterFilterOnMap(map, mapKey, layerInfo.layerId, whereClause);
                                                            }
                                                            showMessage?.(`Filter applied: ${whereClause}`);
                                                        }
                                                    }}
                                                >
                                                    Apply Filter
                                                </button>
                                                <button
                                                    type="button"
                                                    style={{
                                                        flex: 1,
                                                        padding: '6px 10px',
                                                        backgroundColor: '#6c757d',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '13px',
                                                        fontWeight: '500'
                                                    }}
                                                    onClick={() => {
                                                        // Clear filter from map layer
                                                        const map = getMap();
                                                        if (map) {
                                                            applyArcgisVectorLayerFilter(
                                                                map,
                                                                layerInfo.serviceUrl,
                                                                layerInfo.layerId,
                                                                mapKey,
                                                                '1=1'
                                                            );
                                                            // Restore unfiltered raster tiles
                                                            applyLayerRasterFilterOnMap(map, mapKey, layerInfo.layerId, null);
                                                        }
                                                        setLayerFilter(null);
                                                        showMessage?.('Filter cleared');
                                                    }}
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Link to the actual layer page, Save and Download buttons */}
                            <div data-onboarding-target={`${onboardingPrefix}-layer-info-actions`} style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #ddd' }}>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                    <button
                                        type="button"
                                        className="arcgis-service-info-save-btn"
                                        onClick={handleSaveClick}
                                        title="Save this layer to Custom Layers"
                                        style={SAVE_BTN_STYLE}
                                    >
                                        <FontAwesomeIcon icon={faFloppyDisk} style={{ fontSize: '12px' }} />
                                        Save Layer
                                    </button>
                                    {/MapServer|ImageServer/i.test(layerInfo.serviceUrl || '') && (
                                        <button
                                            type="button"
                                            className="arcgis-service-info-save-btn"
                                            onClick={handleDownloadLayerImage}
                                            title="Download this layer's raster image for the current map view"
                                            style={{ ...SAVE_BTN_STYLE, backgroundColor: '#2e7d32' }}
                                        >
                                            <FontAwesomeIcon icon={faDownload} style={{ fontSize: '12px' }} />
                                            Download Image
                                        </button>
                                    )}
                                </div>
                                <a
                                    href={`${layerInfo.serviceUrl}/${layerInfo.layerId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: '#1976d2', textDecoration: 'none', fontSize: '13px' }}
                                >
                                    View ArcGIS Layer Page →
                                </a>
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
