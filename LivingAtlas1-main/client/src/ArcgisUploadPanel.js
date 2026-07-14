import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { addArcgisVectorLayer } from './arcgisVectorUtils';
import { showArcgisPopup } from './arcgisPopupUtils';
import {
    fetchArcgisLayers,
    fetchArcgisLegend,
    getArcgisTileUrl,
    fetchArcgisServiceInfo,
    fetchArcgisLayerInfo
} from './arcgisDataUtils';
import { 
    fetchServicesByStateMap,
    removeArcgisService, 
    renameFolderServices, 
    renameService,
    saveLayerSelections,
    loadLayerSelections,
    saveCustomLayer
} from './arcgisServicesDb'; // Fetch from DB
import { updateCurrentStateServices } from './arcgisUpdateServices';
import ArcgisRenameItem from './ArcgisRenameItem';
// Import local JSON files as fallback
import WA_ARCGIS_SERVICES from './arcgis_services_wa.json';
import ID_ARCGIS_SERVICES from './arcgis_services_id.json';
import OR_ARCGIS_SERVICES from './arcgis_services_or.json';
import { filterUploadPanelData } from './arcgisUploadSearchUtils';
import { buildMatchList, useSearchNav } from './arcgisSearchNavUtils';
import { buildLayerTree, getAllLeafLayers, getDescendantLeafLayers, LayerTreeNode } from './LayerTree';
import { useLayerContextMenu, LayerContextMenuPopup } from './LayerContextMenu';
import { ServiceInfoModal, LayerInfoModal } from './ArcgisInfoModals';
import { fetchUserPreferences, saveUserPreferences } from './userPreferencesApi';
import {
    clearPendingLocalPreferences,
    deepMergePreferences,
    hasPreferenceValues,
    readPendingLocalPreferences,
    writePendingLocalPreferences,
} from './userPreferencesLocalCache';
import './ArcgisUploadPanel.css';
import './ArcgisUploadPanelStateMenu.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTimes, faSync, faChevronUp, faChevronDown, faQuestion, faEllipsisV, faPlay, faEye } from '@fortawesome/free-solid-svg-icons';
import { faFolder } from '@fortawesome/free-regular-svg-icons';
import {
    useArcgisLoadingMessages,
    getLoadingMsgId,
    getLoadingMsgText
} from './arcgisUploadMessageUtils';
import ClearAllLayersButton from './ClearAllLayersButton';
import ArcgisUploadPanelOnboarding from './OnboardingArcgisUploadPanel';

// --- State selector ---
const STATE_CODES = ['WA', 'ID', 'OR'];
const STATE_LABELS = { WA: 'WA', ID: 'ID', OR: 'OR' };
const STATE_FULL_NAMES = { WA: 'Washington State ArcGIS Services', ID: 'Idaho ArcGIS Services', OR: 'Oregon ArcGIS Services' };
const STATE_CODE_TO_NAME = { WA: 'washington', ID: 'idaho', OR: 'oregon' };

const normalizeLookupText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Local JSON fallback data
const ARCGIS_SERVICES_BY_STATE = {
    WA: WA_ARCGIS_SERVICES || [],
    ID: ID_ARCGIS_SERVICES || [],
    OR: OR_ARCGIS_SERVICES || []
};

// State-specific attribution information
const STATE_ATTRIBUTION = {
    WA: {
        name: 'Washington State',
        url: 'https://gis.ecology.wa.gov/serverext/rest/services'
    },
    ID: {
        name: 'Idaho',
        url: 'https://gis.idwr.idaho.gov/hosting/rest/services'
    },
    OR: {
        name: 'Oregon',
        url: 'https://navigator.state.or.us/arcgis/rest/services'
    }
};

// Main component

// Built-in (hardcoded) layers that are not from ArcGIS REST services
const BUILTIN_LAYERS = [
    { id: 'River', label: 'Hydrological Boundaries' },
    { id: 'Places', label: 'City Limits' },
];
const BUILTIN_FOLDER_NAME = 'Built-in Layers';
const LEGACY_PINNED_STORAGE_KEY = 'arcgis_pinned_items';

function normalizePinnedItems(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    const seen = new Set();

    return items.reduce((normalizedItems, item) => {
        if (!item || typeof item !== 'object') {
            return normalizedItems;
        }

        const serviceKey = typeof item.serviceKey === 'string' ? item.serviceKey.trim() : '';
        if (!serviceKey) {
            return normalizedItems;
        }

        const normalizedItem = {
            serviceKey,
            layerId: item.layerId ?? null,
            sublayerIndex: item.sublayerIndex ?? null,
        };

        const dedupeKey = JSON.stringify(normalizedItem);
        if (seen.has(dedupeKey)) {
            return normalizedItems;
        }

        seen.add(dedupeKey);
        normalizedItems.push(normalizedItem);
        return normalizedItems;
    }, []);
}

function extractPinnedItemsFromPreferences(preferences) {
    return normalizePinnedItems(preferences?.arcgis?.pinnedItems);
}

function readLegacyPinnedItems() {
    try {
        const raw = localStorage.getItem(LEGACY_PINNED_STORAGE_KEY);
        return normalizePinnedItems(raw ? JSON.parse(raw) : []);
    } catch {
        return [];
    }
}

function clearLegacyPinnedItems() {
    try {
        localStorage.removeItem(LEGACY_PINNED_STORAGE_KEY);
    } catch {
        // Ignore storage cleanup failures.
    }
}

