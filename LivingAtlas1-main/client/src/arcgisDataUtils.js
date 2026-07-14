import { fetchArcgisServicesByState, fetchServicesByStateMap } from './arcgisServicesDb';

// Cache for services by state - will be populated from backend
let servicesCache = {
    WA: [],
    ID: [],
    OR: []
};

// Cache timestamp to refresh periodically (24 hours)
let cacheTimestamp = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Initialize services cache from backend
async function initializeServicesCache() {
    const now = Date.now();
    
    // Check if cache is still valid
    if (cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
        return;
    }
    
    try {
        console.log('[arcgisDataUtils] Initializing services cache from backend...');
        const servicesByState = await fetchServicesByStateMap(['WA', 'ID', 'OR'], { type: 'MapServer' });
        
        servicesCache.WA = servicesByState.WA || [];
        servicesCache.ID = servicesByState.ID || [];
        servicesCache.OR = servicesByState.OR || [];
        
        cacheTimestamp = now;
        console.log('[arcgisDataUtils] Services cache initialized:', {
            WA: servicesCache.WA.length,
            ID: servicesCache.ID.length,
            OR: servicesCache.OR.length
        });
    } catch (error) {
        console.warn('[arcgisDataUtils] Failed to initialize services cache:', error);
        // Keep existing cache if update fails
    }
}

// Utility to get services by state (async)
export async function getServicesByState(state, type = 'MapServer') {
    await initializeServicesCache();
    const services = servicesCache[state] || [];
    return type === 'MapServer' ? services.filter(s => s.type === 'MapServer') : services;
}

// Legacy compatibility: synchronous access (returns cached data)
export const ARCGIS_SERVICES_BY_STATE = {
    get WA() { return servicesCache.WA.filter(s => s.type === 'MapServer'); },
    get ID() { return servicesCache.ID.filter(s => s.type === 'MapServer'); },
    get OR() { return servicesCache.OR.filter(s => s.type === 'MapServer'); }
};

// Utility to get service by key and state (async)
export async function getServiceByKey(state, key) {
    await initializeServicesCache();
    return servicesCache[state]?.find(s => s.key === key);
}

// Utility to refresh services cache manually
export async function refreshServicesCache() {
    cacheTimestamp = 0; // Force refresh
    await initializeServicesCache();
    return servicesCache;
}

// Fetch layers for a given service
export async function fetchArcgisLayers(serviceUrl) {
    const res = await fetch(`${serviceUrl}/layers?f=json`);
    const data = await res.json();
    return data.layers || [];
}

// Fetch legend for a given service
export async function fetchArcgisLegend(serviceUrl) {
    const res = await fetch(`${serviceUrl}/legend?f=json`);
    return res.json();
}

// Get tile URL for a given service and layer IDs
// layerDefs: optional { [layerId]: whereClause } applied server-side so the
// exported raster only renders matching features.
export function getArcgisTileUrl(serviceUrl, layerIds = [], timeRange = null, layerDefs = null) {
    let layersParam = '';
    if (layerIds.length > 0) {
        layersParam = '&layers=show:' + layerIds.join(',');
    }
    let timeParam = '';
    if (timeRange && timeRange.startMs != null && timeRange.endMs != null) {
        timeParam = `&time=${timeRange.startMs},${timeRange.endMs}`;
    }
    let layerDefsParam = '';
    if (layerDefs && Object.keys(layerDefs).length > 0) {
        layerDefsParam = `&layerDefs=${encodeURIComponent(JSON.stringify(layerDefs))}`;
    }
    return `${serviceUrl}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image${layersParam}${timeParam}${layerDefsParam}`;
}

// Fetch the service info (service root page) from ArcGIS REST (e.g. .../MapServer?f=json)
// Returns parsed JSON or empty object on error.
export async function fetchArcgisServiceInfo(serviceUrl) {
    try {
        const res = await fetch(`${serviceUrl}?f=json`);
        if (!res.ok) {
            // Try without f param as fallback
            const res2 = await fetch(serviceUrl);
            if (!res2.ok) return {};
            return await res2.json();
        }
        return await res.json();
    } catch (err) {
        console.warn('fetchArcgisServiceInfo error for', serviceUrl, err);
        return {};
    }
}

// Fetch layer info from ArcGIS REST (e.g. .../MapServer/1?f=json)
// Returns parsed JSON with layer details or empty object on error.
export async function fetchArcgisLayerInfo(serviceUrl, layerId) {
    try {
        const layerUrl = `${serviceUrl}/${layerId}`;
        const res = await fetch(`${layerUrl}?f=json`);
        if (!res.ok) {
            console.warn('fetchArcgisLayerInfo failed with status', res.status, 'for', layerUrl);
            return {};
        }
        return await res.json();
    } catch (err) {
        console.warn('fetchArcgisLayerInfo error for', serviceUrl, layerId, err);
        return {};
    }
}