function ArcgisUploadPanel({
    isOpen,
    onClose,
    splitBottom = false,
    mapInstance,
    arcgisLayerAdded: propArcgisLayerAdded,
    setArcgisLayerAdded: setPropArcgisLayerAdded,
    isAdmin = false,
    areaVisibility = {},
    handleAreaCheckbox,
    navigateToItem = null,
    onNavigateToItemDone,
    onCustomLayerSaved,
}) {
    // Track selected state
    const [selectedState, setSelectedState] = useState('WA');

    // Services fetched from DB
    const [servicesFromDb, setServicesFromDb] = useState({});
    const [isLoadingServices, setIsLoadingServices] = useState(false);
    const [servicesError, setServicesError] = useState(null);
    const [usingFallback, setUsingFallback] = useState(false);

    // Combine all states; prefer DB data, fall back to local JSON when DB is unavailable
    const ALL_SERVICES_BY_STATE = {};
    STATE_CODES.forEach(code => {
        ALL_SERVICES_BY_STATE[code] = (servicesFromDb[code] && servicesFromDb[code].length > 0)
            ? servicesFromDb[code]
            : (ARCGIS_SERVICES_BY_STATE[code] || []);
    });
    const ARCGIS_SERVICES = STATE_CODES.flatMap(code => ALL_SERVICES_BY_STATE[code]);

    // Group services by state, then by folder
    const servicesByStateAndFolder = {};
    STATE_CODES.forEach(code => {
        const byFolder = {};
        (ALL_SERVICES_BY_STATE[code] || []).forEach(service => {
            const folder = service.folder || 'Root';
            if (!byFolder[folder]) byFolder[folder] = [];
            byFolder[folder].push(service);
        });
        servicesByStateAndFolder[code] = {
            folders: byFolder,
            folderNames: Object.keys(byFolder).sort(),
        };
    });

    // Flat servicesByFolder (for search compatibility)
    const servicesByFolder = {};
    ARCGIS_SERVICES.forEach(service => {
        const folder = service.folder || 'Root';
        if (!servicesByFolder[folder]) servicesByFolder[folder] = [];
        servicesByFolder[folder].push(service);
    });
    const folderNames = Object.keys(servicesByFolder).sort();

    const [folderExpanded, setFolderExpanded] = useState(false);
    const [expandedService, setExpandedService] = useState(null);
    const [serviceLayers, setServiceLayers] = useState({}); // { key: [layers] }
    const [serviceLayersLoading, setServiceLayersLoading] = useState({}); // { key: bool } — tracks in-flight layer fetches
    const [serviceLegends, setServiceLegends] = useState({}); // { key: legend }
    const [checkedLayerIds, setCheckedLayerIds] = useState({}); // { key: [layerIds] }
    const [serviceLayerAdded, setServiceLayerAdded] = useState({}); // { key: bool }
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchType, setSearchType] = useState('any'); // 'any', 'folder', 'service', 'layer'
    const [searchResult, setSearchResult] = useState(null);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
    const onboardingSnapshotRef = useRef(null);

    // Search navigation
    const matchList = useMemo(
        () => buildMatchList({ searchResult, allServicesByState: ALL_SERVICES_BY_STATE, stateCodes: STATE_CODES, serviceLayers }),
        [searchResult, serviceLayers] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const { currentIndex: navIndex, total: matchTotal, currentMatchId, goToNext, goToPrev, initNav, resetNav } = useSearchNav(matchList);
    const [expandedStates, setExpandedStates] = useState(new Set()); // Track which state-level folders are expanded
    const [expandedFolders, setExpandedFolders] = useState(new Set());
    // Navigation path for file-explorer style folder browsing: { stateCode: null|string, folder: null|string }
    const [currentPath, setCurrentPath] = useState({ stateCode: null, folder: null });
    const [expandedServices, setExpandedServices] = useState(new Set());
    const [expandedLayers, setExpandedLayers] = useState(new Set()); // Track which layers are expanded
    const [chatbotHighlightTarget, setChatbotHighlightTarget] = useState(null);
    // State for added-only checkbox
    const [showAddedOnly, setShowAddedOnly] = useState(false);

    // Opacity slider state (0 to 1)
    const [layerOpacity, setLayerOpacity] = useState(0.7);
    const panelRootRef = useRef(null);

    // Track previous checkedLayerIds for diffing
    const prevCheckedLayerIds = useRef({});

    // Track loading states for layers to reliably check completion
    const loadingStates = useRef({}); // { messageId: boolean }

    // Navigation target tracking
    const pendingNavigateRef = useRef(null); // { serviceKey, layerId, stateCode, folderName }
    const folderAreaRef = useRef(null); // ref to upload-panel-folder-area for scrolling

    // Direct layer toggle (from learn-more modal checkboxes — no panel open required)
    const pendingDirectTogglesRef = useRef([]);
    const [directToggleTick, setDirectToggleTick] = useState(0);

    // Persistence: track whether saved selections have been loaded for current state/datasource
    const selectionsLoadedRef = useRef(false);
    const saveTimerRef = useRef(null);
    // Cache flags: prevent re-fetching on subsequent panel opens
    const servicesLoadedRef = useRef(false);
    const preferencesLoadedRef = useRef(false);
    const userEmail = localStorage.getItem('email') || '';
    const pinnedWriteInitializedRef = useRef(false);
    const activeSearchRef = useRef(null); // { keyword, searchType } — tracks active search for auto re-run when layers load
    const getScopedServicesRef = useRef(null);   // Latest getScopedServices closure — updated each render so effects can use current data
    const getScopedStateCodesRef = useRef(null); // Latest getScopedStateCodes closure
    const [pinnedItems, setPinnedItems] = useState([]);
    const [pinnedPreferencesLoaded, setPinnedPreferencesLoaded] = useState(false);
    const [localPinnedPreferencesReady, setLocalPinnedPreferencesReady] = useState(false);
    const onboardingStateCode = 'WA';

    const findFirstVisibleStateCode = useCallback(() => {
        return STATE_CODES.find(code => (servicesByStateAndFolder[code]?.folderNames || []).length > 0) || null;
    }, [servicesByStateAndFolder]);

    const findFirstVisibleFolder = useCallback((stateCode) => {
        if (!stateCode) return null;
        return servicesByStateAndFolder[stateCode]?.folderNames?.[0] || null;
    }, [servicesByStateAndFolder]);

    const findFirstVisibleService = useCallback((stateCode, folderName) => {
        if (!stateCode || !folderName) return null;
        return servicesByStateAndFolder[stateCode]?.folders?.[folderName]?.[0] || null;
    }, [servicesByStateAndFolder]);

    const findFirstExpandableLayerKey = useCallback((service) => {
        if (!service) return null;
        const rawLayers = serviceLayers[service.key]?.length > 0 ? serviceLayers[service.key] : (service.layers || []);
        const layerTree = buildLayerTree(Array.isArray(rawLayers) ? rawLayers : []);

        const findInNodes = (nodes) => {
            for (const node of nodes || []) {
                if (node?.type === 'Group Layer' && Array.isArray(node.children) && node.children.length > 0) {
                    return `${service.key}-${node.id}`;
                }
                const nested = findInNodes(node?.children || []);
                if (nested) return nested;
            }
            return null;
        };

        return findInNodes(layerTree);
    }, [serviceLayers]);

    const findFirstInfoLayer = useCallback((service) => {
        if (!service) return null;
        const rawLayers = serviceLayers[service.key]?.length > 0 ? serviceLayers[service.key] : (service.layers || []);
        const layers = Array.isArray(rawLayers) ? rawLayers : [];
        return layers.find(layer => layer && layer.id !== undefined && layer.type !== 'Group Layer')
            || layers.find(layer => layer && layer.id !== undefined)
            || null;
    }, [serviceLayers]);

    useEffect(() => {
        if (isOnboardingOpen) {
            onboardingSnapshotRef.current = {
                searchKeyword,
                searchResult,
                currentPath,
                showAddedOnly,
                expandedStates,
                expandedFolders,
                expandedServices,
                expandedLayers,
            };

            setSearchKeyword('');
            setSearchResult(null);
            setCurrentPath({ stateCode: null, folder: null });
            setShowAddedOnly(false);
            setExpandedStates(new Set());
            setExpandedFolders(new Set());
            setExpandedServices(new Set());
            setExpandedLayers(new Set());
            setServiceInfoOpenKey(null);
            setLayerInfoOpen(null);
            return;
        }

        const snapshot = onboardingSnapshotRef.current;
        if (!snapshot) return;

        setSearchKeyword(snapshot.searchKeyword);
        setSearchResult(snapshot.searchResult);
        setCurrentPath(snapshot.currentPath);
        setShowAddedOnly(snapshot.showAddedOnly);
        setExpandedStates(snapshot.expandedStates);
        setExpandedFolders(snapshot.expandedFolders);
        setExpandedServices(snapshot.expandedServices);
        setExpandedLayers(snapshot.expandedLayers);
        onboardingSnapshotRef.current = null;
    }, [isOnboardingOpen]);

    useEffect(() => {
        if (!isOnboardingOpen) return;

        const stateCode = findFirstVisibleStateCode();
        const folderName = findFirstVisibleFolder(stateCode);
        const service = findFirstVisibleService(stateCode, folderName);
        const onboardingFolderName = findFirstVisibleFolder(onboardingStateCode);
        const onboardingService = findFirstVisibleService(onboardingStateCode, onboardingFolderName);
        const expandableLayerKey = findFirstExpandableLayerKey(service);

        if (onboardingStepIndex >= 1 && stateCode) {
            setExpandedStates(prev => {
                const next = new Set(prev);
                next.add(stateCode);
                return next;
            });
        }

        if (onboardingStepIndex >= 2) {
            setCurrentPath({ stateCode: onboardingStateCode, folder: null });
            setExpandedFolders(prev => {
                const next = new Set(prev);
                if (folderName) {
                    next.add(folderName);
                }
                if (onboardingFolderName) {
                    next.add(onboardingFolderName);
                }
                return next;
            });
            setExpandedStates(prev => {
                const next = new Set(prev);
                next.add(onboardingStateCode);
                return next;
            });
        }

        if (onboardingStepIndex >= 3 && service) {
            setCurrentPath({ stateCode: onboardingStateCode, folder: onboardingFolderName || null });
            setExpandedServices(prev => {
                const next = new Set(prev);
                next.add(service.key);
                return next;
            });
            if (onboardingService) {
                setExpandedServices(prev => {
                    const next = new Set(prev);
                    next.add(onboardingService.key);
                    return next;
                });
            }
        }

        if (onboardingStepIndex >= 6 && expandableLayerKey) {
            setExpandedLayers(prev => {
                const next = new Set(prev);
                next.add(expandableLayerKey);
                return next;
            });
        }
    }, [
        isOnboardingOpen,
        onboardingStepIndex,
        findFirstVisibleStateCode,
        findFirstVisibleFolder,
        findFirstVisibleService,
        findFirstExpandableLayerKey,
    ]);

    const {
        messages,
        addLoadingMessage: originalAddLoadingMessage,
        removeLoadingMessage: originalRemoveLoadingMessage,
        showFinishedMessage,
        clearAllMessages
    } = useArcgisLoadingMessages();

    // Whether any map layer is currently loading (for spinner overlay)
    const [isMapLayerLoading, setIsMapLayerLoading] = useState(false);
    const [mapContainerEl, setMapContainerEl] = useState(null);

    // Keep map container element reference in sync
    useEffect(() => {
        const map = mapInstance && mapInstance();
        if (map && map.getContainer) {
            const container = map.getContainer();
            if (container && container !== mapContainerEl) {
                container.style.position = 'relative';
                setMapContainerEl(container);
            }
        }
    });

    // Wrapped functions to track loading states
    const addLoadingMessage = (id, text) => {
        loadingStates.current[id] = true;
        setIsMapLayerLoading(true);
        originalAddLoadingMessage(id, text);
    };

    const removeLoadingMessage = (id) => {
        loadingStates.current[id] = false;
        // Check if any layer is still loading
        const stillLoading = Object.values(loadingStates.current).some(v => v === true);
        if (!stillLoading) setIsMapLayerLoading(false);
        originalRemoveLoadingMessage(id);
    };

    // Service info modal state ---
    const [serviceInfoOpenKey, setServiceInfoOpenKey] = useState(null); // service.key
    const [serviceInfoCache, setServiceInfoCache] = useState({}); // { key: info }
    const [serviceInfoLoading, setServiceInfoLoading] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);

    // Layer info modal state ---
    const [layerInfoOpen, setLayerInfoOpen] = useState(null); // { serviceKey, layerId, layerName, serviceUrl }
    const [layerInfoCache, setLayerInfoCache] = useState({}); // { "serviceKey-layerId": info }
    const [layerInfoLoading, setLayerInfoLoading] = useState(false);

    // Add new state for sublayer checkboxes (add this near other state declarations)
    const [checkedSublayerIds, setCheckedSublayerIds] = useState({});

    const [renamingItem, setRenamingItem] = useState(null); // { type, key } to trigger rename externally

    // Update functionality state
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateProgress, setUpdateProgress] = useState('');
    const [updateResults, setUpdateResults] = useState(null);

    // Fetch services from DB on first panel open; skip on subsequent opens unless fallback was used
    useEffect(() => {
        if (!isOpen) return;
        // Skip if already successfully loaded from backend
        if (servicesLoadedRef.current) return;

        let active = true;

        (async () => {
            setIsLoadingServices(true);
            setServicesError(null);
            setUsingFallback(false);

            try {
                console.log(`[ArcgisUploadPanel] Fetching services from backend for all states...`);
                const stateMap = await fetchServicesByStateMap(STATE_CODES, { type: 'MapServer' });

                if (active) {
                    const totalCount = STATE_CODES.reduce((sum, c) => sum + (stateMap[c] || []).length, 0);
                    if (totalCount > 0) {
                        setServicesFromDb(stateMap);
                        setUsingFallback(false);
                        servicesLoadedRef.current = true;
                        console.log(`[ArcgisUploadPanel] Loaded ${totalCount} services from backend`);
                    } else {
                        console.warn(`[ArcgisUploadPanel] Backend returned no services, using local fallback`);
                        setServicesFromDb({});
                        setUsingFallback(true);
                        // Don't set servicesLoadedRef — retry on next open
                    }
                }
            } catch (error) {
                console.error(`[ArcgisUploadPanel] Failed to load from backend, using local fallback:`, error);
                if (active) {
                    setServicesFromDb({});
                    setUsingFallback(true);
                    setServicesError(`Backend unavailable (using local data): ${error.message || 'Network error'}`);
                    // Don't set servicesLoadedRef — retry on next open
                }
            } finally {
                if (active) {
                    setIsLoadingServices(false);
                }
            }
        })();

        return () => { active = false; };
    }, [isOpen]);

    // Show data source status as bottom notification
    useEffect(() => {
        const msgId = 'data-source-status';
        if (isLoadingServices) {
            addLoadingMessage(msgId, `🔄 Loading ArcGIS services from database...`);
        } else {
            removeLoadingMessage(msgId);
            if (usingFallback) {
                showFinishedMessage(msgId, `📂 Database unavailable, using local data`);
            } else if (ARCGIS_SERVICES.length > 0) {
                showFinishedMessage(msgId, `🌐 Loaded from database: ${ARCGIS_SERVICES.length} services`);
            }
        }
    }, [isLoadingServices, usingFallback, ARCGIS_SERVICES.length]);

    // Reset state when data source TYPE changes (local ↔ database toggle)
    useEffect(() => {
        // Reset per-datasource caches/UI
        setServiceLayers({});
        setServiceLayersLoading({});
        setServiceLegends({});
        setCheckedLayerIds({});
        setServiceLayerAdded({});
        setCheckedSublayerIds({});
        setExpandedStates(new Set());
        setExpandedFolders(new Set());
        setExpandedServices(new Set());
        setExpandedLayers(new Set());
        setServiceInfoOpenKey(null);
        setSearchKeyword('');
        setSearchResult(null);
        prevCheckedLayerIds.current = {};
        loadingStates.current = {};
        setIsMapLayerLoading(false);
        selectionsLoadedRef.current = false;
        activeSearchRef.current = null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount to initialise caches

    // When the services list changes (e.g. DB finishes loading), re-run any active search
    // so results don't silently disappear or become stale.
    useEffect(() => {
        if (!activeSearchRef.current || !getScopedServicesRef.current) return;
        const { keyword, searchType: type } = activeSearchRef.current;
        const newScopedServices = getScopedServicesRef.current();
        const newScopedCodes = getScopedStateCodesRef.current();
        activeSearchRef.current = { keyword, searchType: type, scopedServices: newScopedServices, scopedStateCodes: newScopedCodes };
        const result = filterUploadPanelData({ services: newScopedServices, serviceLayers, searchType: type, keyword });
        setSearchResult(result);
        setExpandedStates(new Set(newScopedCodes));
        setExpandedFolders(new Set(result.expandedFolders));
        setExpandedServices(new Set(result.expandedServices));
        setExpandedLayers(new Set(result.expandedLayerKeys));
        const mList = buildMatchList({ searchResult: result, allServicesByState: ALL_SERVICES_BY_STATE, stateCodes: newScopedCodes, serviceLayers });
        initNav(mList);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ARCGIS_SERVICES.length]); // Re-run search when services list changes (DB loaded)

    useEffect(() => {
        if (!isOpen) {
            selectionsLoadedRef.current = false;
        }
    }, [isOpen]);

    // Lazy-load layers only when a specific service is expanded by the user
    useEffect(() => {
        if (!isOpen) return;

        expandedServices.forEach(serviceKey => {
            // Skip if already fetched or currently loading
            if (serviceLayers[serviceKey] !== undefined) return;
            if (serviceLayersLoading[serviceKey]) return;

            const service = ARCGIS_SERVICES.find(s => s.key === serviceKey);
            if (!service || service.type !== 'MapServer' || !service.url) return;

            setServiceLayersLoading(prev => ({ ...prev, [serviceKey]: true }));
            fetchArcgisLayers(service.url).then(layers => {
                setServiceLayers(prev => ({ ...prev, [serviceKey]: layers || [] }));
                setCheckedLayerIds(prev => prev[serviceKey] !== undefined ? prev : { ...prev, [serviceKey]: [] });
                setServiceLayerAdded(prev => prev[serviceKey] !== undefined ? prev : { ...prev, [serviceKey]: false });
                setCheckedSublayerIds(prev => prev[serviceKey] !== undefined ? prev : { ...prev, [serviceKey]: {} });
            }).catch(() => {
                setServiceLayers(prev => ({ ...prev, [serviceKey]: [] }));
            }).finally(() => {
                setServiceLayersLoading(prev => {
                    const next = { ...prev };
                    delete next[serviceKey];
                    return next;
                });
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, expandedServices]); // Load layers on demand when a service is expanded

    // Fetch legends on-demand only when a service is actually expanded in the UI
    useEffect(() => {
        if (!isOpen) return;
        expandedServices.forEach(serviceKey => {
            if (serviceLegends[serviceKey] !== undefined) return;
            const service = ARCGIS_SERVICES.find(s => s.key === serviceKey);
            if (!service?.url) return;
            fetchArcgisLegend(service.url).then(legend => {
                setServiceLegends(prev => ({ ...prev, [serviceKey]: legend || {} }));
            }).catch(() => {
                setServiceLegends(prev => ({ ...prev, [serviceKey]: {} }));
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, expandedServices]);

    // Re-run filter (and refresh nav count) when layers load in during an active search
    useEffect(() => {
        if (!activeSearchRef.current) return;
        const { keyword, searchType: type, scopedStateCodes } = activeSearchRef.current;
        // Always use latest scoped services so filteredFolders and servicesByStateAndFolder
        // are built from the same data source, preventing key/url mismatch in stateFoldersToShow.
        const latestScopedServices = getScopedServicesRef.current
            ? getScopedServicesRef.current()
            : activeSearchRef.current.scopedServices;
        activeSearchRef.current.scopedServices = latestScopedServices;
        const result = filterUploadPanelData({ services: latestScopedServices, serviceLayers, searchType: type, keyword });
        setSearchResult(result);
        setExpandedFolders(new Set(result.expandedFolders));
        setExpandedServices(new Set(result.expandedServices));
        setExpandedLayers(new Set(result.expandedLayerKeys));
        const mList = buildMatchList({ searchResult: result, allServicesByState: ALL_SERVICES_BY_STATE, stateCodes: scopedStateCodes, serviceLayers });
        initNav(mList);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serviceLayers]);

    // --- DB persistence disabled (kept for future use) ---
    // useEffect(() => {
    //     if (!isOpen || !userEmail || selectionsLoadedRef.current) return;
    //     if (ARCGIS_SERVICES.length === 0) return;
    //     selectionsLoadedRef.current = true;
    //     (async () => {
    //         try {
    //             const saved = await loadLayerSelections(userEmail, 'ALL', dataSource);
    //             if (!saved) return;
    //             const { checkedLayerIds: savedChecked, checkedSublayerIds: savedSublayers } = saved;
    //             if (savedChecked && Object.keys(savedChecked).length > 0) {
    //                 setCheckedLayerIds(prev => {
    //                     const merged = { ...prev };
    //                     Object.entries(savedChecked).forEach(([key, ids]) => {
    //                         if (Array.isArray(ids) && ids.length > 0) merged[key] = ids;
    //                     });
    //                     return merged;
    //                 });
    //             }
    //             if (savedSublayers && Object.keys(savedSublayers).length > 0) {
    //                 setCheckedSublayerIds(prev => {
    //                     const merged = { ...prev };
    //                     Object.entries(savedSublayers).forEach(([key, val]) => {
    //                         if (val && Object.keys(val).length > 0) merged[key] = val;
    //                     });
    //                     return merged;
    //                 });
    //             }
    //             if (savedChecked) {
    //                 const statesToExpand = new Set();
    //                 const foldersToExpand = new Set();
    //                 const servicesToExpand = new Set();
    //                 STATE_CODES.forEach(code => {
    //                     (ALL_SERVICES_BY_STATE[code] || []).forEach(service => {
    //                         const ids = savedChecked[service.key];
    //                         if (Array.isArray(ids) && ids.length > 0) {
    //                             statesToExpand.add(code);
    //                             foldersToExpand.add(service.folder || 'Root');
    //                             servicesToExpand.add(service.key);
    //                         }
    //                     });
    //                 });
    //                 if (statesToExpand.size > 0) setExpandedStates(statesToExpand);
    //                 if (foldersToExpand.size > 0) setExpandedFolders(foldersToExpand);
    //                 if (servicesToExpand.size > 0) setExpandedServices(servicesToExpand);
    //             }
    //         } catch (err) {
    //             console.warn('[ArcgisUploadPanel] Failed to load saved selections:', err);
    //         }
    //     })();
    // }, [isOpen, userEmail, dataSource, ARCGIS_SERVICES.length]);

    // const saveSelectionsToDb = useCallback(() => {
    //     if (!userEmail || !selectionsLoadedRef.current) return;
    //     const hasChecked = Object.values(checkedLayerIds).some(ids => Array.isArray(ids) && ids.length > 0);
    //     const hasSublayers = Object.values(checkedSublayerIds).some(obj => obj && Object.keys(obj).length > 0);
    //     if (!hasChecked && !hasSublayers) return;
    //     if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    //     saveTimerRef.current = setTimeout(() => {
    //         saveLayerSelections(userEmail, 'ALL', dataSource, { checkedLayerIds, checkedSublayerIds });
    //     }, 1000);
    // }, [userEmail, dataSource, checkedLayerIds, checkedSublayerIds]);
    // useEffect(() => {
    //     saveSelectionsToDb();
    //     return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // }, [saveSelectionsToDb]);
    // --- End DB persistence disabled ---

    // --- Pinned items: user preference-backed auto-load ---
    useEffect(() => {
        if (!isOpen) return;
        // Skip if preferences were already successfully loaded
        if (preferencesLoadedRef.current) return;

        let cancelled = false;

        const loadPinnedPreferences = async () => {
            pinnedWriteInitializedRef.current = false;
            selectionsLoadedRef.current = false;

            let localPreferences = readPendingLocalPreferences();
            const legacyPinnedItems = readLegacyPinnedItems();

            if (legacyPinnedItems.length > 0) {
                writePendingLocalPreferences({
                    arcgis: {
                        pinnedItems: legacyPinnedItems,
                    },
                });
                clearLegacyPinnedItems();
                localPreferences = deepMergePreferences(localPreferences, {
                    arcgis: {
                        pinnedItems: legacyPinnedItems,
                    },
                });
            }

            if (!userEmail) {
                if (!cancelled) {
                    setPinnedItems(extractPinnedItemsFromPreferences(localPreferences));
                    setPinnedPreferencesLoaded(false);
                    setLocalPinnedPreferencesReady(true);
                    preferencesLoadedRef.current = true;
                }
                return;
            }

            if (!cancelled) {
                setPinnedPreferencesLoaded(false);
                setLocalPinnedPreferencesReady(false);
            }

            try {
                const cloudPreferences = await fetchUserPreferences(userEmail);
                if (cancelled) return;

                const mergedPreferences = deepMergePreferences(cloudPreferences, localPreferences);
                setPinnedItems(extractPinnedItemsFromPreferences(mergedPreferences));

                if (hasPreferenceValues(localPreferences)) {
                    await saveUserPreferences(userEmail, mergedPreferences);
                    clearPendingLocalPreferences();
                }
            } catch (error) {
                console.warn('[ArcgisUploadPanel] Failed to load pinned preferences:', error);
                if (!cancelled) {
                    setPinnedItems(extractPinnedItemsFromPreferences(localPreferences));
                }
            } finally {
                if (!cancelled) {
                    setPinnedPreferencesLoaded(true);
                    preferencesLoadedRef.current = true;
                }
            }
        };

        loadPinnedPreferences();

        return () => {
            cancelled = true;
        };
    }, [isOpen, userEmail]);

    useEffect(() => {
        if (!isOpen || !userEmail || !pinnedPreferencesLoaded) {
            return;
        }

        if (!pinnedWriteInitializedRef.current) {
            pinnedWriteInitializedRef.current = true;
            return;
        }

        const timer = setTimeout(() => {
            saveUserPreferences(userEmail, {
                arcgis: {
                    pinnedItems,
                },
            }).catch(error => {
                console.warn('[ArcgisUploadPanel] Failed to save pinned preferences:', error);
            });
        }, 300);

        return () => clearTimeout(timer);
    }, [isOpen, userEmail, pinnedPreferencesLoaded, pinnedItems]);

    useEffect(() => {
        if (!isOpen || userEmail || !localPinnedPreferencesReady) {
            return;
        }

        if (!pinnedWriteInitializedRef.current) {
            pinnedWriteInitializedRef.current = true;
            return;
        }

        const timer = setTimeout(() => {
            writePendingLocalPreferences({
                arcgis: {
                    pinnedItems,
                },
            });
        }, 200);

        return () => clearTimeout(timer);
    }, [isOpen, userEmail, localPinnedPreferencesReady, pinnedItems]);

    // Context menu hook (state, outside-click, pin/unpin)
    const {
        contextMenu,
        handleContextMenu,
        closeContextMenu,
        isPinned,
        handleTogglePin,
    } = useLayerContextMenu({ pinnedItems, setPinnedItems });

    const handleTogglePinGuarded = () => {
        if (!userEmail) {
            setShowLoginPrompt(true);
            closeContextMenu();
            return;
        }
        handleTogglePin();
    };

    // Auto-load pinned items once services are loaded
    useEffect(() => {
        const pinnedItemsReady = userEmail ? pinnedPreferencesLoaded : localPinnedPreferencesReady;

        if (!pinnedItemsReady) return;
        if (!isOpen || ARCGIS_SERVICES.length === 0 || pinnedItems.length === 0) return;
        if (selectionsLoadedRef.current) return;
        selectionsLoadedRef.current = true;

        const statesToExpand = new Set();
        const foldersToExpand = new Set();
        const servicesToExpand = new Set();
        const layerIdsToCheck = {}; // { serviceKey: [layerId, ...] }
        const sublayerIdsToCheck = {}; // { serviceKey: { layerId: [index, ...] } }

        pinnedItems.forEach(pin => {
            // Find the service across all states
            let foundService = null;
            let foundState = null;
            STATE_CODES.forEach(code => {
                (ALL_SERVICES_BY_STATE[code] || []).forEach(s => {
                    if (s.key === pin.serviceKey) { foundService = s; foundState = code; }
                });
            });
            if (!foundService) return;

            statesToExpand.add(foundState);
            foldersToExpand.add(foundService.folder || 'Root');
            servicesToExpand.add(pin.serviceKey);

            if (pin.layerId != null) {
                if (!layerIdsToCheck[pin.serviceKey]) layerIdsToCheck[pin.serviceKey] = [];
                if (!layerIdsToCheck[pin.serviceKey].includes(pin.layerId)) {
                    layerIdsToCheck[pin.serviceKey].push(pin.layerId);
                }
            }
            if (pin.sublayerIndex != null && pin.layerId != null) {
                if (!sublayerIdsToCheck[pin.serviceKey]) sublayerIdsToCheck[pin.serviceKey] = {};
                if (!sublayerIdsToCheck[pin.serviceKey][pin.layerId]) sublayerIdsToCheck[pin.serviceKey][pin.layerId] = [];
                sublayerIdsToCheck[pin.serviceKey][pin.layerId].push(pin.sublayerIndex);
            }
        });

        if (statesToExpand.size > 0) setExpandedStates(statesToExpand);
        if (foldersToExpand.size > 0) setExpandedFolders(foldersToExpand);
        if (servicesToExpand.size > 0) setExpandedServices(servicesToExpand);

        if (Object.keys(layerIdsToCheck).length > 0) {
            setCheckedLayerIds(prev => {
                const merged = { ...prev };
                Object.entries(layerIdsToCheck).forEach(([key, ids]) => {
                    merged[key] = [...new Set([...(merged[key] || []), ...ids])];
                });
                return merged;
            });
        }
        if (Object.keys(sublayerIdsToCheck).length > 0) {
            setCheckedSublayerIds(prev => {
                const merged = { ...prev };
                Object.entries(sublayerIdsToCheck).forEach(([sKey, layers]) => {
                    if (!merged[sKey]) merged[sKey] = {};
                    Object.entries(layers).forEach(([lid, indices]) => {
                        merged[sKey][lid] = [...new Set([...(merged[sKey][lid] || []), ...indices])];
                    });
                });
                return merged;
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isOpen,
        ARCGIS_SERVICES.length,
        pinnedItems,
        pinnedPreferencesLoaded,
        localPinnedPreferencesReady,
        userEmail,
    ]);

    // On state change: remove any ArcGIS layers/sources left from the previous state
    // NOTE: Disabled since states are now all loaded together as top-level folders
    // useEffect(() => {
    //     const map = mapInstance && mapInstance();
    //     if (!map || !map.getStyle) return;
    //     const style = map.getStyle();
    //     if (style && Array.isArray(style.layers)) {
    //         style.layers
    //             .map(l => l.id)
    //             .filter(id =>
    //                 id.startsWith('arcgis-raster-layer-') ||
    //                 id.startsWith('arcgis-vector-layer-')
    //             )
    //             .forEach(id => {
    //                 if (map.getLayer(id)) map.removeLayer(id);
    //             });
    //     }
    //     if (style && style.sources) {
    //         Object.keys(style.sources)
    //             .filter(id =>
    //                 id.startsWith('arcgis-raster-') ||
    //                 id.startsWith('arcgis-vector-source-')
    //             )
    //             .forEach(id => {
    //                 if (map.getSource(id)) map.removeSource(id);
    //             });
    //     }
    //     prevCheckedLayerIds.current = {};
    // }, [selectedState]);

    // Clear loading states when panel closes
    useEffect(() => {
        if (!isOpen) {
            loadingStates.current = {};
            setIsMapLayerLoading(false);
        }
    }, [isOpen]);

    // When a navigateToItem target arrives, expand tree and store pending navigation.
    // Also depends on ARCGIS_SERVICES.length so it re-runs after the reset effect that
    // fires when services finish loading from DB (which clears expanded states).
    useEffect(() => {
        if (!navigateToItem || !isOpen) return;
        if (ARCGIS_SERVICES.length === 0) return; // wait for services to load
        const desiredStateCode = (navigateToItem.stateCode || '').toUpperCase();
        const desiredFolderName = navigateToItem.folderName || null;
        const desiredServiceKey = navigateToItem.serviceKey || null;
        const desiredServiceName = navigateToItem.serviceName || null;
        const desiredServiceLeafName = desiredServiceName ? String(desiredServiceName).split('/').pop() : null;

        const scopedCandidates = ARCGIS_SERVICES.filter((service) => {
            const stateMatches = !desiredStateCode
                || (service.state || '').toLowerCase() === (STATE_CODE_TO_NAME[desiredStateCode] || '').toLowerCase();
            const folderMatches = !desiredFolderName
                || String(service.folder || '').toLowerCase() === String(desiredFolderName).toLowerCase();
            return stateMatches && folderMatches;
        });
        const stateOnlyCandidates = ARCGIS_SERVICES.filter((service) => {
            return !desiredStateCode
                || (service.state || '').toLowerCase() === (STATE_CODE_TO_NAME[desiredStateCode] || '').toLowerCase();
        });

        let resolvedService = null;
        if (desiredServiceKey) {
            resolvedService = ARCGIS_SERVICES.find(s => s.key === desiredServiceKey) || null;
        }
        if (!resolvedService && desiredServiceName) {
            const targetName = normalizeLookupText(desiredServiceName);
            const targetLeaf = normalizeLookupText(desiredServiceLeafName);
            resolvedService = scopedCandidates.find((service) => {
                const label = normalizeLookupText(service.label);
                const key = normalizeLookupText(service.key);
                return label === targetName
                    || label.includes(targetName)
                    || key === targetName
                    || (targetLeaf && (label === targetLeaf || label.includes(targetLeaf) || key.includes(targetLeaf)));
            }) || null;
        }
        if (!resolvedService && desiredServiceName) {
            const targetName = normalizeLookupText(desiredServiceName);
            const targetLeaf = normalizeLookupText(desiredServiceLeafName);
            resolvedService = stateOnlyCandidates.find((service) => {
                const label = normalizeLookupText(service.label);
                const key = normalizeLookupText(service.key);
                return label === targetName
                    || label.includes(targetName)
                    || key === targetName
                    || (targetLeaf && (label === targetLeaf || label.includes(targetLeaf) || key.includes(targetLeaf)));
            }) || null;
        }
        if (!resolvedService && scopedCandidates.length > 0) {
            resolvedService = scopedCandidates[0];
        }

        const resolvedStateCode = desiredStateCode || (resolvedService
            ? (Object.entries(STATE_CODE_TO_NAME).find(([, name]) => name === (resolvedService.state || '').toLowerCase())?.[0] || 'WA')
            : 'WA');
        const folderExistsInState = desiredFolderName
            ? (servicesByStateAndFolder[resolvedStateCode]?.folderNames || []).some(
                folder => String(folder).toLowerCase() === String(desiredFolderName).toLowerCase()
            )
            : false;
        const resolvedFolderName = resolvedService?.folder || (folderExistsInState ? desiredFolderName : null);
        const resolvedServiceKey = resolvedService?.key || desiredServiceKey || null;

        pendingNavigateRef.current = {
            ...navigateToItem,
            stateCode: resolvedStateCode,
            folderName: resolvedFolderName,
            serviceKey: resolvedServiceKey,
        };

        setCurrentPath({ stateCode: resolvedStateCode, folder: resolvedFolderName });
        setExpandedStates(prev => new Set([...prev, resolvedStateCode]));
        if (resolvedFolderName) {
            setExpandedFolders(prev => new Set([...prev, resolvedFolderName]));
        }
        if (resolvedServiceKey) {
            setExpandedServices(prev => new Set([...prev, resolvedServiceKey]));
            setChatbotHighlightTarget(`service-${resolvedServiceKey}`);

            if (resolvedService && serviceLayers[resolvedServiceKey] === undefined) {
                setServiceLayersLoading(prev => ({ ...prev, [resolvedServiceKey]: true }));
                fetchArcgisLayers(resolvedService.url)
                    .then(layers => {
                        setServiceLayers(prev => ({ ...prev, [resolvedServiceKey]: layers || [] }));
                        setCheckedLayerIds(prev => prev[resolvedServiceKey] !== undefined ? prev : { ...prev, [resolvedServiceKey]: [] });
                        setServiceLayerAdded(prev => prev[resolvedServiceKey] !== undefined ? prev : { ...prev, [resolvedServiceKey]: false });
                        setCheckedSublayerIds(prev => prev[resolvedServiceKey] !== undefined ? prev : { ...prev, [resolvedServiceKey]: {} });
                    })
                    .catch(() => {
                        setServiceLayers(prev => ({ ...prev, [resolvedServiceKey]: [] }));
                    })
                    .finally(() => {
                        setServiceLayersLoading(prev => {
                            const next = { ...prev };
                            delete next[resolvedServiceKey];
                            return next;
                        });
                    });
            }
        }
    }, [navigateToItem, isOpen, ARCGIS_SERVICES.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Once layers for the target service are loaded, apply checkbox, show loading animation and scroll
    useEffect(() => {
        const target = pendingNavigateRef.current;
        if (!target) return;
        const { serviceKey, layerId } = target;
        if (!serviceKey) return;
        const layers = serviceLayers[serviceKey];
        const needsLayerData = layerId != null || !!target.toggleLayer;
        if (needsLayerData && !layers) return; // not yet loaded

        const safeLayers = Array.isArray(layers) ? layers : [];

        pendingNavigateRef.current = null;

        const service = ARCGIS_SERVICES.find(s => s.key === serviceKey);

        // If triggered by a learn-more checkbox, toggle the corresponding panel checkbox
        if (target.toggleLayer && service) {
            if (target.toggleChecked) {
                // Add: same logic as checking the layer in the panel
                if (layerId != null) {
                    const layer = safeLayers.find(l => l.id === layerId);
                    if (layer) {
                        setCheckedLayerIds(prev => ({
                            ...prev,
                            [serviceKey]: [...new Set([...(prev[serviceKey] || []), layerId])],
                        }));
                        addLoadingMessage(getLoadingMsgId(service, layer), getLoadingMsgText(service, layer));
                    }
                } else {
                    const allIds = safeLayers.map(l => l.id);
                    setCheckedLayerIds(prev => ({ ...prev, [serviceKey]: allIds }));
                    addLoadingMessage(getLoadingMsgId(service, null), getLoadingMsgText(service, null));
                }
            } else {
                // Remove: same logic as unchecking the layer in the panel
                if (layerId != null) {
                    const layer = safeLayers.find(l => l.id === layerId);
                    setCheckedLayerIds(prev => ({
                        ...prev,
                        [serviceKey]: (prev[serviceKey] || []).filter(id => id !== layerId),
                    }));
                    if (layer) removeLoadingMessage(getLoadingMsgId(service, layer));
                } else {
                    setCheckedLayerIds(prev => ({ ...prev, [serviceKey]: [] }));
                    removeLoadingMessage(getLoadingMsgId(service, null));
                }
            }
        }

        // Expand all ancestor group layers of the target layer so it's visible
        if (layerId != null) {
            const layerMap = {};
            safeLayers.forEach(l => { layerMap[l.id] = l; });
            const ancestorKeys = [];
            let cur = layerMap[layerId];
            while (cur) {
                const pid = cur.parentLayer ? cur.parentLayer.id
                    : (cur.parentLayerId !== undefined && cur.parentLayerId !== null ? cur.parentLayerId : -1);
                if (pid === -1 || pid === null || pid === undefined || !layerMap[pid]) break;
                ancestorKeys.push(`${serviceKey}-${pid}`);
                cur = layerMap[pid];
            }
            if (ancestorKeys.length > 0) {
                setExpandedLayers(prev => new Set([...prev, ...ancestorKeys]));
            }
        }

        // Scroll to the specific layer element (or fall back to service)
        setTimeout(() => {
            const layerEl = layerId != null
                ? folderAreaRef.current?.querySelector(`[data-layer-id="${layerId}"]`)
                : null;
            const el = layerEl ?? folderAreaRef.current?.querySelector(`[data-service-key="${serviceKey}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (el) {
                el.classList.add('search-nav-current');
                window.setTimeout(() => {
                    el.classList.remove('search-nav-current');
                }, 2400);
            }
            window.setTimeout(() => setChatbotHighlightTarget(null), 2600);
            onNavigateToItemDone?.();
        }, 180);
    }, [serviceLayers]); // eslint-disable-line react-hooks/exhaustive-deps

    // Listen for 'arcgis-layer-toggle' events dispatched by learn-more modal checkboxes
    useEffect(() => {
        const handler = (e) => {
            const { serviceKey, layerId, checked } = e.detail;
            // Replace any existing pending toggle for the same item
            pendingDirectTogglesRef.current = [
                ...pendingDirectTogglesRef.current.filter(
                    t => !(t.serviceKey === serviceKey && t.layerId === layerId)
                ),
                { serviceKey, layerId, checked },
            ];
            setDirectToggleTick(t => t + 1);
        };
        window.addEventListener('arcgis-layer-toggle', handler);
        return () => window.removeEventListener('arcgis-layer-toggle', handler);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep pinned items in sync when pins are toggled elsewhere (e.g. the card
    // learn-more modal), so this panel's own saves don't overwrite them.
    useEffect(() => {
        const handler = (e) => {
            const items = normalizePinnedItems(e.detail?.pinnedItems);
            setPinnedItems(items);
        };
        window.addEventListener('arcgis-pinned-items-changed', handler);
        return () => window.removeEventListener('arcgis-pinned-items-changed', handler);
    }, []);

    // Process pending direct toggles (triggered by directToggleTick or when serviceLayers updates)
    useEffect(() => {
        if (pendingDirectTogglesRef.current.length === 0) return;
        const stillPending = [];
        pendingDirectTogglesRef.current.forEach(({ serviceKey, layerId, checked }) => {
            const service = ARCGIS_SERVICES.find(s => s.key === serviceKey);
            if (!service) return;
            const layers = serviceLayers[serviceKey];
            if (layers === undefined) {
                stillPending.push({ serviceKey, layerId, checked });
                // Show the map loading spinner right away — the layer list is
                // still being fetched (e.g. pinned layers auto-loading on page
                // visit via the learn-more modal).
                if (checked) {
                    addLoadingMessage(
                        `direct-pending-${serviceKey}-${layerId ?? 'all'}`,
                        `Loading ${service.label}...`
                    );
                }
                // Kick off layer loading so we can apply the toggle once they arrive
                fetchArcgisLayers(service.url)
                    .then(loaded => {
                        setServiceLayers(prev => ({ ...prev, [serviceKey]: loaded || [] }));
                        setCheckedLayerIds(prev => prev[serviceKey] !== undefined ? prev : { ...prev, [serviceKey]: [] });
                        setServiceLayerAdded(prev => prev[serviceKey] !== undefined ? prev : { ...prev, [serviceKey]: false });
                        setCheckedSublayerIds(prev => prev[serviceKey] !== undefined ? prev : { ...prev, [serviceKey]: {} });
                    })
                    .catch(() => setServiceLayers(prev => ({ ...prev, [serviceKey]: [] })));
                return;
            }
            // Layers available — apply toggle (clear the pending-fetch spinner first)
            removeLoadingMessage(`direct-pending-${serviceKey}-${layerId ?? 'all'}`);
            if (layerId != null) {
                if (checked) {
                    setCheckedLayerIds(prev => {
                        const prevC = prev[serviceKey] || [];
                        if (prevC.includes(layerId)) return prev;
                        const layer = layers.find(l => l.id === layerId);
                        if (layer) addLoadingMessage(getLoadingMsgId(service, layer), getLoadingMsgText(service, layer));
                        return { ...prev, [serviceKey]: [...prevC, layerId] };
                    });
                    setServiceLayerAdded(prev => ({ ...prev, [serviceKey]: true }));
                } else {
                    setCheckedLayerIds(prev => {
                        const layer = layers.find(l => l.id === layerId);
                        if (layer) removeLoadingMessage(getLoadingMsgId(service, layer));
                        const newC = (prev[serviceKey] || []).filter(id => id !== layerId);
                        setServiceLayerAdded(p => ({ ...p, [serviceKey]: newC.length > 0 }));
                        return { ...prev, [serviceKey]: newC };
                    });
                }
            } else {
                // Service-level item (no layerId)
                if (checked) {
                    const allIds = layers.map(l => l.id);
                    setCheckedLayerIds(prev => ({ ...prev, [serviceKey]: allIds }));
                    setServiceLayerAdded(prev => ({ ...prev, [serviceKey]: true }));
                    addLoadingMessage(getLoadingMsgId(service, null), getLoadingMsgText(service, null));
                } else {
                    setCheckedLayerIds(prev => ({ ...prev, [serviceKey]: [] }));
                    setServiceLayerAdded(prev => ({ ...prev, [serviceKey]: false }));
                    removeLoadingMessage(getLoadingMsgId(service, null));
                }
            }
        });
        pendingDirectTogglesRef.current = stillPending;
    }, [directToggleTick, serviceLayers]); // eslint-disable-line react-hooks/exhaustive-deps

    // Add/Remove button logic:
    const handleAddRemove = (service, layers) => {
        const allIds = layers.map(l => l.id);
        if (serviceLayerAdded[service.key]) {
            // Remove: uncheck all
            setCheckedLayerIds(prev => ({ ...prev, [service.key]: [] }));
            setServiceLayerAdded(prev => ({ ...prev, [service.key]: false }));
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: {} }));
            layers.forEach(layer => removeLoadingMessage(getLoadingMsgId(service, layer)));
            removeLoadingMessage(getLoadingMsgId(service, null));
        } else {
            // Add: check all
            setCheckedLayerIds(prev => ({ ...prev, [service.key]: allIds }));
            setServiceLayerAdded(prev => ({ ...prev, [service.key]: true }));
            
            // Also check all sublayers for each layer
            const newSublayerIds = {};
            layers.forEach(layer => {
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layer.id);
                    if (legendLayer && legendLayer.legend && legendLayer.legend.length > 1) {
                        newSublayerIds[layer.id] = legendLayer.legend.map((_, index) => index);
                    }
                }
            });
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: newSublayerIds }));
            
            // Show loading message for all layers IMMEDIATELY
            addLoadingMessage(getLoadingMsgId(service, null), getLoadingMsgText(service, null));
        }
    };

    // Select-All logic:
    const handleSelectAll = (service, layers) => {
        const allIds = layers.map(l => l.id);
        const isAllChecked = (checkedLayerIds[service.key] || []).length === allIds.length;
        
        if (isAllChecked) {
            // Uncheck all layers and sublayers
            setCheckedLayerIds(prev => ({ ...prev, [service.key]: [] }));
            setServiceLayerAdded(prev => ({ ...prev, [service.key]: false }));
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: {} }));
            layers.forEach(layer => removeLoadingMessage(getLoadingMsgId(service, layer)));
            removeLoadingMessage(getLoadingMsgId(service, null));
        } else {
            // Check all layers and their sublayers
            setCheckedLayerIds(prev => ({ ...prev, [service.key]: allIds }));
            setServiceLayerAdded(prev => ({ ...prev, [service.key]: true }));
            
            // Also check all sublayers for each layer
            const newSublayerIds = {};
            layers.forEach(layer => {
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layer.id);
                    if (legendLayer && legendLayer.legend && legendLayer.legend.length > 1) {
                        newSublayerIds[layer.id] = legendLayer.legend.map((_, index) => index);
                    }
                }
            });
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: newSublayerIds }));
            
            addLoadingMessage(getLoadingMsgId(service, null), getLoadingMsgText(service, null));
        }
    };

    // Clear all layers from map:
    const handleClearAllLayers = () => {
        setCheckedLayerIds({});
        setServiceLayerAdded({});
        setCheckedSublayerIds({});
        loadingStates.current = {};
        setIsMapLayerLoading(false);
        clearAllMessages();
    };

    // Layer checkbox logic:
    const handleLayerCheckbox = (service, layerId, layers) => {
        setCheckedLayerIds(prev => {
            const prevChecked = prev[service.key] || [];
            let newChecked;
            
            if (prevChecked.includes(layerId)) {
                newChecked = prevChecked.filter(id => id !== layerId);
                const layer = layers.find(l => l.id === layerId);
                if (layer) removeLoadingMessage(getLoadingMsgId(service, layer));
                
                // Uncheck all sublayers when parent is unchecked
                setCheckedSublayerIds(prevSub => ({
                    ...prevSub,
                    [service.key]: {
                        ...prevSub[service.key],
                        [layerId]: []
                    }
                }));
            } else {
                newChecked = [...prevChecked, layerId];
                const layer = layers.find(l => l.id === layerId);
                if (layer) addLoadingMessage(getLoadingMsgId(service, layer), getLoadingMsgText(service, layer));
                
                // Check all sublayers when parent is checked
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layerId);
                    if (legendLayer && legendLayer.legend) {
                        const allSublayerIndexes = legendLayer.legend.map((_, index) => index);
                        setCheckedSublayerIds(prevSub => ({
                            ...prevSub,
                            [service.key]: {
                                ...prevSub[service.key],
                                [layerId]: allSublayerIndexes
                            }
                        }));
                    }
                }
            }
            
            setServiceLayerAdded(prevAdded => ({
                ...prevAdded,
                [service.key]: newChecked.length > 0
            }));
            return { ...prev, [service.key]: newChecked };
        });
    };

    // Add new handler for sublayer checkboxes (enhanced)
    const handleSublayerCheckbox = (service, layerId, sublayerIndex, layers) => {
        setCheckedSublayerIds(prev => {
            const serviceSubIds = prev[service.key] || {};
            const layerSubIds = serviceSubIds[layerId] || [];
            
            let newLayerSubIds;
            if (layerSubIds.includes(sublayerIndex)) {
                newLayerSubIds = layerSubIds.filter(id => id !== sublayerIndex);
            } else {
                newLayerSubIds = [...layerSubIds, sublayerIndex];
            }
            
            // If no sublayers are checked, uncheck the parent layer
            if (newLayerSubIds.length === 0) {
                setCheckedLayerIds(prevChecked => ({
                    ...prevChecked,
                    [service.key]: (prevChecked[service.key] || []).filter(id => id !== layerId)
                }));
                const layer = layers.find(l => l.id === layerId);
                if (layer) removeLoadingMessage(getLoadingMsgId(service, layer));
            } else {
                // If at least one sublayer is checked, check the parent layer
                setCheckedLayerIds(prevChecked => {
                    const currentChecked = prevChecked[service.key] || [];
                    if (!currentChecked.includes(layerId)) {
                        const layer = layers.find(l => l.id === layerId);
                        if (layer) addLoadingMessage(getLoadingMsgId(service, layer), getLoadingMsgText(service, layer));
                        return {
                            ...prevChecked,
                            [service.key]: [...currentChecked, layerId]
                        };
                    }
                    return prevChecked;
                });
            }
            
            // Update service layer added status
            setServiceLayerAdded(prevAdded => {
                const allCheckedLayers = Object.keys({ ...serviceSubIds, [layerId]: newLayerSubIds })
                    .filter(lid => {
                        const subIds = lid === layerId ? newLayerSubIds : serviceSubIds[lid] || [];
                        return subIds.length > 0;
                    });
                return {
                    ...prevAdded,
                    [service.key]: allCheckedLayers.length > 0
                };
            });
            
            return {
                ...prev,
                [service.key]: {
                    ...serviceSubIds,
                    [layerId]: newLayerSubIds
                }
            };
        });
    };

    // Handle group layer checkbox: toggle all descendant feature layers
    const handleGroupLayerCheckbox = (service, groupNode, allChecked) => {
        const descendantLeaves = getDescendantLeafLayers(groupNode);
        const descendantIds = descendantLeaves.map(l => l.id);
        if (descendantIds.length === 0) return;

        if (allChecked) {
            // Uncheck all descendants
            setCheckedLayerIds(prev => ({
                ...prev,
                [service.key]: (prev[service.key] || []).filter(id => !descendantIds.includes(id))
            }));
            setCheckedSublayerIds(prev => {
                const updated = { ...prev[service.key] };
                descendantIds.forEach(id => { updated[id] = []; });
                return { ...prev, [service.key]: updated };
            });
            descendantLeaves.forEach(l => removeLoadingMessage(getLoadingMsgId(service, l)));
        } else {
            // Check all descendants
            setCheckedLayerIds(prev => {
                const current = prev[service.key] || [];
                const newIds = [...new Set([...current, ...descendantIds])];
                return { ...prev, [service.key]: newIds };
            });
            // Also check all sublayers for each descendant
            const newSublayerIds = { ...(checkedSublayerIds[service.key] || {}) };
            descendantLeaves.forEach(layer => {
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layer.id);
                    if (legendLayer && legendLayer.legend && legendLayer.legend.length > 1) {
                        newSublayerIds[layer.id] = legendLayer.legend.map((_, index) => index);
                    }
                }
            });
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: newSublayerIds }));
            addLoadingMessage(getLoadingMsgId(service, null), getLoadingMsgText(service, null));
        }
        setServiceLayerAdded(prev => ({
            ...prev,
            [service.key]: !allChecked
        }));
    };

    // Handle service removal
    const handleRemoveService = async (service) => {
        const checkedIds = checkedLayerIds[service.key] || [];
        const layersToRemove = [];
        
        // Get names of currently checked layers
        if (checkedIds.length > 0) {
            const layers = serviceLayers[service.key] || [];
            checkedIds.forEach(layerId => {
                const layer = layers.find(l => l.id === layerId);
                if (layer) layersToRemove.push(layer.name);
            });
        }

        const confirmMessage = layersToRemove.length > 0 
            ? `Remove "${service.label}" and its ${layersToRemove.length} selected layer(s) from the map?`
            : `Remove "${service.label}" from available services?`;
        
        if (!window.confirm(confirmMessage)) {
            return;
        }

        try {
            // Show loading state
            console.log(`Removing service: ${service.key}`);
            
            // Call the remove API
            await removeArcgisService(service.key, {
                removedBy: 'user', // You can replace this with actual user info if available
                layersRemoved: layersToRemove
            });

            // Remove from map if it was added
            if (serviceLayerAdded[service.key]) {
                const map = mapInstance();
                if (map) {
                    // Remove all layers and sources for this service
                    const layers = serviceLayers[service.key] || [];
                    layers.forEach(layer => {
                        // Remove vector layers
                        const baseId = `arcgis-vector-layer-${service.key}-${layer.id}`;
                        const fillId = baseId;
                        const lineId = `${baseId}-outline`;
                        const circleId = `${baseId}-circle`;
                        const sourceId = `arcgis-vector-source-${service.key}-${layer.id}`;
                        [fillId, lineId, circleId].forEach(lid => {
                            if (map.getLayer(lid)) map.removeLayer(lid);
                        });
                        if (map.getSource(sourceId)) map.removeSource(sourceId);

                        // Remove raster layers
                        const rasterSourceId = `arcgis-raster-${service.key}-${layer.id}`;
                        const rasterLayerId = `arcgis-raster-layer-${service.key}-${layer.id}`;
                        if (map.getLayer(rasterLayerId)) map.removeLayer(rasterLayerId);
                        if (map.getSource(rasterSourceId)) map.removeSource(rasterSourceId);

                        // Remove sublayer rasters
                        const style = map.getStyle();
                        if (style?.layers) {
                            style.layers
                                .filter(l => l.id.startsWith(`arcgis-raster-layer-${service.key}-${layer.id}`))
                                .forEach(l => {
                                    if (map.getLayer(l.id)) map.removeLayer(l.id);
                                });
                        }
                        if (style?.sources) {
                            Object.keys(style.sources)
                                .filter(id => id.startsWith(`arcgis-raster-${service.key}-${layer.id}`))
                                .forEach(id => {
                                    if (map.getSource(id)) map.removeSource(id);
                                });
                        }
                    });
                }
            }

            // Clean up local state
            setServiceLayers(prev => {
                const newState = { ...prev };
                delete newState[service.key];
                return newState;
            });
            setServiceLegends(prev => {
                const newState = { ...prev };
                delete newState[service.key];
                return newState;
            });
            setCheckedLayerIds(prev => {
                const newState = { ...prev };
                delete newState[service.key];
                return newState;
            });
            setServiceLayerAdded(prev => {
                const newState = { ...prev };
                delete newState[service.key];
                return newState;
            });
            setCheckedSublayerIds(prev => {
                const newState = { ...prev };
                delete newState[service.key];
                return newState;
            });

            // Refresh services list from database
            console.log('Refreshing services list...');
            const updatedMap = await fetchServicesByStateMap(STATE_CODES, { type: 'MapServer' });
            setServicesFromDb(updatedMap);
            
            console.log(`Service "${service.label}" removed successfully`);
            
        } catch (error) {
            console.error('Failed to remove service:', error);
            
            // Handle different types of errors
            let errorMessage = 'Failed to remove service. ';
            
            if (error.response?.status === 409) {
                // Conflict error (duplicate in removed services)
                if (error.response?.data?.detail) {
                    errorMessage = error.response.data.detail + '\n\nHint: Open the removed services panel (trash icon) to permanently delete the existing service.';
                } else {
                    errorMessage += 'A service with the same key already exists in the removed services panel. Please permanently delete the existing removed service first, then try removing again.\n\nHint: Open the removed services panel (trash icon) to permanently delete the existing service.';
                }
            } else if (error.response?.status === 404) {
                errorMessage += 'The service was not found.';
            } else if (error.response?.data?.detail) {
                errorMessage += error.response.data.detail;
            } else {
                // Check if it's a table-related error that might succeed on retry
                const errorMsg = error?.message || 'Unknown error';
                const isTableError = errorMsg.includes('removed_arcgis_services') || 
                                    errorMsg.includes('relation') || 
                                    errorMsg.includes('does not exist');
                
                if (isTableError) {
                    errorMessage = `Database initialization error. Please try removing the service again. If the problem persists, contact support.\n\nError: ${errorMsg}`;
                } else {
                    errorMessage += errorMsg;
                }
            }
            
            alert(errorMessage);
        }
    };

    // Handle folder rename
    const handleFolderRename = async (oldFolderName, newFolderName) => {
        if (!newFolderName || newFolderName.trim() === '') {
            alert('Folder name cannot be empty');
            return;
        }

        if (oldFolderName === newFolderName) {
            return; // No change needed
        }

        try {
            console.log(`Renaming folder "${oldFolderName}" to "${newFolderName}"`);
            
            // Call API to rename folder
            const stateName = {
                'WA': 'washington',
                'ID': 'idaho', 
                'OR': 'oregon'
            }[selectedState];
            
            await renameFolderServices(oldFolderName, newFolderName, stateName);
            
            // Refresh services list from database
            console.log('Refreshing services list after folder rename...');
            const updatedMap = await fetchServicesByStateMap(STATE_CODES, { type: 'MapServer' });
            setServicesFromDb(updatedMap);
            
            // Update expanded folders to reflect the new name
            setExpandedFolders(prev => {
                const newSet = new Set(prev);
                if (newSet.has(oldFolderName)) {
                    newSet.delete(oldFolderName);
                    newSet.add(newFolderName);
                }
                return newSet;
            });
            
            console.log(`Folder "${oldFolderName}" renamed to "${newFolderName}" successfully`);
            
        } catch (error) {
            console.error('Failed to rename folder:', error);
            alert(`Failed to rename folder: ${error.message || 'Unknown error'}`);
        }
    };

    // Handle service rename
    const handleServiceRename = async (serviceKey, newLabel) => {
        if (!newLabel || newLabel.trim() === '') {
            alert('Service name cannot be empty');
            return;
        }

        try {
            console.log(`Renaming service "${serviceKey}" to "${newLabel}"`);
            
            // Call API to rename service
            await renameService(serviceKey, newLabel);
            
            // Refresh services list from database
            console.log('Refreshing services list after service rename...');
            const updatedMap = await fetchServicesByStateMap(STATE_CODES, { type: 'MapServer' });
            setServicesFromDb(updatedMap);
            
            console.log(`Service "${serviceKey}" renamed to "${newLabel}" successfully`);
            
        } catch (error) {
            console.error('Failed to rename service:', error);
            alert(`Failed to rename service: ${error.message || 'Unknown error'}`);
        }
    };

    // Handle update button click
    const handleUpdateServices = async () => {
        if (isUpdating) return; // Prevent multiple simultaneous updates

        setIsUpdating(true);
        setUpdateProgress('Starting update...');
        setUpdateResults(null);

        try {
            const result = await updateCurrentStateServices(selectedState, (progressMessage) => {
                setUpdateProgress(progressMessage);
            });

            setUpdateResults(result);
            
            if (result.success && result.newCount > 0) {
                // Refresh the services list to show new services
                console.log('Refreshing services list after update...');
                const updatedMap = await fetchServicesByStateMap(STATE_CODES, { type: 'MapServer' });
                setServicesFromDb(updatedMap);
                
                setUpdateProgress(`✅ Update complete! Added ${result.newCount} new services.`);
            } else if (result.success && result.newCount === 0) {
                setUpdateProgress('✅ Update complete! No new services found.');
            }
            
        } catch (error) {
            console.error('Update failed:', error);
            setUpdateProgress(`❌ Update failed: ${error.message}`);
            setUpdateResults({ success: false, error: error.message });
        } finally {
            setIsUpdating(false);
            
            // Clear progress message after 5 seconds
            setTimeout(() => {
                setUpdateProgress('');
                setUpdateResults(null);
            }, 5000);
        }
    };

    // Enhanced effect for checked layers: add/remove vector layers and individual sublayer rasters
    useEffect(() => {
        const map = mapInstance();
        if (!map) return;

        ARCGIS_SERVICES.forEach(service => {
            const layers = serviceLayers[service.key] || [];
            const prevChecked = prevCheckedLayerIds.current[service.key] || [];
            const currChecked = checkedLayerIds[service.key] || [];
            const serviceSublayers = checkedSublayerIds[service.key] || {};
            const prevSublayers = prevCheckedLayerIds.current[`${service.key}_sublayers`] || {};

            // --- VECTOR LAYERS (unchanged) ---
            const toRemove = prevChecked.filter(id => !currChecked.includes(id));
            const toAdd = currChecked.filter(id => !prevChecked.includes(id));

            toRemove.forEach(id => {
                const baseId = `arcgis-vector-layer-${service.key}-${id}`;
                const fillId = baseId;
                const lineId = `${baseId}-outline`;
                const circleId = `${baseId}-circle`;
                const sourceId = `arcgis-vector-source-${service.key}-${id}`;
                [fillId, lineId, circleId].forEach(lid => {
                    if (map.getLayer(lid)) map.removeLayer(lid);
                });
                if (map.getSource(sourceId)) map.removeSource(sourceId);
            });

            const vectorAddedIds = new Set();
            toAdd.forEach(id => {
                const layer = layers.find(l => l.id === id);
                if (layer) {
                    addArcgisVectorLayer(
                        map,
                        { ...layer, serviceKey: service.key, serviceUrl: service.url },
                        showArcgisPopup,
                        { minzoom: 5 }
                    );
                    vectorAddedIds.add(id);
                }
            });

            // First, handle layers that were completely unchecked - remove ALL their raster layers
            toRemove.forEach(layerId => {
                const layerRasterPrefix = `arcgis-raster-layer-${service.key}-${layerId}`;
                const style = map.getStyle();
                if (style?.layers) {
                    style.layers
                        .filter(l => l.id.startsWith(layerRasterPrefix))
                        .forEach(l => {
                            if (map.getLayer(l.id)) map.removeLayer(l.id);
                        });
                }
                if (style?.sources) {
                    Object.keys(style.sources)
                        .filter(id => id.startsWith(`arcgis-raster-${service.key}-${layerId}`))
                        .forEach(id => {
                            if (map.getSource(id)) map.removeSource(id);
                        });
                }
            });

            // Then handle sublayer changes for currently checked layers
            currChecked.forEach(layerId => {
                const layer = layers.find(l => l.id === layerId);
                if (!layer) return;

                const legend = serviceLegends[service.key];
                const legendLayer = legend?.layers?.find(l => l.layerId === layerId);
                const legendItems = legendLayer?.legend || [];
                const checkedSublayers = serviceSublayers[layerId] || [];
                const prevCheckedSublayers = prevSublayers[layerId] || [];

                // Check if sublayer selection changed
                const sublayersChanged = JSON.stringify(checkedSublayers.sort()) !== JSON.stringify(prevCheckedSublayers.sort());

                if (legendItems.length > 1) {
                    // Multiple legends case
                    if (sublayersChanged || toAdd.includes(layerId)) {
                        // Remove all existing raster layers for this layer first
                        const layerRasterPrefix = `arcgis-raster-layer-${service.key}-${layerId}`;
                        const style = map.getStyle();
                        if (style?.layers) {
                            style.layers
                                .filter(l => l.id.startsWith(layerRasterPrefix))
                                .forEach(l => {
                                    if (map.getLayer(l.id)) map.removeLayer(l.id);
                            });
                        }
                        if (style?.sources) {
                            Object.keys(style.sources)
                                .filter(id => id.startsWith(`arcgis-raster-${service.key}-${layerId}`))
                                .forEach(id => {
                                    if (map.getSource(id)) map.removeSource(id);
                            });
                        }

                        // Add raster layers only for checked sublayers
                        if (checkedSublayers.length > 0) {
                            checkedSublayers.forEach((sublayerIndex, index) => {
                                const legendItem = legendItems[sublayerIndex];
                                if (!legendItem) return;

                                const sublayerSourceId = `arcgis-raster-${service.key}-${layerId}-sub-${sublayerIndex}`;
                                const sublayerLayerId = `arcgis-raster-layer-${service.key}-${layerId}-sub-${sublayerIndex}`;

                                // Create tile URL for this specific sublayer
                                const sublayerTileUrl = getArcgisTileUrl(service.url, [layerId]);

                                map.addSource(sublayerSourceId, {
                                    type: 'raster',
                                    tiles: [sublayerTileUrl],
                                    tileSize: 256,
                                    minzoom: 5,
                                    maxzoom: 12
                                });

                                map.addLayer({
                                    id: sublayerLayerId,
                                    type: 'raster',
                                    source: sublayerSourceId,
                                    minzoom: 5,
                                    paint: {
                                        'raster-opacity': layerOpacity
                                    }
                                });

                                // Detect when sublayer tiles are fully loaded and rendered using 'idle' event
                                const onIdle = () => {
                                    if (!map.getLayer(sublayerLayerId)) { map.off('idle', onIdle); return; }
                                    if (!map.isSourceLoaded(sublayerSourceId)) return;
                                    map.off('idle', onIdle);

                                    const sublayerMsgId = `${getLoadingMsgId(service, layer)}-sub-${sublayerIndex}`;
                                    removeLoadingMessage(sublayerMsgId);
                                    showFinishedMessage(sublayerMsgId, `${legendItem.label} loaded`);

                                    const allSublayersFinished = checkedSublayers.every(subIdx => {
                                        const subMsgId = `${getLoadingMsgId(service, layer)}-sub-${subIdx}`;
                                        return !loadingStates.current[subMsgId];
                                    });

                                    if (allSublayersFinished) {
                                        removeLoadingMessage(getLoadingMsgId(service, layer));
                                        showFinishedMessage(getLoadingMsgId(service, layer), getLoadingMsgText(service, layer, true));

                                        const allServiceLayersFinished = currChecked.every(layerId => {
                                            const layerMsgId = getLoadingMsgId(service, layers.find(l => l.id === layerId));
                                            return !loadingStates.current[layerMsgId];
                                        });

                                        if (allServiceLayersFinished && currChecked.length > 0) {
                                            const allLayersMessageId = getLoadingMsgId(service, null);
                                            if (loadingStates.current[allLayersMessageId]) {
                                                removeLoadingMessage(allLayersMessageId);
                                                showFinishedMessage(allLayersMessageId, getLoadingMsgText(service, null, true));
                                            }
                                        }
                                    }
                                };

                                map.on('idle', onIdle);
                            });
                        }
                    }
                } else if (toAdd.includes(layerId)) {
                    // Single legend case - only add if this layer was just checked
                    const rasterSourceId = `arcgis-raster-${service.key}-${layerId}`;
                    const rasterLayerId = `arcgis-raster-layer-${service.key}-${layerId}`;

                    // Remove existing first (in case of re-adding)
                    if (map.getLayer(rasterLayerId)) map.removeLayer(rasterLayerId);
                    if (map.getSource(rasterSourceId)) map.removeSource(rasterSourceId);

                    map.addSource(rasterSourceId, {
                        type: 'raster',
                        tiles: [getArcgisTileUrl(service.url, [layerId])],
                        tileSize: 256,
                        minzoom: 5,
                        maxzoom: 12
                    });

                    map.addLayer({
                        id: rasterLayerId,
                        type: 'raster',
                        source: rasterSourceId,
                        minzoom: 5,
                        paint: {
                            'raster-opacity': layerOpacity
                        }
                    });

                    // Detect when tiles are fully loaded and rendered using 'idle' event
                    const onIdle = () => {
                        if (!map.getLayer(rasterLayerId)) { map.off('idle', onIdle); return; }
                        if (!map.isSourceLoaded(rasterSourceId)) return;
                        map.off('idle', onIdle);

                        removeLoadingMessage(getLoadingMsgId(service, layer));
                        showFinishedMessage(getLoadingMsgId(service, layer), getLoadingMsgText(service, layer, true));

                        const allServiceLayersFinished = currChecked.every(layerId => {
                            const layerMsgId = getLoadingMsgId(service, layers.find(l => l.id === layerId));
                            return !loadingStates.current[layerMsgId];
                        });

                        if (allServiceLayersFinished && currChecked.length > 0) {
                            const allLayersMessageId = getLoadingMsgId(service, null);
                            if (loadingStates.current[allLayersMessageId]) {
                                removeLoadingMessage(allLayersMessageId);
                                showFinishedMessage(allLayersMessageId, getLoadingMsgText(service, null, true));
                            }
                        }
                    };

                    map.on('idle', onIdle);
                }
            });

            // Update refs for next diff — only mark IDs as processed if layer data was available,
            // so that layers not yet in serviceLayers will be retried when data arrives
            prevCheckedLayerIds.current[service.key] = currChecked.filter(id =>
                vectorAddedIds.has(id) || prevChecked.includes(id)
            );
            prevCheckedLayerIds.current[`${service.key}_sublayers`] = JSON.parse(JSON.stringify(serviceSublayers));
        });
        // eslint-disable-next-line
    }, [checkedLayerIds, serviceLayers, checkedSublayerIds]); // Added checkedSublayerIds as dependency


    // UI for search bar and dropdown
    // Handle opacity slider change — update all ArcGIS raster/vector layers on the map
    const handleOpacityChange = (newOpacity) => {
        setLayerOpacity(newOpacity);
        const map = mapInstance && mapInstance();
        if (!map || !map.getStyle) return;
        const style = map.getStyle();
        if (!style || !Array.isArray(style.layers)) return;
        style.layers.forEach(l => {
            if (l.id.startsWith('arcgis-raster-layer-')) {
                map.setPaintProperty(l.id, 'raster-opacity', newOpacity);
            } else if (l.id.startsWith('arcgis-vector-layer-')) {
                // Vector layers may be fill, line, or circle type
                if (l.type === 'fill') {
                    map.setPaintProperty(l.id, 'fill-opacity', newOpacity);
                } else if (l.type === 'line') {
                    map.setPaintProperty(l.id, 'line-opacity', newOpacity);
                } else if (l.type === 'circle') {
                    map.setPaintProperty(l.id, 'circle-opacity', newOpacity);
                }
            }
        });
    };

    const INFO_MODAL_WIDTH = 380;

    const getInfoModalStyle = () => {
        const panelEl = panelRootRef.current;
        if (!panelEl || typeof window === 'undefined') return undefined;
        const rect = panelEl.getBoundingClientRect();
        const modalWidth = INFO_MODAL_WIDTH;
        const left = Math.min(rect.right + 2, window.innerWidth - modalWidth - 8);
        const top = Math.max(8, rect.top);
        const maxHeight = Math.max(240, window.innerHeight - rect.top - 16);
        return {
            top: `${top}px`,
            left: `${left}px`,
            maxHeight: `${maxHeight}px`,
        };
    };

    const getLayerInfoModalStyle = () => {
        const serviceModalStyle = getInfoModalStyle();
        if (!serviceModalStyle) return undefined;
        if (!serviceInfoOpenKey) return serviceModalStyle;

        const serviceLeft = Number.parseFloat(serviceModalStyle.left);
        const serviceTop = Number.parseFloat(serviceModalStyle.top);
        if (Number.isNaN(serviceLeft) || Number.isNaN(serviceTop)) {
            return serviceModalStyle;
        }

        return {
            ...serviceModalStyle,
            left: `${serviceLeft + INFO_MODAL_WIDTH}px`,
            top: `${serviceTop}px`,
        };
    };

    // True while an active search is waiting for layer data from unloaded services
    const isSearchLoadingLayers = searchResult !== null && Object.keys(serviceLayersLoading).length > 0;

    // Returns the service list scoped to the current navigation path (state and/or folder)
    const getScopedServices = (path = currentPath) => {
        if (path.stateCode !== null && path.stateCode !== '__builtin__') {
            if (path.folder !== null) {
                // Inside a specific folder: only services in that state + folder
                return (servicesByStateAndFolder[path.stateCode]?.folders?.[path.folder]) || [];
            }
            // Inside a state: all services for that state
            return ALL_SERVICES_BY_STATE[path.stateCode] || [];
        }
        // Root level: all services
        return ARCGIS_SERVICES;
    };

    // Returns the STATE_CODES subset relevant to the current navigation scope
    const getScopedStateCodes = (path = currentPath) => {
        if (path.stateCode !== null && path.stateCode !== '__builtin__') {
            return [path.stateCode];
        }
        return STATE_CODES;
    };
    // Keep refs up-to-date so effects (which have stale closures) can call the latest version
    getScopedServicesRef.current = getScopedServices;
    getScopedStateCodesRef.current = getScopedStateCodes;

    // Trigger loading layers for services in scope that are not yet loaded (used when searching for layers)
    const triggerLayerLoadForSearch = (type, scopedServicesList) => {
        if (type !== 'any' && type !== 'layer') return;
        scopedServicesList.forEach(service => {
            if (!service || service.type !== 'MapServer' || !service.url || !service.key) return;
            if (serviceLayers[service.key] !== undefined) return;
            if (serviceLayersLoading[service.key]) return;
            setServiceLayersLoading(prev => ({ ...prev, [service.key]: true }));
            fetchArcgisLayers(service.url)
                .then(layers => {
                    setServiceLayers(prev => ({ ...prev, [service.key]: layers || [] }));
                    setCheckedLayerIds(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: [] });
                    setServiceLayerAdded(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: false });
                    setCheckedSublayerIds(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: {} });
                })
                .catch(() => {
                    setServiceLayers(prev => ({ ...prev, [service.key]: [] }));
                })
                .finally(() => {
                    setServiceLayersLoading(prev => {
                        const next = { ...prev };
                        delete next[service.key];
                        return next;
                    });
                });
        });
    };

    // Unified search handler — scoped to currentPath
    const handleSearch = (keyword, type) => {
        if (!keyword) {
            activeSearchRef.current = null;
            setSearchResult(null);
            setExpandedStates(new Set());
            setExpandedFolders(new Set());
            setExpandedServices(new Set());
            setExpandedLayers(new Set());
            resetNav();
            return;
        }
        const scopedServicesList = getScopedServices();
        const scopedCodes = getScopedStateCodes();
        const result = filterUploadPanelData({ services: scopedServicesList, serviceLayers, searchType: type, keyword });
        setSearchResult(result);
        activeSearchRef.current = { keyword, searchType: type, scopedServices: scopedServicesList, scopedStateCodes: scopedCodes };
        // Expand states relevant to scope so results are visible
        setExpandedStates(new Set(scopedCodes));
        setExpandedFolders(new Set(result.expandedFolders));
        setExpandedServices(new Set(result.expandedServices));
        setExpandedLayers(new Set(result.expandedLayerKeys));
        const mList = buildMatchList({ searchResult: result, allServicesByState: ALL_SERVICES_BY_STATE, stateCodes: scopedCodes, serviceLayers });
        initNav(mList);
        // Kick off loading unloaded service layers so layer-name matches aren’t missed
        triggerLayerLoadForSearch(type, scopedServicesList);
    };

    // Render a layer tree node using the shared component
    const renderLayerNode = (node, service, checkedIds, allFeatureLayers, depth = 0) => (
        <LayerTreeNode
            key={node.id}
            node={node}
            service={service}
            checkedIds={checkedIds}
            allFeatureLayers={allFeatureLayers}
            serviceLegends={serviceLegends}
            checkedSublayerIds={checkedSublayerIds}
            expandedLayers={expandedLayers}
            searchResult={searchResult}
            currentMatchId={currentMatchId}
            onLayerClick={handleLayerClick}
            onLayerCheckbox={handleLayerCheckbox}
            onGroupCheckbox={handleGroupLayerCheckbox}
            onSublayerCheckbox={handleSublayerCheckbox}
            onContextMenu={handleContextMenu}
            depth={depth}
            layerInfoOpen={layerInfoOpen}
        />
    );

    const renderSearchBar = () => {
        const searchPlaceholder = currentPath.folder !== null
            ? `Search in "${currentPath.folder}"…`
            : currentPath.stateCode !== null && currentPath.stateCode !== '__builtin__'
                ? `Search in ${STATE_FULL_NAMES[currentPath.stateCode] || currentPath.stateCode}…`
                : 'Search folders, services, or layers…';

        return (
        <div>
            <div className="upload-panel-searchbar" data-onboarding-target="arcgis-search-area">
                <input
                    type="text"
                    value={searchKeyword}
                    onChange={e => setSearchKeyword(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            handleSearch(searchKeyword, searchType);
                        }
                    }}
                    placeholder={searchPlaceholder}
                />
                <button
                    className="search-btn upload-panel-searchbar-btn search"
                    title="Search"
                    onClick={() => handleSearch(searchKeyword, searchType)}
                >
                    <FontAwesomeIcon icon={faSearch} />
                </button>
                <button
                    className="clear-btn upload-panel-searchbar-btn clear"
                    title="Clear Search"
                    onClick={() => {
                        activeSearchRef.current = null;
                        setSearchKeyword('');
                        setSearchResult(null);
                        setExpandedStates(new Set());
                        setExpandedFolders(new Set());
                        setExpandedServices(new Set());
                        setExpandedLayers(new Set());
                        resetNav();
                    }}
                >
                    <FontAwesomeIcon icon={faTimes} />
                </button>
            </div>
            {isSearchLoadingLayers && (
                <div className="upload-panel-search-loading">
                    <span className="upload-panel-search-loading-spinner" />
                    Searching… loading more results ({Object.keys(serviceLayersLoading).length} remaining)
                </div>
            )}
        </div>
        );
    };

    // Build per-state folders to show directly from per-state grouped data.
    // Do not re-split merged services by service.state because backend state values can be inconsistent,
    // which may intermittently hide an entire state's folders.
    const stateFoldersToShow = {};
    STATE_CODES.forEach(code => {
        const baseByFolder = servicesByStateAndFolder[code]?.folders || {};
        const baseFolders = servicesByStateAndFolder[code]?.folderNames || [];
        const folders = [];
        const byFolder = {};

        baseFolders.forEach(folder => {
            let visibleServices = baseByFolder[folder] || [];

            // Apply search filter by intersecting with searched services for this folder.
            // Match by key only (not key::url) to be robust against minor URL formatting
            // differences between local JSON and DB (e.g. trailing slash), which would cause
            // buildMatchList (key-only) and stateFoldersToShow (key::url) to disagree.
            if (searchResult) {
                const searchedServices = searchResult.filteredFolders?.[folder] || [];
                const searchedKeys = new Set(searchedServices.map(s => s.key));
                visibleServices = visibleServices.filter(s => searchedKeys.has(s.key));
            }

            // Apply "show added only" after search filter.
            if (showAddedOnly) {
                visibleServices = visibleServices.filter(service =>
                    (checkedLayerIds[service.key] || []).length > 0
                );
            }

            if (visibleServices.length > 0) {
                folders.push(folder);
                byFolder[folder] = visibleServices;
            }
        });

        stateFoldersToShow[code] = { folders, byFolder };
    });

    // State folder click
    const handleStateClick = (code) => {
        setExpandedStates(prev => {
            const newSet = new Set(prev);
            if (newSet.has(code)) newSet.delete(code);
            else newSet.add(code);
            return newSet;
        });
    };

    // Folder click
    const handleFolderClick = (folder) => {
        setExpandedFolders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(folder)) newSet.delete(folder);
            else newSet.add(folder);
            return newSet;
        });
    };

    // Navigation double-click handlers — clear any active search when navigating to a new scope
    const handleStateDoubleClick = (code) => {
        activeSearchRef.current = null;
        setSearchResult(null);
        setSearchKeyword('');
        resetNav();
        setCurrentPath({ stateCode: code, folder: null });
    };
    const handleFolderDoubleClick = (folder) => {
        activeSearchRef.current = null;
        setSearchResult(null);
        setSearchKeyword('');
        resetNav();
        setCurrentPath(prev => ({ stateCode: prev.stateCode, folder }));
    };
    const handleNavBack = () => {
        activeSearchRef.current = null;
        setSearchResult(null);
        setSearchKeyword('');
        resetNav();
        setCurrentPath(prev => {
            if (prev.stateCode === '__builtin__') return { stateCode: null, folder: null };
            if (prev.folder !== null) return { stateCode: prev.stateCode, folder: null };
            return { stateCode: null, folder: null };
        });
    };

    // Service click
    const handleServiceClick = (serviceKey) => {
        setExpandedServices(prev => {
            const newSet = new Set(prev);
            if (newSet.has(serviceKey)) newSet.delete(serviceKey);
            else newSet.add(serviceKey);
            return newSet;
        });
    };

    // Layer click (for layers with sublayers)
    const handleLayerClick = (serviceKey, layerId) => {
        const layerKey = `${serviceKey}-${layerId}`;
        setExpandedLayers(prev => {
            const newSet = new Set(prev);
            if (newSet.has(layerKey)) newSet.delete(layerKey);
            else newSet.add(layerKey);
            return newSet;
        });
    };

    // State selection menu that sets selectedState and resets relevant state variables based on selection
    const renderStateMenu = () => (
        <div className="arcgis-upload-state-menu">
            {/* State selection buttons - disabled, states are now shown as top-level folders in the panel */}
            {/* <div className="arcgis-upload-state-buttons">
                {STATE_CODES.map(code => (
                    <button
                        key={code}
                        className={`arcgis-upload-state-btn${selectedState === code ? ' active' : ''}`}
                        onClick={() => setSelectedState(code)}
                        title={`Load ${STATE_LABELS[code]} services`}
                    >
                        {STATE_LABELS[code]}
                    </button>
                ))}
            </div> */}
            
        </div>
    );

    // Context menu handlers (panel-specific; state + pin from hook)
    const handleContextLearnMore = () => {
        if (!contextMenu) return;
        const { type, data } = contextMenu;
        if (type === 'service') {
            openServiceInfo(data.service);
        } else if (type === 'layer') {
            openLayerInfo(data.service, data.layer);
        }
        closeContextMenu();
    };

    // Save a service to custom layers (only first-level layers under folders)
    const handleSaveToCustomLayers = async () => {
        if (!contextMenu) return;
        const { type, data } = contextMenu;
        closeContextMenu();

        if (type !== 'service') return;
        const email = localStorage.getItem('email') || '';
        if (!email) {
            setShowLoginPrompt(true);
            return;
        }
        try {
            await saveCustomLayer(email, data.service);
            showFinishedMessage(`Saved "${data.service.label}" to Custom Layers`);
            onCustomLayerSaved?.();
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    };

    // Save a layer to custom layers
    const handleSaveLayerToCustomLayers = async () => {
        if (!layerInfoOpen) return;
        const email = localStorage.getItem('email') || '';
        if (!email) {
            setShowLoginPrompt(true);
            return;
        }
        try {
            const service = layerInfoOpen.service;
            if (!service) return;
            const layerToSave = {
                ...service,
                label: `${service.label} - ${layerInfoOpen.layerName}`,
                layerId: layerInfoOpen.layerId
            };
            await saveCustomLayer(email, layerToSave);
            onCustomLayerSaved?.();
            return `Saved "${layerInfoOpen.layerName}" to Custom Layers`;
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    };

    // Save the service currently shown in the service info modal to custom layers
    const handleSaveServiceFromInfoModal = async () => {
        if (!serviceInfoOpenKey) return;
        const email = localStorage.getItem('email') || '';
        if (!email) {
            setShowLoginPrompt(true);
            return;
        }
        try {
            const currentService = ARCGIS_SERVICES.find(s => s.key === serviceInfoOpenKey);
            if (!currentService) return;
            await saveCustomLayer(email, currentService);
            onCustomLayerSaved?.();
            return `Saved "${currentService.label}" to Custom Layers`;
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    };

    // Open service info modal (fetch & cache)
    const openServiceInfo = async (service) => {
        setServiceInfoOpenKey(service.key);

        if (service && service.key && serviceLayers[service.key] === undefined && service.url) {
            setServiceLayersLoading(prev => ({ ...prev, [service.key]: true }));
            fetchArcgisLayers(service.url).then(layers => {
                setServiceLayers(prev => ({ ...prev, [service.key]: layers || [] }));
                setCheckedLayerIds(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: [] });
                setServiceLayerAdded(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: false });
                setCheckedSublayerIds(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: {} });
            }).catch(() => {
                setServiceLayers(prev => ({ ...prev, [service.key]: [] }));
            }).finally(() => {
                setServiceLayersLoading(prev => {
                    const next = { ...prev };
                    delete next[service.key];
                    return next;
                });
            });
        }

        if (serviceInfoCache[service.key]) return;
        setServiceInfoLoading(true);
        try {
            const info = await fetchArcgisServiceInfo(service.url);
            setServiceInfoCache(prev => ({ ...prev, [service.key]: info || {} }));
        } finally {
            setServiceInfoLoading(false);
        }
    };
    const closeServiceInfo = () => {
        setServiceInfoOpenKey(null);
    };

    // Open layer info modal (fetch & cache)
    const openLayerInfo = async (service, layer) => {
        const layerData = {
            serviceKey: service.key,
            layerId: layer.id,
            layerName: layer.name,
            serviceUrl: service.url,
            service: service
        };
        setLayerInfoOpen(layerData);
        
        const cacheKey = `${service.key}-${layer.id}`;
        if (layerInfoCache[cacheKey]) return;
        
        setLayerInfoLoading(true);
        try {
            const info = await fetchArcgisLayerInfo(service.url, layer.id);
            if (serviceLegends[service.key] === undefined && service.url) {
                fetchArcgisLegend(service.url).then(legend => {
                    setServiceLegends(prev => ({ ...prev, [service.key]: legend || {} }));
                }).catch(() => {
                    setServiceLegends(prev => ({ ...prev, [service.key]: {} }));
                });
            }
            setLayerInfoCache(prev => ({ ...prev, [cacheKey]: info || {} }));
        } finally {
            setLayerInfoLoading(false);
        }
    };

    const closeLayerInfo = () => {
        setLayerInfoOpen(null);
    };

    useEffect(() => {
        if (!isOnboardingOpen) return;

        const onboardingFolderName = findFirstVisibleFolder(onboardingStateCode);
        const onboardingService = findFirstVisibleService(onboardingStateCode, onboardingFolderName);
        const infoLayer = findFirstInfoLayer(onboardingService);

        if (onboardingStepIndex >= 8 && onboardingService) {
            if (serviceInfoOpenKey !== onboardingService.key) {
                openServiceInfo(onboardingService);
            }
        } else if (serviceInfoOpenKey) {
            setServiceInfoOpenKey(null);
        }

        if (onboardingStepIndex >= 10 && onboardingService && infoLayer) {
            const isSameLayer = layerInfoOpen
                && layerInfoOpen.serviceKey === onboardingService.key
                && layerInfoOpen.layerId === infoLayer.id;
            if (!isSameLayer) {
                openLayerInfo(onboardingService, infoLayer);
            }
        } else if (layerInfoOpen) {
            setLayerInfoOpen(null);
        }
    }, [
        isOnboardingOpen,
        onboardingStepIndex,
        serviceInfoOpenKey,
        layerInfoOpen,
        findFirstVisibleFolder,
        findFirstVisibleService,
        findFirstInfoLayer,
    ]);

    // Helper: convert HTML to plain text (for Service Description)
    // (moved to shared ArcgisInfoModals)

    const renderServiceLayerLinks = (service) => {
        const rawLayers = serviceLayers[service.key] || [];
        if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
            return <div className="arcgis-service-info-empty">Loading layer links…</div>;
        }

        const layerTree = buildLayerTree(rawLayers);
        const renderNodes = (nodes, depth = 0) => (
            nodes.map(node => {
                const layerId = node?.id;
                const label = node?.name || `Layer ${layerId}`;
                const hasLayerId = Number.isInteger(layerId);
                return (
                    <div key={`${service.key}-${layerId}-${depth}`} className="arcgis-service-info-layer-link-row" style={{ marginLeft: depth * 12 }}>
                        {hasLayerId ? (
                            <button
                                type="button"
                                className="arcgis-service-info-layer-link"
                                onClick={() => openLayerInfo(service, { id: layerId, name: label })}
                            >
                                {label}
                            </button>
                        ) : (
                            <span>{label}</span>
                        )}
                        {Array.isArray(node?.children) && node.children.length > 0 && renderNodes(node.children, depth + 1)}
                    </div>
                );
            })
        );

        return <div className="arcgis-service-info-layer-links">{renderNodes(layerTree)}</div>;
    };

    // Map loading spinner — rendered even when panel is closed (e.g. triggered from learn-more modal)
    const spinnerPortal = isMapLayerLoading && mapContainerEl && createPortal(
        <div className="arcgis-map-loading-overlay">
            <div className="arcgis-map-spinner">
                <div className="arcgis-spinner-dots">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="arcgis-spinner-dot" style={{ '--dot-index': i }} />
                    ))}
                </div>
                <div className="arcgis-spinner-text">loading...</div>
            </div>
        </div>,
        mapContainerEl
    );

    if (!isOpen) return spinnerPortal || null;

    // JSX return that renders the upload panel UI 
    return (
        <>
            {/* Map loading spinner overlay */}
            {spinnerPortal}
            {/* Upload Panel */}
            <div ref={panelRootRef} className={`upload-panel${splitBottom ? ' upload-panel--split-bottom' : ''}${isOnboardingOpen ? ' onboarding-locked' : ''}`} onContextMenu={e => e.preventDefault()}>
                <div className="upload-panel-header" data-onboarding-target="arcgis-state-selector">
                    <h3>Browse ArcGIS Services</h3>
                    <div className="upload-panel-header-actions">
                        <button className="upload-panel-header-close-btn upload-panel-header-close-btn--help" title="Help" onClick={() => window.open('/user-manual?section=arcgis-panel', '_blank')}>
                            <FontAwesomeIcon icon={faQuestion} />
                        </button>
                        <button className="upload-panel-header-close-btn upload-panel-header-close-btn--play" title="Tutorial" onClick={() => setIsOnboardingOpen(true)}>
                            <FontAwesomeIcon icon={faPlay} />
                        </button>
                        <button className="upload-panel-header-close-btn" onClick={onClose}>
                            <FontAwesomeIcon icon={faTimes} />
                        </button>
                    </div>
                </div>
                {/* Only show search bar and services when not loading database data */}
                {!isLoadingServices && (
                    <>
                        <div className="upload-panel-sticky-toolbar">
                            {renderSearchBar()}
                            <div className="upload-panel-opacity-slider-row" data-onboarding-target="arcgis-opacity-slider">
                                <label>Layer Opacity:</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={layerOpacity}
                                    onChange={e => handleOpacityChange(parseFloat(e.target.value))}
                                    className="upload-panel-opacity-slider"
                                    style={{ '--slider-pct': `${layerOpacity * 100}%` }}
                                />
                                <span className="upload-panel-opacity-value">{Math.round(layerOpacity * 100)}%</span>
                            </div>
                            <div className="upload-panel-controls-row" data-onboarding-target="arcgis-panel-actions">
                                <button 
                                    className="upload-panel-update-btn"
                                    onClick={handleUpdateServices}
                                    disabled={isUpdating}
                                    title="Update services data from ArcGIS REST servers"
                                >
                                    <FontAwesomeIcon icon={faSync} spin={isUpdating} />
                                </button>
                                <div className="upload-panel-controls-actions">
                                    <button
                                        type="button"
                                        data-onboarding-target="arcgis-show-added-button"
                                        className={`clear-all-layers-btn clear-all-layers-btn--toggle${showAddedOnly ? ' is-active' : ''}`}
                                        onClick={() => {
                                            setShowAddedOnly(prev => {
                                                const next = !prev;
                                                if (next) {
                                                    const foldersWithAdded = [];
                                                    const servicesWithAdded = [];
                                                    folderNames.forEach(folder => {
                                                        const hasAdded = servicesByFolder[folder].some(service =>
                                                            (checkedLayerIds[service.key] || []).length > 0
                                                        );
                                                        if (hasAdded) foldersWithAdded.push(folder);
                                                        servicesByFolder[folder].forEach(service => {
                                                            if ((checkedLayerIds[service.key] || []).length > 0) {
                                                                servicesWithAdded.push(service.key);
                                                            }
                                                        });
                                                    });
                                                    setExpandedFolders(new Set(foldersWithAdded));
                                                    setExpandedServices(new Set(servicesWithAdded));
                                                } else {
                                                    setExpandedFolders(new Set());
                                                    setExpandedServices(new Set());
                                                    setExpandedLayers(new Set());
                                                }
                                                return next;
                                            });
                                        }}
                                        aria-pressed={showAddedOnly}
                                        title={showAddedOnly ? 'Show all services' : 'Show only services added to the map'}
                                    >
                                        <FontAwesomeIcon icon={faEye} />
                                        <span>{showAddedOnly ? 'Showing Added Only' : 'Show Added Only'}</span>
                                    </button>
                                    <ClearAllLayersButton
                                        onClick={handleClearAllLayers}
                                        disabled={!Object.values(checkedLayerIds).some(ids => Array.isArray(ids) && ids.length > 0)}
                                    />
                                </div>
                            </div>
                            {/* Update progress display */}
                            {(updateProgress || updateResults) && (
                                <div className="upload-panel-update-progress">
                                    {updateProgress && (
                                        <div className={`update-progress-message ${isUpdating ? 'updating' : 'complete'}`}>
                                            {updateProgress}
                                        </div>
                                    )}
                                    {updateResults && updateResults.success && (
                                        <div className="update-results">
                                            <small>
                                                Found: {updateResults.totalFound || 0} | 
                                                Existing: {updateResults.existingCount || 0} | 
                                                New: {updateResults.newCount || 0}
                                            </small>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="upload-panel-folder-area-wrapper">
                            {searchResult && (
                                <div className="panel-nav-mini">
                                    <span className="panel-nav-mini-counter">
                                        {matchTotal > 0 ? `${navIndex + 1} / ${matchTotal}` : '0 results'}
                                    </span>
                                    <button
                                        className="panel-nav-mini-btn"
                                        title="Previous match"
                                        onClick={goToPrev}
                                        disabled={matchTotal === 0}
                                    >
                                        <FontAwesomeIcon icon={faChevronUp} />
                                    </button>
                                    <button
                                        className="panel-nav-mini-btn"
                                        title="Next match"
                                        onClick={goToNext}
                                        disabled={matchTotal === 0}
                                    >
                                        <FontAwesomeIcon icon={faChevronDown} />
                                    </button>
                                </div>
                            )}
                        <div className="upload-panel-folder-area" ref={folderAreaRef} data-onboarding-target="arcgis-folder-area">
                        {searchResult ? (
                            /* ── SEARCH MODE: full filtered tree ── */
                            (() => {
                            const _lk = searchResult.keyword || '';
                            const _matchBuiltinLayers = searchType === 'service' ? [] :
                                (searchType === 'folder'
                                    ? (BUILTIN_FOLDER_NAME.toLowerCase().includes(_lk) ? BUILTIN_LAYERS : [])
                                    : BUILTIN_LAYERS.filter(l => l.label.toLowerCase().includes(_lk)));
                            const _showBuiltin = searchType === 'folder'
                                ? BUILTIN_FOLDER_NAME.toLowerCase().includes(_lk)
                                : _matchBuiltinLayers.length > 0;
                            return (<>
                            {STATE_CODES.map(stateCode => {
                                const stateData = stateFoldersToShow[stateCode];
                                if (!stateData || stateData.folders.length === 0) return null;
                                const isStateExpanded = expandedStates.has(stateCode);
                                return (
                                    <div key={stateCode}>
                                        <div className="upload-state-folder" onClick={() => {
                                                setSearchKeyword('');
                                                setSearchResult(null);
                                                handleStateDoubleClick(stateCode);
                                            }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                                <FontAwesomeIcon icon={faFolder} />{STATE_FULL_NAMES[stateCode] || stateCode}
                                            </span>
                                        </div>
                                        {isStateExpanded && (
                                            <div className="upload-state-folder-content">
                                                {stateData.folders.map(folder => (
                                                    <div key={folder}>
                                                        <div
                                                            className="upload-folder"
                                                            style={searchResult?.matchedFolderNames?.has(folder) ? { fontWeight: 'bold' } : undefined}
                                                            data-search-match-id={searchResult?.matchedFolderNames?.has(folder) ? `folder-${stateCode}-${folder}` : undefined}
                                                            onClick={() => {
                                                                setSearchKeyword('');
                                                                setSearchResult(null);
                                                                setCurrentPath({ stateCode, folder });
                                                            }}
                                                            onContextMenu={(e) => handleContextMenu(e, 'folder', { folder })}
                                                        >
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                                <FontAwesomeIcon icon={faFolder} />
                                                                <ArcgisRenameItem value={folder} onSave={(newName) => handleFolderRename(folder, newName)} placeholder="Enter folder name..." isFolder={true} disabled={!isAdmin} startEditing={renamingItem?.type === 'folder' && renamingItem?.key === folder} onEditingDone={() => setRenamingItem(null)} />
                                                            </span>
                                                        </div>
                                                        {expandedFolders.has(folder) && (
                                                            <div className="tree-children">
                                                                {stateData.byFolder[folder].map(service => {
                                                                    const layers = serviceLayers[service.key] || [];
                                                                    const checkedIds = checkedLayerIds[service.key] || [];
                                                                    const rawLayers = layers.length > 0 ? layers : (service.layers || []);
                                                                    const layerTree = buildLayerTree(Array.isArray(rawLayers) ? rawLayers : []);
                                                                    const allFeatureLayers = getAllLeafLayers(layerTree);
                                                                    return (
                                                                        <div key={service.key} className="tree-node" data-service-key={service.key}>
                                                                            <div
                                                                                className={`upload-item${currentMatchId === `service-${service.key}` || chatbotHighlightTarget === `service-${service.key}` ? ' search-nav-current' : ''}${serviceInfoOpenKey === service.key ? ' service-info-active' : ''}`}
                                                                                style={searchResult?.matchedServiceKeys?.has(service.key) ? { fontWeight: 'bold' } : undefined}
                                                                                data-search-match-id={searchResult?.matchedServiceKeys?.has(service.key) ? `service-${service.key}` : undefined}
                                                                                onClick={() => handleServiceClick(service.key)}
                                                                                onContextMenu={(e) => handleContextMenu(e, 'service', { service, layersToShow: allFeatureLayers })}
                                                                            >
                                                                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', minWidth: 0, flex: 1 }}>
                                                                                    <input type="checkbox" data-onboarding-target="arcgis-service-checkbox" checked={checkedIds.length > 0 && checkedIds.length === allFeatureLayers.length} ref={el => { if (el) el.indeterminate = checkedIds.length > 0 && checkedIds.length < allFeatureLayers.length; }} onChange={(e) => { e.stopPropagation(); handleSelectAll(service, allFeatureLayers); }} onClick={(e) => e.stopPropagation()} style={{ marginRight: 4, flexShrink: 0 }} />
                                                                                    {expandedServices.has(service.key) ? '▼' : '►'}
                                                                                    <ArcgisRenameItem value={service.label} displayValue={service.label} onSave={(newLabel) => handleServiceRename(service.key, newLabel)} placeholder="Enter service name..." isFolder={false} disabled={!isAdmin} startEditing={renamingItem?.type === 'service' && renamingItem?.key === service.key} onEditingDone={() => setRenamingItem(null)} />
                                                                                </span>
                                                                                <button
                                                                                    className="arcgis-service-row-action-btn"
                                                                                    data-onboarding-target="arcgis-service-info-button"
                                                                                    onClick={(e) => { e.stopPropagation(); openServiceInfo(service); }}
                                                                                    title="Learn more"
                                                                                >
                                                                                    <FontAwesomeIcon icon={faEllipsisV} />
                                                                                </button>
                                                                            </div>
                                                                            {expandedServices.has(service.key) && (
                                                                                <div className="tree-children" data-onboarding-target="arcgis-layer-tree">
                                                                                    {serviceLayersLoading[service.key] ? (
                                                                                        <div className="upload-panel-layers-loading">Loading layers…</div>
                                                                                    ) : (
                                                                                        <ul className="tree-children" style={{ listStyle: 'none' }}>
                                                                                            {layerTree.map(node => renderLayerNode(node, service, checkedIds, allFeatureLayers))}
                                                                                        </ul>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                                <div className="upload-panel-attribution" style={{ marginTop: 4, marginBottom: 2 }}>
                                                    Data sources: {usingFallback ? 'Local JSON Files' : 'Backend Database'} • <a href={STATE_ATTRIBUTION[stateCode]?.url} target="_blank" rel="noopener noreferrer">{STATE_ATTRIBUTION[stateCode]?.name} ArcGIS Services</a>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {/* Built-in Layers folder — only shown when there are matching results */}
                            {_showBuiltin && <div>
                                <div
                                    className="upload-state-folder"
                                    onClick={() => {
                                        setExpandedStates(prev => {
                                            const newSet = new Set(prev);
                                            if (newSet.has('__builtin__')) newSet.delete('__builtin__');
                                            else newSet.add('__builtin__');
                                            return newSet;
                                        });
                                    }}
                                >
                                    <span>{BUILTIN_FOLDER_NAME}</span>
                                </div>
                                {expandedStates.has('__builtin__') && (
                                    <div className="upload-state-folder-content">
                                        {(searchType === 'folder' ? BUILTIN_LAYERS : _matchBuiltinLayers).map(layer => (
                                            <div key={layer.id} className="tree-node" style={{ paddingLeft: 18 }}>
                                                <label className="upload-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={!!areaVisibility[layer.id]} onChange={() => handleAreaCheckbox?.(layer.id)} style={{ marginRight: 4 }} />
                                                    {layer.label}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>}
                            </>);})()
                        ) : (
                            /* ── NAVIGATION MODE ── */
                            <>
                            {/* Breadcrumb */}
                            {currentPath.stateCode !== null && (
                                <div className="upload-panel-breadcrumb">
                                    <button className="upload-panel-breadcrumb-back" onClick={handleNavBack} title="Back">←</button>
                                    <span className="upload-panel-breadcrumb-path">
                                        {currentPath.stateCode === '__builtin__'
                                            ? BUILTIN_FOLDER_NAME
                                            : currentPath.folder !== null
                                                ? <>{STATE_FULL_NAMES[currentPath.stateCode] || currentPath.stateCode} <span className="upload-panel-breadcrumb-sep">/</span> {currentPath.folder === '__builtin__' ? BUILTIN_FOLDER_NAME : currentPath.folder}</>
                                                : STATE_FULL_NAMES[currentPath.stateCode] || currentPath.stateCode
                                        }
                                    </span>
                                </div>
                            )}

                            {/* ROOT: list state folders + builtin */}
                            {currentPath.stateCode === null && (
                                <>
                                    {STATE_CODES.map(stateCode => {
                                        const stateData = stateFoldersToShow[stateCode];
                                        if (!stateData || stateData.folders.length === 0) return null;
                                        return (
                                            <div
                                                key={stateCode}
                                                className="upload-state-folder"
                                                data-onboarding-target="arcgis-state-folder"
                                                onClick={() => handleStateDoubleClick(stateCode)}
                                                title="Click to open"
                                            >
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                                    <FontAwesomeIcon icon={faFolder} />{STATE_FULL_NAMES[stateCode] || stateCode}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    <div
                                        className="upload-state-folder"
                                        data-onboarding-target="arcgis-state-folder"
                                        onClick={() => setCurrentPath({ stateCode: '__builtin__', folder: '__builtin__' })}
                                        title="Click to open"
                                    >
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                            <FontAwesomeIcon icon={faFolder} />{BUILTIN_FOLDER_NAME}
                                        </span>
                                    </div>
                                </>
                            )}

                            {/* BUILTIN VIEW */}
                            {currentPath.stateCode === '__builtin__' && (
                                <div className="upload-state-folder-content">
                                    {BUILTIN_LAYERS.map(layer => (
                                        <div key={layer.id} className="tree-node" style={{ paddingLeft: 18 }}>
                                            <label className="upload-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, cursor: 'pointer' }}>
                                                <input type="checkbox" checked={!!areaVisibility[layer.id]} onChange={() => handleAreaCheckbox?.(layer.id)} style={{ marginRight: 4 }} />
                                                {layer.label}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* STATE VIEW: list folders */}
                            {currentPath.stateCode !== null && currentPath.stateCode !== '__builtin__' && currentPath.folder === null && (
                                <>
                                    {(stateFoldersToShow[currentPath.stateCode]?.folders || []).map(folder => (
                                        <div key={folder}>
                                            <div
                                                className="upload-folder"
                                                onClick={() => handleFolderDoubleClick(folder)}
                                                onContextMenu={(e) => handleContextMenu(e, 'folder', { folder })}
                                                title="Click to open"
                                            >
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    <FontAwesomeIcon icon={faFolder} />
                                                    <ArcgisRenameItem value={folder} onSave={(newName) => handleFolderRename(folder, newName)} placeholder="Enter folder name..." isFolder={true} disabled={!isAdmin} startEditing={renamingItem?.type === 'folder' && renamingItem?.key === folder} onEditingDone={() => setRenamingItem(null)} />
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="upload-panel-attribution" style={{ marginTop: 4, marginBottom: 2 }}>
                                        Data sources: {usingFallback ? 'Local JSON Files' : 'Backend Database'} • <a href={STATE_ATTRIBUTION[currentPath.stateCode]?.url} target="_blank" rel="noopener noreferrer">{STATE_ATTRIBUTION[currentPath.stateCode]?.name} ArcGIS Services</a>
                                    </div>
                                </>
                            )}

                            {/* FOLDER VIEW: list services */}
                            {currentPath.stateCode !== null && currentPath.stateCode !== '__builtin__' && currentPath.folder !== null && (
                                <>
                                    {currentPath.folder === '__builtin__' && (
                                        <div className="upload-state-folder-content">
                                            {BUILTIN_LAYERS.map(layer => (
                                                <div key={layer.id} className="tree-node" style={{ paddingLeft: 18 }}>
                                                    <label className="upload-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={!!areaVisibility[layer.id]} onChange={() => handleAreaCheckbox?.(layer.id)} style={{ marginRight: 4 }} />
                                                        {layer.label}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {currentPath.folder !== '__builtin__' && (stateFoldersToShow[currentPath.stateCode]?.byFolder[currentPath.folder] || []).map(service => {
                                        const layers = serviceLayers[service.key] || [];
                                        const checkedIds = checkedLayerIds[service.key] || [];
                                        const rawLayers = layers.length > 0 ? layers : (service.layers || []);
                                        const layerTree = buildLayerTree(Array.isArray(rawLayers) ? rawLayers : []);
                                        const allFeatureLayers = getAllLeafLayers(layerTree);
                                        return (
                                            <div key={service.key} className="tree-node" data-service-key={service.key}>
                                                <div
                                                    className={`upload-item${chatbotHighlightTarget === `service-${service.key}` ? ' search-nav-current' : ''}${serviceInfoOpenKey === service.key ? ' service-info-active' : ''}`}
                                                    onClick={() => handleServiceClick(service.key)}
                                                    onContextMenu={(e) => handleContextMenu(e, 'service', { service, layersToShow: allFeatureLayers })}
                                                >
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', minWidth: 0, flex: 1 }}>
                                                        <input type="checkbox" data-onboarding-target="arcgis-service-checkbox" checked={checkedIds.length > 0 && checkedIds.length === allFeatureLayers.length} ref={el => { if (el) el.indeterminate = checkedIds.length > 0 && checkedIds.length < allFeatureLayers.length; }} onChange={(e) => { e.stopPropagation(); handleSelectAll(service, allFeatureLayers); }} onClick={(e) => e.stopPropagation()} style={{ marginRight: 4, flexShrink: 0 }} />
                                                        {expandedServices.has(service.key) ? '▼' : '►'}
                                                        <ArcgisRenameItem value={service.label} displayValue={service.label} onSave={(newLabel) => handleServiceRename(service.key, newLabel)} placeholder="Enter service name..." isFolder={false} disabled={!isAdmin} startEditing={renamingItem?.type === 'service' && renamingItem?.key === service.key} onEditingDone={() => setRenamingItem(null)} />
                                                    </span>
                                                    <button
                                                        className="arcgis-service-row-action-btn"
                                                        data-onboarding-target="arcgis-service-info-button"
                                                        onClick={(e) => { e.stopPropagation(); openServiceInfo(service); }}
                                                        title="Learn more"
                                                    >
                                                        <FontAwesomeIcon icon={faEllipsisV} />
                                                    </button>
                                                </div>
                                                {expandedServices.has(service.key) && (
                                                    <div className="tree-children" data-onboarding-target="arcgis-layer-tree">
                                                        {serviceLayersLoading[service.key] ? (
                                                            <div className="upload-panel-layers-loading">Loading layers…</div>
                                                        ) : (
                                                            <ul className="tree-children" style={{ listStyle: 'none' }}>
                                                                {layerTree.map(node => renderLayerNode(node, service, checkedIds, allFeatureLayers))}
                                                            </ul>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <div className="upload-panel-attribution" style={{ marginTop: 4, marginBottom: 2 }}>
                                        Data sources: {usingFallback ? 'Local JSON Files' : 'Backend Database'} • <a href={STATE_ATTRIBUTION[currentPath.stateCode]?.url} target="_blank" rel="noopener noreferrer">{STATE_ATTRIBUTION[currentPath.stateCode]?.name} ArcGIS Services</a>
                                    </div>
                                </>
                            )}
                            </>
                        )}
                        </div>
                        </div>{/* end upload-panel-folder-area-wrapper */}
                
                {/* Context Menu */}
                <LayerContextMenuPopup
                    contextMenu={contextMenu}
                    isPinned={isPinned}
                    onLearnMore={handleContextLearnMore}
                    onTogglePin={handleTogglePinGuarded}
                    extraServiceItems={[
                        { label: 'Save to Custom Layers', onClick: handleSaveToCustomLayers },
                    ]}
                />


                
                <div className="arcgis-loading-messages">
                    {messages.map((msg, idx) => (
                        <div key={msg.id} className={`arcgis-loading-message ${msg.type}`}>
                            {msg.text}
                        </div>
                    ))}
                </div>
                    </>
                )}
            </div>

            {/* Service info modal (right side) — shared component */}
            <ServiceInfoModal
                serviceKey={serviceInfoOpenKey}
                service={serviceInfoOpenKey ? (ARCGIS_SERVICES.find(s => s.key === serviceInfoOpenKey) || null) : null}
                info={serviceInfoOpenKey ? serviceInfoCache[serviceInfoOpenKey] : null}
                loading={serviceInfoLoading}
                getStyle={getInfoModalStyle}
                onboardingPrefix="arcgis"
                onClose={closeServiceInfo}
                mapInstance={mapInstance}
                defaultOpacity={layerOpacity}
                renderLayerLinks={renderServiceLayerLinks}
                onSave={handleSaveServiceFromInfoModal}
            />

            {/* Layer Info Modal — shared component */}
            <LayerInfoModal
                layerInfo={layerInfoOpen}
                info={layerInfoOpen ? layerInfoCache[`${layerInfoOpen.serviceKey}-${layerInfoOpen.layerId}`] : null}
                loading={layerInfoLoading}
                getStyle={getLayerInfoModalStyle}
                onboardingPrefix="arcgis"
                onClose={closeLayerInfo}
                mapInstance={mapInstance}
                defaultOpacity={layerOpacity}
                rawLayers={layerInfoOpen ? (serviceLayers[layerInfoOpen.serviceKey] || []) : []}
                legend={layerInfoOpen ? serviceLegends[layerInfoOpen.serviceKey] : null}
                onOpenLayerInfo={openLayerInfo}
                onSave={handleSaveLayerToCustomLayers}
                showMessage={showFinishedMessage}
            />

            {/* State menu: outside the upload panel */}
            {/* renderStateMenu() - disabled, DB/Local toggle moved to toolbar */}

            {/* Login Required Prompt */}
            {showLoginPrompt && createPortal(
                <div
                    className="login-prompt-overlay"
                    onClick={() => setShowLoginPrompt(false)}
                >
                    <div
                        className="login-prompt-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p>Please log in to use this feature.</p>
                        <div className="login-prompt-actions">
                            <a href="/login" className="login-prompt-btn login-prompt-btn--primary">Log In</a>
                            <button
                                className="login-prompt-btn login-prompt-btn--secondary"
                                onClick={() => setShowLoginPrompt(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            <ArcgisUploadPanelOnboarding
                isOpen={isOnboardingOpen}
                onClose={() => setIsOnboardingOpen(false)}
                isPanelCollapsed={!isOpen}
                onStepChange={setOnboardingStepIndex}
            />
        </>
    );
}

export default ArcgisUploadPanel;