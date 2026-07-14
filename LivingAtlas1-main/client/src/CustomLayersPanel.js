import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal, unstable_batchedUpdates } from "react-dom";
import { addArcgisVectorLayer } from './arcgisVectorUtils';
import { showArcgisPopup } from './arcgisPopupUtils';
import {
    fetchArcgisLayers,
    fetchArcgisLegend,
    getArcgisTileUrl,
    fetchArcgisServiceInfo,
    fetchArcgisLayerInfo,
} from './arcgisDataUtils';
import { fetchCustomLayers, deleteCustomLayer, reorderCustomLayers, saveLayerOrder, fetchCustomFolders, createCustomFolder, deleteCustomFolder, renameCustomFolder, saveCustomLayer } from './arcgisServicesDb';
import { buildLayerTree, getAllLeafLayers, getDescendantLeafLayers, LayerTreeNode } from './LayerTree';
import { filterUploadPanelData } from './arcgisUploadSearchUtils';
import { buildMatchList, useSearchNav } from './arcgisSearchNavUtils';
import ArcgisRenameItem from './ArcgisRenameItem';
import { useLayerContextMenu, LayerContextMenuPopup } from './LayerContextMenu';
import { ServiceInfoModal, LayerInfoModal } from './ArcgisInfoModals';
import './CustomLayersPanel.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faSearch, faFolderPlus, faChevronUp, faChevronDown, faQuestion, faEllipsisV, faPlay, faEye } from '@fortawesome/free-solid-svg-icons';
import { faFolder } from '@fortawesome/free-regular-svg-icons';
import ClearAllLayersButton from './ClearAllLayersButton';
import CustomLayersPanelOnboarding from './OnboardingCustomLayersPanel';

function CustomLayersPanel({
    isOpen,
    onClose,
    splitBottom = false,
    mapInstance,
    refreshKey = 0,
}) {
    const userEmail = localStorage.getItem('email') || '';

    const [customServices, setCustomServices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [dbFolders, setDbFolders] = useState([]); // user-created folders from DB

    // Per-service state
    const [serviceLayers, setServiceLayers] = useState({});
    const [serviceLegends, setServiceLegends] = useState({});
    const [checkedLayerIds, setCheckedLayerIds] = useState({});
    const [checkedSublayerIds, setCheckedSublayerIds] = useState({});
    const [serviceLayerAdded, setServiceLayerAdded] = useState({});

    const [expandedFolders, setExpandedFolders] = useState(new Set());
    const [currentPath, setCurrentPath] = useState(''); // '' = root view, path string = inside a folder (nested via '/' separator)
    const [expandedServices, setExpandedServices] = useState(new Set());
    const [expandedLayers, setExpandedLayers] = useState(new Set());

    const [layerOpacity, setLayerOpacity] = useState(0.7);
    const [statusMsg, setStatusMsg] = useState(null);
    const panelRootRef = useRef(null);

    // Search & filter state
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchType, setSearchType] = useState('any');
    const [searchResult, setSearchResult] = useState(null);
    const [serviceLayersLoading, setServiceLayersLoading] = useState({}); // { key: bool } — tracks in-flight layer fetches triggered by search

    // Search navigation
    const matchList = useMemo(
        () => buildMatchList({ searchResult, allServicesByState: { CUSTOM: customServices }, stateCodes: ['CUSTOM'], serviceLayers }),
        [searchResult, serviceLayers] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const { currentIndex: navIndex, total: matchTotal, currentMatchId, goToNext, goToPrev, initNav, resetNav } = useSearchNav(matchList);
    const [showAddedOnly, setShowAddedOnly] = useState(false);
    const statusTimer = useRef(null);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
    const onboardingSnapshotRef = useRef(null);

    const prevCheckedLayerIds = useRef({});
    const activeSearchRef = useRef(null); // { keyword, searchType } — tracks active search for auto re-run when layers load
    const loadedKeyRef = useRef(null); // tracks "userEmail:refreshKey" for which data is loaded

    // Rename state
    const [renamingItem, setRenamingItem] = useState(null);

    // Pin state (separate storage key from upload panel)
    const PINNED_STORAGE_KEY = 'custom_layers_pinned_items';
    const loadPinnedItems = () => {
        try {
            const raw = localStorage.getItem(PINNED_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    };
    const savePinnedItems = (items) => {
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(items));
    };
    const [pinnedItems, setPinnedItems] = useState(() => loadPinnedItems());

    useEffect(() => {
        savePinnedItems(pinnedItems);
    }, [pinnedItems]);

    // Context menu hook (state, outside-click, pin/unpin)
    const {
        contextMenu,
        handleContextMenu,
        closeContextMenu,
        isPinned,
        handleTogglePin,
    } = useLayerContextMenu({ pinnedItems, setPinnedItems });

    // Service info modal state
    const [serviceInfoOpenKey, setServiceInfoOpenKey] = useState(null);
    const [serviceInfoCache, setServiceInfoCache] = useState({});
    const [serviceInfoLoading, setServiceInfoLoading] = useState(false);

    // Layer info modal state
    const [layerInfoOpen, setLayerInfoOpen] = useState(null);
    const [layerInfoCache, setLayerInfoCache] = useState({});
    const [layerInfoLoading, setLayerInfoLoading] = useState(false);

    const showStatus = (msg) => {
        setStatusMsg(msg);
        if (statusTimer.current) clearTimeout(statusTimer.current);
        statusTimer.current = setTimeout(() => setStatusMsg(null), 3000);
    };

    // Load custom layers + folders from backend — once per user+refreshKey, not on every panel open/close
    useEffect(() => {
        if (!isOpen || !userEmail) return;
        const loadKey = `${userEmail}:${refreshKey}`;
        if (loadedKeyRef.current === loadKey) return; // already loaded for this user/version
        setIsLoading(true);
        let active = true;
        (async () => {
            try {
                const [layers, folders] = await Promise.all([
                    fetchCustomLayers(userEmail),
                    fetchCustomFolders(userEmail),
                ]);
                if (active) {
                    unstable_batchedUpdates(() => {
                        setCustomServices(layers);
                        setDbFolders(folders);
                        setIsLoading(false);
                    });
                    loadedKeyRef.current = loadKey;
                }
            } catch (err) {
                console.warn('[CustomLayersPanel] Failed to load custom layers:', err);
                if (active) setIsLoading(false);
            }
        })();
        return () => { active = false; };
    }, [isOpen, userEmail, refreshKey]);

    // Group services by folder (preserving sort_order from DB)
    const servicesByFolder = {};
    const folderFirstOrder = {};
    // Include user-created folders (even if empty)
    dbFolders.forEach(f => {
        if (!servicesByFolder[f.folder_name]) servicesByFolder[f.folder_name] = [];
        if (folderFirstOrder[f.folder_name] === undefined) folderFirstOrder[f.folder_name] = f.sort_order ?? 999;
    });
    customServices.forEach(service => {
        const folder = service.folder || 'Root';
        if (!servicesByFolder[folder]) servicesByFolder[folder] = [];
        servicesByFolder[folder].push(service);
        // Track the minimum sort_order in each folder (for folder ordering)
        if (folderFirstOrder[folder] === undefined || service.sort_order < folderFirstOrder[folder]) {
            folderFirstOrder[folder] = service.sort_order;
        }
    });
    const folderNames = Object.keys(servicesByFolder).sort((a, b) => (folderFirstOrder[a] ?? 0) - (folderFirstOrder[b] ?? 0));

    const findFirstRootFolder = useCallback(() => {
        const rootFolders = folderNames.filter(folder => !folder.includes('/'));
        return rootFolders.find(folder => (servicesByFolder[folder] || []).length > 0) || rootFolders[0] || folderNames[0] || null;
    }, [folderNames, servicesByFolder]);

    const findFirstServiceInFolder = useCallback((folder) => {
        if (!folder) return null;
        return servicesByFolder[folder]?.[0] || null;
    }, [servicesByFolder]);

    const findFirstExpandableLayerKey = useCallback((service) => {
        if (!service) return null;
        const rawLayers = serviceLayers[service.key]?.length > 0 ? serviceLayers[service.key] : [];
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
        const rawLayers = serviceLayers[service.key]?.length > 0 ? serviceLayers[service.key] : [];
        const layers = Array.isArray(rawLayers) ? rawLayers : [];
        return layers.find(layer => layer && layer.id !== undefined && layer.type !== 'Group Layer')
            || layers.find(layer => layer && layer.id !== undefined)
            || null;
    }, [serviceLayers]);

    useEffect(() => {
        if (isOnboardingOpen) {
            onboardingSnapshotRef.current = {
                searchKeyword,
                searchType,
                searchResult,
                currentPath,
                showAddedOnly,
                expandedFolders,
                expandedServices,
                expandedLayers,
            };

            setSearchKeyword('');
            setSearchType('any');
            setSearchResult(null);
            setCurrentPath('');
            setShowAddedOnly(false);
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
        setSearchType(snapshot.searchType);
        setSearchResult(snapshot.searchResult);
        setCurrentPath(snapshot.currentPath);
        setShowAddedOnly(snapshot.showAddedOnly);
        setExpandedFolders(snapshot.expandedFolders);
        setExpandedServices(snapshot.expandedServices);
        setExpandedLayers(snapshot.expandedLayers);
        onboardingSnapshotRef.current = null;
    }, [isOnboardingOpen]);

    useEffect(() => {
        if (!isOnboardingOpen) return;

        const firstFolder = findFirstRootFolder();
        const firstService = findFirstServiceInFolder(firstFolder);
        const expandableLayerKey = findFirstExpandableLayerKey(firstService);

        if (onboardingStepIndex >= 2) {
            setCurrentPath('');
        }

        if (onboardingStepIndex >= 3 && firstFolder) {
            setCurrentPath(firstFolder);
            setExpandedFolders(prev => {
                const next = new Set(prev);
                next.add(firstFolder);
                return next;
            });
        }

        if (onboardingStepIndex >= 5 && firstService) {
            setExpandedServices(prev => {
                const next = new Set(prev);
                next.add(firstService.key);
                return next;
            });
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
        findFirstRootFolder,
        findFirstServiceInFolder,
        findFirstExpandableLayerKey,
    ]);

    // --- Search handler ---
    const isSearchLoadingLayers = searchResult !== null && Object.keys(serviceLayersLoading).length > 0;

    // Returns services scoped to current navigation path.
    const getScopedServices = (path = currentPath) => {
        if (!path) return customServices;
        return customServices.filter(service => (service.folder || 'Root') === path);
    };

    // Trigger loading of any not-yet-fetched service layers so layer-name matches aren't missed
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

    const doSearch = () => {
        if (!searchKeyword) {
            activeSearchRef.current = null;
            setSearchResult(null);
            setExpandedFolders(new Set());
            setExpandedServices(new Set());
            setExpandedLayers(new Set());
            resetNav();
            return;
        }
        const scopedServicesList = getScopedServices();
        const result = filterUploadPanelData({
            services: scopedServicesList,
            serviceLayers,
            searchType,
            keyword: searchKeyword,
        });
        setSearchResult(result);
        activeSearchRef.current = { keyword: searchKeyword, searchType, scopedServices: scopedServicesList };
        setExpandedFolders(new Set(result.expandedFolders));
        setExpandedServices(new Set(result.expandedServices));
        setExpandedLayers(new Set(result.expandedLayerKeys));
        const mList = buildMatchList({ searchResult: result, allServicesByState: { CUSTOM: scopedServicesList }, stateCodes: ['CUSTOM'], serviceLayers });
        initNav(mList);
        triggerLayerLoadForSearch(searchType, scopedServicesList);
    };

    const clearSearch = () => {
        activeSearchRef.current = null;
        setSearchKeyword('');
        setSearchResult(null);
        setExpandedFolders(new Set());
        setExpandedServices(new Set());
        setExpandedLayers(new Set());
        resetNav();
    };

    // Helper: last segment of a path-based folder name
    const folderDisplayName = (fullPath) => fullPath.includes('/') ? fullPath.slice(fullPath.lastIndexOf('/') + 1) : fullPath;

    // --- Compute display folders/services with search + showAddedOnly ---
    let foldersToShow = searchResult ? Object.keys(searchResult.filteredFolders) : (() => {
        if (currentPath === '') return folderNames.filter(f => !f.includes('/'));
        const childPrefix = currentPath + '/';
        // current folder itself (for its direct services) + direct children at next level
        const children = folderNames.filter(f => f.startsWith(childPrefix) && !f.slice(childPrefix.length).includes('/'));
        return [currentPath, ...children];
    })();
    let servicesByFolderToShow = searchResult ? searchResult.filteredFolders : servicesByFolder;

    if (showAddedOnly) {
        const filteredFolders = {};
        foldersToShow.forEach(folder => {
            const filteredServices = (servicesByFolderToShow[folder] || []).filter(service =>
                (checkedLayerIds[service.key] || []).length > 0
            );
            if (filteredServices.length > 0) {
                filteredFolders[folder] = filteredServices;
            }
        });
        foldersToShow = Object.keys(filteredFolders);
        servicesByFolderToShow = filteredFolders;
    }

    // Pre-load layers for ALL services when panel opens (needed so search works on first use)
    useEffect(() => {
        if (!isOpen) return;
        customServices.forEach(service => {
            if (serviceLayers[service.key] !== undefined) return;
            if (!service.url || service.type !== 'MapServer') return;
            fetchArcgisLayers(service.url).then(layers => {
                setServiceLayers(prev => ({ ...prev, [service.key]: layers || [] }));
                setCheckedLayerIds(prev => prev[service.key] ? prev : { ...prev, [service.key]: [] });
                setServiceLayerAdded(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: false });
                setCheckedSublayerIds(prev => prev[service.key] !== undefined ? prev : { ...prev, [service.key]: {} });
            });
        });
    }, [isOpen, customServices]); // eslint-disable-line react-hooks/exhaustive-deps

    // Lazy-load legends when a service is expanded
    useEffect(() => {
        if (!isOpen) return;
        customServices.forEach(service => {
            if (!expandedServices.has(service.key)) return;
            if (!service.url || service.type !== 'MapServer') return;
            fetchArcgisLegend(service.url).then(legend => {
                setServiceLegends(prev => ({ ...prev, [service.key]: legend || {} }));
            });
        });
    }, [isOpen, customServices, expandedServices]);

    // Re-run filter when layers load in (handles first-search case where serviceLayers was still empty)
    useEffect(() => {
        if (!activeSearchRef.current) return;
        const { keyword, searchType: type } = activeSearchRef.current;
        const scopedServicesList = activeSearchRef.current.scopedServices || getScopedServices();
        const result = filterUploadPanelData({ services: scopedServicesList, serviceLayers, searchType: type, keyword });
        setSearchResult(result);
        setExpandedFolders(new Set(result.expandedFolders));
        setExpandedServices(new Set(result.expandedServices));
        setExpandedLayers(new Set(result.expandedLayerKeys));
        const mList = buildMatchList({ searchResult: result, allServicesByState: { CUSTOM: scopedServicesList }, stateCodes: ['CUSTOM'], serviceLayers });
        initNav(mList);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serviceLayers]);

    // Re-run active search when scoped services list changes (e.g. refresh / folder operations)
    useEffect(() => {
        if (!activeSearchRef.current) return;
        const { keyword, searchType: type } = activeSearchRef.current;
        const scopedServicesList = getScopedServices();
        activeSearchRef.current = { keyword, searchType: type, scopedServices: scopedServicesList };
        const result = filterUploadPanelData({ services: scopedServicesList, serviceLayers, searchType: type, keyword });
        setSearchResult(result);
        setExpandedFolders(new Set(result.expandedFolders));
        setExpandedServices(new Set(result.expandedServices));
        setExpandedLayers(new Set(result.expandedLayerKeys));
        const mList = buildMatchList({ searchResult: result, allServicesByState: { CUSTOM: scopedServicesList }, stateCodes: ['CUSTOM'], serviceLayers });
        initNav(mList);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customServices, currentPath]);

    // --- Map interaction: add/remove raster + vector layers per layer (matches ArcgisUploadPanel) ---
    useEffect(() => {
        const map = mapInstance && mapInstance();
        if (!map) return;

        customServices.forEach(service => {
            const layers = serviceLayers[service.key] || [];
            const prevChecked = prevCheckedLayerIds.current[service.key] || [];
            const currChecked = checkedLayerIds[service.key] || [];
            const serviceSublayers = checkedSublayerIds[service.key] || {};
            const prevSublayers = prevCheckedLayerIds.current[`${service.key}_sublayers`] || {};

            // --- VECTOR LAYERS ---
            const toRemove = prevChecked.filter(id => !currChecked.includes(id));
            const toAdd = currChecked.filter(id => !prevChecked.includes(id));

            toRemove.forEach(id => {
                const baseId = `arcgis-vector-layer-custom-${service.key}-${id}`;
                const fillId = baseId;
                const lineId = `${baseId}-outline`;
                const circleId = `${baseId}-circle`;
                const sourceId = `arcgis-vector-source-custom-${service.key}-${id}`;
                [fillId, lineId, circleId].forEach(lid => {
                    if (map.getLayer(lid)) map.removeLayer(lid);
                });
                if (map.getSource(sourceId)) map.removeSource(sourceId);
            });

            toAdd.forEach(id => {
                const layer = layers.find(l => l.id === id);
                if (layer) {
                    addArcgisVectorLayer(
                        map,
                        { ...layer, serviceKey: `custom-${service.key}`, serviceUrl: service.url },
                        showArcgisPopup,
                        { minzoom: 6 }
                    );
                }
            });

            // --- RASTER LAYERS ---
            // Remove rasters for completely unchecked layers
            toRemove.forEach(layerId => {
                const layerRasterPrefix = `arcgis-raster-layer-custom-${service.key}-${layerId}`;
                const style = map.getStyle();
                if (style?.layers) {
                    style.layers
                        .filter(l => l.id.startsWith(layerRasterPrefix))
                        .forEach(l => { if (map.getLayer(l.id)) map.removeLayer(l.id); });
                }
                if (style?.sources) {
                    Object.keys(style.sources)
                        .filter(id => id.startsWith(`arcgis-raster-custom-${service.key}-${layerId}`))
                        .forEach(id => { if (map.getSource(id)) map.removeSource(id); });
                }
            });

            // Handle sublayer changes for currently checked layers
            currChecked.forEach(layerId => {
                const layer = layers.find(l => l.id === layerId);
                if (!layer) return;

                const legend = serviceLegends[service.key];
                const legendLayer = legend?.layers?.find(l => l.layerId === layerId);
                const legendItems = legendLayer?.legend || [];
                const checkedSublayers = serviceSublayers[layerId] || [];
                const prevCheckedSublayers = prevSublayers[layerId] || [];
                const sublayersChanged = JSON.stringify([...checkedSublayers].sort()) !== JSON.stringify([...prevCheckedSublayers].sort());

                if (legendItems.length > 1) {
                    if (sublayersChanged || toAdd.includes(layerId)) {
                        // Remove existing rasters for this layer
                        const layerRasterPrefix = `arcgis-raster-layer-custom-${service.key}-${layerId}`;
                        const style = map.getStyle();
                        if (style?.layers) {
                            style.layers
                                .filter(l => l.id.startsWith(layerRasterPrefix))
                                .forEach(l => { if (map.getLayer(l.id)) map.removeLayer(l.id); });
                        }
                        if (style?.sources) {
                            Object.keys(style.sources)
                                .filter(id => id.startsWith(`arcgis-raster-custom-${service.key}-${layerId}`))
                                .forEach(id => { if (map.getSource(id)) map.removeSource(id); });
                        }
                        // Add rasters for checked sublayers
                        if (checkedSublayers.length > 0) {
                            checkedSublayers.forEach(sublayerIndex => {
                                const sublayerSourceId = `arcgis-raster-custom-${service.key}-${layerId}-sub-${sublayerIndex}`;
                                const sublayerLayerId = `arcgis-raster-layer-custom-${service.key}-${layerId}-sub-${sublayerIndex}`;
                                map.addSource(sublayerSourceId, {
                                    type: 'raster',
                                    tiles: [getArcgisTileUrl(service.url, [layerId])],
                                    tileSize: 256,
                                    minzoom: 6,
                                    maxzoom: 12
                                });
                                map.addLayer({
                                    id: sublayerLayerId,
                                    type: 'raster',
                                    source: sublayerSourceId,
                                    minzoom: 6,
                                    paint: { 'raster-opacity': layerOpacity }
                                });
                            });
                        }
                    }
                } else if (toAdd.includes(layerId)) {
                    const rasterSourceId = `arcgis-raster-custom-${service.key}-${layerId}`;
                    const rasterLayerId = `arcgis-raster-layer-custom-${service.key}-${layerId}`;
                    if (map.getLayer(rasterLayerId)) map.removeLayer(rasterLayerId);
                    if (map.getSource(rasterSourceId)) map.removeSource(rasterSourceId);
                    map.addSource(rasterSourceId, {
                        type: 'raster',
                        tiles: [getArcgisTileUrl(service.url, [layerId])],
                        tileSize: 256,
                        minzoom: 6,
                        maxzoom: 12
                    });
                    map.addLayer({
                        id: rasterLayerId,
                        type: 'raster',
                        source: rasterSourceId,
                        minzoom: 6,
                        paint: { 'raster-opacity': layerOpacity }
                    });
                }
            });

            prevCheckedLayerIds.current[service.key] = currChecked;
            prevCheckedLayerIds.current[`${service.key}_sublayers`] = JSON.parse(JSON.stringify(serviceSublayers));
        });
        // eslint-disable-next-line
    }, [checkedLayerIds, serviceLayers, checkedSublayerIds]);

    // Clear all layers from map:
    const handleClearAllLayers = () => {
        setCheckedLayerIds({});
        setServiceLayerAdded({});
        setCheckedSublayerIds({});
    };

    // Opacity change handler — update all custom raster + vector layers
    const handleOpacityChange = (newOpacity) => {
        setLayerOpacity(newOpacity);
        const map = mapInstance && mapInstance();
        if (!map || !map.getStyle) return;
        const style = map.getStyle();
        if (!style || !Array.isArray(style.layers)) return;
        style.layers.forEach(l => {
            if (l.id.startsWith('arcgis-raster-layer-custom-')) {
                map.setPaintProperty(l.id, 'raster-opacity', newOpacity);
            } else if (l.id.startsWith('arcgis-vector-layer-custom-')) {
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

    // Helper to remove all map layers for a service
    const removeAllMapLayers = useCallback((service) => {
        const map = mapInstance && mapInstance();
        if (!map) return;
        const layers = serviceLayers[service.key] || [];
        layers.forEach(layer => {
            // Vector
            const baseId = `arcgis-vector-layer-custom-${service.key}-${layer.id}`;
            [baseId, `${baseId}-outline`, `${baseId}-circle`].forEach(lid => {
                if (map.getLayer(lid)) map.removeLayer(lid);
            });
            const vecSrc = `arcgis-vector-source-custom-${service.key}-${layer.id}`;
            if (map.getSource(vecSrc)) map.removeSource(vecSrc);
            // Raster
            const style = map.getStyle();
            if (style?.layers) {
                style.layers
                    .filter(l => l.id.startsWith(`arcgis-raster-layer-custom-${service.key}-${layer.id}`))
                    .forEach(l => { if (map.getLayer(l.id)) map.removeLayer(l.id); });
            }
            if (style?.sources) {
                Object.keys(style.sources)
                    .filter(id => id.startsWith(`arcgis-raster-custom-${service.key}-${layer.id}`))
                    .forEach(id => { if (map.getSource(id)) map.removeSource(id); });
            }
        });
    }, [mapInstance, serviceLayers]);

    // Handlers
    const handleFolderClick = (folder) => {
        if (searchResult) {
            setSearchKeyword('');
            setSearchResult(null);
            activeSearchRef.current = null;
            resetNav();
        }
        setCurrentPath(folder);
    };

    const handleNavBack = () => {
        setCurrentPath(prev => prev.includes('/') ? prev.slice(0, prev.lastIndexOf('/')) : '');
    };

    const handleServiceClick = (serviceKey) => {
        setExpandedServices(prev => {
            const next = new Set(prev);
            if (next.has(serviceKey)) next.delete(serviceKey); else next.add(serviceKey);
            return next;
        });
    };

    const handleLayerClick = (serviceKey, layerId) => {
        const expandKey = `${serviceKey}-${layerId}`;
        setExpandedLayers(prev => {
            const next = new Set(prev);
            if (next.has(expandKey)) next.delete(expandKey); else next.add(expandKey);
            return next;
        });
    };

    const handleLayerCheckbox = (service, layerId, allFeatureLayers) => {
        setCheckedLayerIds(prev => {
            const prevChecked = prev[service.key] || [];
            let newChecked;
            if (prevChecked.includes(layerId)) {
                newChecked = prevChecked.filter(id => id !== layerId);
                // Uncheck sublayers
                setCheckedSublayerIds(prevSub => ({
                    ...prevSub,
                    [service.key]: { ...prevSub[service.key], [layerId]: [] }
                }));
            } else {
                newChecked = [...prevChecked, layerId];
                // Check all sublayers
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layerId);
                    if (legendLayer && legendLayer.legend) {
                        setCheckedSublayerIds(prevSub => ({
                            ...prevSub,
                            [service.key]: {
                                ...prevSub[service.key],
                                [layerId]: legendLayer.legend.map((_, i) => i)
                            }
                        }));
                    }
                }
            }
            setServiceLayerAdded(prevAdded => ({ ...prevAdded, [service.key]: newChecked.length > 0 }));
            return { ...prev, [service.key]: newChecked };
        });
    };

    const handleSelectAll = (service, allFeatureLayers) => {
        const allIds = allFeatureLayers.map(l => l.id);
        const isAllChecked = (checkedLayerIds[service.key] || []).length === allIds.length;
        if (isAllChecked) {
            setCheckedLayerIds(prev => ({ ...prev, [service.key]: [] }));
            setServiceLayerAdded(prev => ({ ...prev, [service.key]: false }));
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: {} }));
        } else {
            setCheckedLayerIds(prev => ({ ...prev, [service.key]: allIds }));
            setServiceLayerAdded(prev => ({ ...prev, [service.key]: true }));
            const newSublayerIds = {};
            allFeatureLayers.forEach(layer => {
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layer.id);
                    if (legendLayer && legendLayer.legend && legendLayer.legend.length > 1) {
                        newSublayerIds[layer.id] = legendLayer.legend.map((_, i) => i);
                    }
                }
            });
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: newSublayerIds }));
        }
    };

    const handleGroupLayerCheckbox = (service, node, allChecked) => {
        const descendantLeaves = getDescendantLeafLayers(node);
        const descendantIds = descendantLeaves.map(l => l.id);
        if (descendantIds.length === 0) return;
        if (allChecked) {
            setCheckedLayerIds(prev => ({
                ...prev,
                [service.key]: (prev[service.key] || []).filter(id => !descendantIds.includes(id))
            }));
            setCheckedSublayerIds(prev => {
                const updated = { ...prev[service.key] };
                descendantIds.forEach(id => { updated[id] = []; });
                return { ...prev, [service.key]: updated };
            });
        } else {
            setCheckedLayerIds(prev => {
                const current = prev[service.key] || [];
                return { ...prev, [service.key]: [...new Set([...current, ...descendantIds])] };
            });
            const newSublayerIds = { ...(checkedSublayerIds[service.key] || {}) };
            descendantLeaves.forEach(layer => {
                const legend = serviceLegends[service.key];
                if (legend && legend.layers) {
                    const legendLayer = legend.layers.find(l => l.layerId === layer.id);
                    if (legendLayer && legendLayer.legend && legendLayer.legend.length > 1) {
                        newSublayerIds[layer.id] = legendLayer.legend.map((_, i) => i);
                    }
                }
            });
            setCheckedSublayerIds(prev => ({ ...prev, [service.key]: newSublayerIds }));
        }
        setServiceLayerAdded(prev => ({ ...prev, [service.key]: !allChecked }));
    };

    const handleSublayerCheckbox = (service, layerId, sublayerIndex, allFeatureLayers) => {
        setCheckedSublayerIds(prev => {
            const serviceSubIds = prev[service.key] || {};
            const layerSubIds = serviceSubIds[layerId] || [];
            let newLayerSubIds;
            if (layerSubIds.includes(sublayerIndex)) {
                newLayerSubIds = layerSubIds.filter(id => id !== sublayerIndex);
            } else {
                newLayerSubIds = [...layerSubIds, sublayerIndex];
            }
            // If no sublayers checked, uncheck parent layer
            if (newLayerSubIds.length === 0) {
                setCheckedLayerIds(prevChecked => ({
                    ...prevChecked,
                    [service.key]: (prevChecked[service.key] || []).filter(id => id !== layerId)
                }));
            } else {
                // If at least one sublayer, check parent layer
                setCheckedLayerIds(prevChecked => {
                    const currentChecked = prevChecked[service.key] || [];
                    if (!currentChecked.includes(layerId)) {
                        return { ...prevChecked, [service.key]: [...currentChecked, layerId] };
                    }
                    return prevChecked;
                });
            }
            setServiceLayerAdded(prevAdded => {
                const allCheckedLayers = Object.keys({ ...serviceSubIds, [layerId]: newLayerSubIds })
                    .filter(lid => {
                        const subIds = String(lid) === String(layerId) ? newLayerSubIds : serviceSubIds[lid] || [];
                        return subIds.length > 0;
                    });
                return { ...prevAdded, [service.key]: allCheckedLayers.length > 0 };
            });
            return { ...prev, [service.key]: { ...serviceSubIds, [layerId]: newLayerSubIds } };
        });
    };

    // Rename handlers (local state update + persist)
    const handleFolderRename = (oldName, newName) => {
        if (!newName || newName.trim() === '' || oldName === newName) return;
        setCustomServices(prev => prev.map(s =>
            s.folder === oldName ? { ...s, folder: newName } : s
        ));
        setDbFolders(prev => prev.map(f =>
            f.folder_name === oldName ? { ...f, folder_name: newName } : f
        ));
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(oldName)) { next.delete(oldName); next.add(newName); }
            return next;
        });
        renameCustomFolder(userEmail, oldName, newName).catch(err =>
            console.warn('[CustomLayersPanel] Failed to rename folder:', err)
        );
    };

    const handleServiceRename = (serviceKey, newLabel) => {
        if (!newLabel || newLabel.trim() === '') return;
        setCustomServices(prev => prev.map(s =>
            s.key === serviceKey ? { ...s, label: newLabel } : s
        ));
    };

    // --- Drag-and-drop reorder ---
    const [dragItem, setDragItem] = useState(null); // { type: 'folder'|'service', key, folder? }
    const [dragOverItem, setDragOverItem] = useState(null); // same shape
    const [breadcrumbDragOver, setBreadcrumbDragOver] = useState(false);

    const persistOrder = useCallback((services) => {
        const order = services.map((s, i) => ({
            service_key: s.key,
            folder: s.folder,
            sort_order: i,
        }));
        reorderCustomLayers(userEmail, order).catch(err =>
            console.warn('[CustomLayersPanel] Failed to persist reorder:', err)
        );
    }, [userEmail]);

    const handleDragStart = (e, type, key, folder) => {
        setDragItem({ type, key, folder });
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e, type, key, folder) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverItem({ type, key, folder });
    };

    const handleDragEnd = () => {
        setDragItem(null);
        setDragOverItem(null);
        setBreadcrumbDragOver(false);
    };

    const handleFolderDrop = (e, targetFolder) => {
        e.preventDefault();
        if (!dragItem) {
            handleDragEnd();
            return;
        }
        // Service dragged onto a folder header → move it into that folder
        if (dragItem.type === 'service') {
            if (dragItem.folder === targetFolder) {
                handleDragEnd();
                return;
            }
            setCustomServices(prev => {
                const updated = prev.map(s =>
                    s.key === dragItem.key ? { ...s, folder: targetFolder } : s
                ).map((s, i) => ({ ...s, sort_order: i }));
                persistOrder(updated);
                return updated;
            });
            handleDragEnd();
            return;
        }
        // Folder dragged onto another folder → nest: rename source path under target
        if (dragItem.type !== 'folder' || dragItem.key === targetFolder) {
            handleDragEnd();
            return;
        }
        const sourceFolder = dragItem.key;
        // Prevent dropping a folder into its own descendant
        if (targetFolder.startsWith(sourceFolder + '/')) {
            handleDragEnd();
            return;
        }
        const sourceName = folderDisplayName(sourceFolder);
        const newBasePath = targetFolder + '/' + sourceName;
        // Collect all folders that need renaming (source + its children)
        const foldersToRename = dbFolders
            .map(f => f.folder_name)
            .filter(f => f === sourceFolder || f.startsWith(sourceFolder + '/'));
        // Update local dbFolders
        setDbFolders(prev => prev.map(f => {
            if (f.folder_name === sourceFolder) return { ...f, folder_name: newBasePath };
            if (f.folder_name.startsWith(sourceFolder + '/')) return { ...f, folder_name: newBasePath + f.folder_name.slice(sourceFolder.length) };
            return f;
        }));
        // Update local services
        setCustomServices(prev => prev.map(s => {
            const sf = s.folder || 'Root';
            if (sf === sourceFolder) return { ...s, folder: newBasePath };
            if (sf.startsWith(sourceFolder + '/')) return { ...s, folder: newBasePath + sf.slice(sourceFolder.length) };
            return s;
        }));
        // Persist renames via API
        foldersToRename.forEach(oldName => {
            const newName = oldName === sourceFolder ? newBasePath : newBasePath + oldName.slice(sourceFolder.length);
            renameCustomFolder(userEmail, oldName, newName).catch(err =>
                console.warn('[CustomLayersPanel] Failed to persist nested folder rename:', err)
            );
        });
        // If browsing inside the moved subtree, update currentPath
        if (currentPath === sourceFolder || currentPath.startsWith(sourceFolder + '/')) {
            setCurrentPath(newBasePath + currentPath.slice(sourceFolder.length));
        }
        handleDragEnd();
    };

    const handleServiceDrop = (e, targetServiceKey, targetFolder) => {
        e.preventDefault();
        if (!dragItem || dragItem.type !== 'service' || dragItem.key === targetServiceKey) {
            handleDragEnd();
            return;
        }
        setCustomServices(prev => {
            const dragIdx = prev.findIndex(s => s.key === dragItem.key);
            if (dragIdx < 0) return prev;
            const draggedService = { ...prev[dragIdx], folder: targetFolder };
            const rest = prev.filter((_, i) => i !== dragIdx);
            const targetIdx = rest.findIndex(s => s.key === targetServiceKey);
            const result = [...rest];
            result.splice(targetIdx >= 0 ? targetIdx : result.length, 0, draggedService);
            const updated = result.map((s, i) => ({ ...s, sort_order: i }));
            persistOrder(updated);
            return updated;
        });
        handleDragEnd();
    };

    // --- Layer-level drag-and-drop reorder (within a service) ---
    const [layerOrder, setLayerOrder] = useState({}); // { [serviceKey]: [layerId, ...] }
    const [dragLayerItem, setDragLayerItem] = useState(null); // { serviceKey, layerId }
    const [dragOverLayerItem, setDragOverLayerItem] = useState(null);

    // Initialize layerOrder from fetched customServices (layer_order field)
    useEffect(() => {
        const newOrder = {};
        customServices.forEach(s => {
            if (s.layer_order && Array.isArray(s.layer_order)) {
                newOrder[s.key] = s.layer_order;
            }
        });
        setLayerOrder(prev => ({ ...prev, ...newOrder }));
    }, [customServices]);

    const handleLayerDragStart = useCallback((e, serviceKey, layerId) => {
        setDragLayerItem({ serviceKey, layerId });
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleLayerDragOver = useCallback((e, serviceKey, layerId) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverLayerItem({ serviceKey, layerId });
    }, []);

    const handleLayerDragEnd = useCallback(() => {
        setDragLayerItem(null);
        setDragOverLayerItem(null);
    }, []);

    const handleLayerDrop = useCallback((e, serviceKey, targetLayerId) => {
        e.preventDefault();
        if (!dragLayerItem || dragLayerItem.serviceKey !== serviceKey || dragLayerItem.layerId === targetLayerId) {
            handleLayerDragEnd();
            return;
        }
        // Build current order from layerTree roots
        const rawLayers = serviceLayers[serviceKey] || [];
        const tree = buildLayerTree(Array.isArray(rawLayers) ? rawLayers : []);
        const currentOrder = layerOrder[serviceKey] || tree.map(n => n.id);
        const dragIdx = currentOrder.indexOf(dragLayerItem.layerId);
        const targetIdx = currentOrder.indexOf(targetLayerId);
        if (dragIdx < 0 || targetIdx < 0) {
            handleLayerDragEnd();
            return;
        }
        const newOrder = [...currentOrder];
        newOrder.splice(dragIdx, 1);
        newOrder.splice(targetIdx, 0, dragLayerItem.layerId);
        setLayerOrder(prev => ({ ...prev, [serviceKey]: newOrder }));
        saveLayerOrder(userEmail, serviceKey, newOrder).catch(err =>
            console.warn('[CustomLayersPanel] Failed to persist layer order:', err)
        );
        handleLayerDragEnd();
    }, [dragLayerItem, serviceLayers, layerOrder, userEmail, handleLayerDragEnd]);

    // --- Folder management ---
    const handleCreateFolder = async () => {
        const name = prompt('Enter new folder name:');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        // Check if folder already exists
        if (folderNames.includes(trimmed)) {
            alert('A folder with this name already exists.');
            return;
        }
        try {
            const result = await createCustomFolder(userEmail, trimmed);
            setDbFolders(prev => [...prev, { folder_name: trimmed, sort_order: result.sort_order ?? prev.length }]);
            setExpandedFolders(prev => new Set(prev).add(trimmed));
        } catch (err) {
            console.warn('[CustomLayersPanel] Failed to create folder:', err);
        }
    };

    const handleDeleteFolder = async (folderName) => {
        if (!folderName) return;
        const services = servicesByFolder[folderName] || [];
        const msg = services.length > 0
            ? `Delete folder "${folderName}"? Its ${services.length} service(s) will be moved to Root.`
            : `Delete empty folder "${folderName}"?`;
        if (!window.confirm(msg)) return;
        try {
            await deleteCustomFolder(userEmail, folderName);
            // Move local services to Root
            setCustomServices(prev => prev.map(s =>
                s.folder === folderName ? { ...s, folder: 'Root' } : s
            ));
            setDbFolders(prev => prev.filter(f => f.folder_name !== folderName));
            setExpandedFolders(prev => {
                const next = new Set(prev);
                next.delete(folderName);
                return next;
            });
        } catch (err) {
            console.warn('[CustomLayersPanel] Failed to delete folder:', err);
        }
    };

    // Context menu handlers (panel-specific; state + pin from hook)
    const handleRemoveCustomLayer = async () => {
        if (!contextMenu || contextMenu.type !== 'service') return;
        const service = contextMenu.data.service;
        closeContextMenu();
        try {
            await deleteCustomLayer(userEmail, service.key);
            removeAllMapLayers(service);
            setCustomServices(prev => prev.filter(s => s.key !== service.key));
            setServiceLayerAdded(prev => { const n = { ...prev }; delete n[service.key]; return n; });
            setCheckedLayerIds(prev => { const n = { ...prev }; delete n[service.key]; return n; });
            setCheckedSublayerIds(prev => { const n = { ...prev }; delete n[service.key]; return n; });
            showStatus(`Removed "${service.label}" from custom layers`);
        } catch (err) {
            showStatus(`Failed to remove: ${err.message}`);
        }
    };

    const handleContextRename = () => {
        if (!contextMenu) return;
        const { type, data } = contextMenu;
        if (type === 'folder') {
            setRenamingItem({ type: 'folder', key: data.folder });
        } else if (type === 'service') {
            setRenamingItem({ type: 'service', key: data.service.key });
        }
        closeContextMenu();
    };

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

    // Learn More handlers
    const openServiceInfo = async (service) => {
        setServiceInfoOpenKey(service.key);

        if (service && service.key && serviceLayers[service.key] === undefined && service.url) {
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
    const closeServiceInfo = () => setServiceInfoOpenKey(null);

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
            // Fetch legend if not already cached
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

        const firstFolder = findFirstRootFolder();
        const firstService = findFirstServiceInFolder(firstFolder);
        const infoLayer = findFirstInfoLayer(firstService);

        if (onboardingStepIndex >= 8 && firstService) {
            if (serviceInfoOpenKey !== firstService.key) {
                openServiceInfo(firstService);
            }
        } else if (serviceInfoOpenKey) {
            setServiceInfoOpenKey(null);
        }

        if (onboardingStepIndex >= 10 && firstService && infoLayer) {
            const isSameLayer = layerInfoOpen
                && layerInfoOpen.serviceKey === firstService.key
                && layerInfoOpen.layerId === infoLayer.id;
            if (!isSameLayer) {
                openLayerInfo(firstService, infoLayer);
            }
        } else if (layerInfoOpen) {
            setLayerInfoOpen(null);
        }
    }, [
        isOnboardingOpen,
        onboardingStepIndex,
        serviceInfoOpenKey,
        layerInfoOpen,
        findFirstRootFolder,
        findFirstServiceInFolder,
        findFirstInfoLayer,
    ]);

    // Save a layer to custom layers
    const handleSaveLayerToCustomLayers = async () => {
        if (!layerInfoOpen) return;
        const email = localStorage.getItem('email') || '';
        if (!email) {
            // Show login prompt if available
            alert('Please log in to save layers');
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
            alert(`Successfully saved "${layerInfoOpen.layerName}" to Custom Layers`);
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    };

    const handleSaveServiceToCustomLayers = async () => {
        if (!serviceInfoOpenKey) return;
        const email = localStorage.getItem('email') || '';
        if (!email) {
            alert('Please log in to save services');
            return;
        }
        try {
            const currentService = customServices.find(s => s.key === serviceInfoOpenKey);
            if (!currentService) return;
            await saveCustomLayer(email, currentService);
            alert(`Successfully saved "${currentService.label}" to Custom Layers`);
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    };

    // Helper: convert HTML to plain text
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
            onLayerDragStart={handleLayerDragStart}
            onLayerDragOver={handleLayerDragOver}
            onLayerDrop={handleLayerDrop}
            onLayerDragEnd={handleLayerDragEnd}
            draggingLayerId={dragLayerItem?.layerId}
            dragOverLayerId={dragOverLayerItem?.layerId}
            layerInfoOpen={layerInfoOpen}
        />
    );

    if (!isOpen) return null;

    if (!userEmail) {
        return (
            <div className={`custom-layers-panel${splitBottom ? ' custom-layers-panel--split-bottom' : ''}`}>
                <div className="custom-layers-panel-header">
                    <h3>Custom Layers</h3>
                    <div className="custom-layers-panel-header-actions">
                        <button className="custom-layers-panel-close-btn custom-layers-panel-close-btn--help" title="Help" onClick={() => window.open('/user-manual?section=custom-layers', '_blank')}>
                            <FontAwesomeIcon icon={faQuestion} />
                        </button>
                        <button className="custom-layers-panel-close-btn" onClick={onClose}>
                            <FontAwesomeIcon icon={faTimes} />
                        </button>
                    </div>
                </div>
                <div className="custom-layers-panel-empty">
                    Please log in to use custom layers.
                </div>
            </div>
        );
    }

    return (
        <div ref={panelRootRef} className={`custom-layers-panel${splitBottom ? ' custom-layers-panel--split-bottom' : ''}${isOnboardingOpen ? ' onboarding-locked' : ''}`}
             onContextMenu={e => e.preventDefault()}>
            <div className="custom-layers-panel-header">
                <h3>Custom Layers</h3>
                <div className="custom-layers-panel-header-actions">
                    <button className="custom-layers-panel-close-btn custom-layers-panel-close-btn--help" title="Help" onClick={() => window.open('/user-manual?section=custom-layers', '_blank')}>
                        <FontAwesomeIcon icon={faQuestion} />
                    </button>
                    <button className="custom-layers-panel-close-btn custom-layers-panel-close-btn--play" title="Tutorial" onClick={() => setIsOnboardingOpen(true)}>
                        <FontAwesomeIcon icon={faPlay} />
                    </button>
                    <button className="custom-layers-panel-close-btn" onClick={onClose}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
            </div>

            {/* Sticky toolbar: search bar, opacity, show-added-only */}
            <div className="custom-layers-panel-sticky-toolbar">
                {/* Search bar */}
                <div className="upload-panel-searchbar" data-onboarding-target="custom-layers-search-area">
                    <input
                        type="text"
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
                        placeholder={currentPath ? `Search in "${currentPath.includes('/') ? currentPath.slice(currentPath.lastIndexOf('/') + 1) : currentPath}"…` : 'Search folders, services, or layers…'}
                    />
                    <button
                        className="search-btn upload-panel-searchbar-btn search"
                        title="Search"
                        onClick={doSearch}
                    >
                        <FontAwesomeIcon icon={faSearch} />
                    </button>
                    <button
                        className="clear-btn upload-panel-searchbar-btn clear"
                        title="Clear Search"
                        onClick={clearSearch}
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

                {/* Opacity slider */}
                <div className="upload-panel-opacity-slider-row" data-onboarding-target="custom-layers-opacity-slider">
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
                <div className="upload-panel-controls-row" data-onboarding-target="custom-layers-panel-actions">
                    <div className="upload-panel-controls-actions">
                        <button
                            className="clear-all-layers-btn custom-layers-panel-new-folder-btn"
                            data-onboarding-target="custom-layers-new-folder-button"
                            onClick={handleCreateFolder}
                            title="New Folder"
                        >
                            <FontAwesomeIcon icon={faFolderPlus} />
                            <span>New Folder</span>
                        </button>
                        <button
                            type="button"
                            data-onboarding-target="custom-layers-show-added-button"
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
            </div>

            {isLoading && (
                <div className="custom-layers-panel-empty">Loading custom layers...</div>
            )}

            {!isLoading && customServices.length === 0 && dbFolders.length === 0 && (
                <div className="custom-layers-panel-empty">
                    No custom layers saved yet.<br />
                    Right-click a layer in the GIS Services panel and select "Save to Custom Layers".
                </div>
            )}

            {!isLoading && (customServices.length > 0 || dbFolders.length > 0) && (
                <div className="custom-layers-panel-folder-area-wrapper">
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
                <div className="custom-layers-panel-folder-area" data-onboarding-target="custom-layers-folder-area">
                    {/* Breadcrumb — shown when inside a folder in navigation mode */}
                    {!searchResult && currentPath !== '' && (
                        <div
                            className={`upload-panel-breadcrumb${breadcrumbDragOver && dragItem?.type === 'folder' ? ' drag-over' : ''}`}
                            onDragEnter={(e) => { e.preventDefault(); if (dragItem?.type === 'folder') setBreadcrumbDragOver(true); }}
                            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setBreadcrumbDragOver(false); }}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                            onDrop={(e) => {
                                setBreadcrumbDragOver(false);
                                e.preventDefault();
                                if (!dragItem || dragItem.type !== 'folder') return;
                                const sourceFolder = dragItem.key;
                                const sourceName = folderDisplayName(sourceFolder);
                                // Move dragged folder to the parent of the current directory
                                const targetParent = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
                                const newBasePath = targetParent === '' ? sourceName : targetParent + '/' + sourceName;
                                if (newBasePath === sourceFolder) { handleDragEnd(); return; }
                                const foldersToRename = dbFolders
                                    .map(f => f.folder_name)
                                    .filter(f => f === sourceFolder || f.startsWith(sourceFolder + '/'));
                                setDbFolders(prev => prev.map(f => {
                                    if (f.folder_name === sourceFolder) return { ...f, folder_name: newBasePath };
                                    if (f.folder_name.startsWith(sourceFolder + '/')) return { ...f, folder_name: newBasePath + f.folder_name.slice(sourceFolder.length) };
                                    return f;
                                }));
                                setCustomServices(prev => prev.map(s => {
                                    const sf = s.folder || 'Root';
                                    if (sf === sourceFolder) return { ...s, folder: newBasePath };
                                    if (sf.startsWith(sourceFolder + '/')) return { ...s, folder: newBasePath + sf.slice(sourceFolder.length) };
                                    return s;
                                }));
                                foldersToRename.forEach(oldName => {
                                    const newName = oldName === sourceFolder ? newBasePath : newBasePath + oldName.slice(sourceFolder.length);
                                    renameCustomFolder(userEmail, oldName, newName).catch(err =>
                                        console.warn('[CustomLayersPanel] Failed to persist folder move-out rename:', err)
                                    );
                                });
                                handleDragEnd();
                            }}
                        >
                            <button
                                className="upload-panel-breadcrumb-back"
                                onClick={handleNavBack}
                                onDragOver={(e) => e.stopPropagation()}
                                title="Back"
                            >←</button>
                            <span className="upload-panel-breadcrumb-path">
                                {currentPath.split('/').map((seg, i, arr) => (
                                    <span key={i}>
                                        {i > 0 && <span className="upload-panel-breadcrumb-sep"> / </span>}
                                        {seg}
                                    </span>
                                ))}
                            </span>
                        </div>
                    )}
                    {foldersToShow.map(folder => {
                        const services = servicesByFolderToShow[folder] || [];
                        const isFolderExpanded = searchResult ? expandedFolders.has(folder) : currentPath === folder;
                        const isFolderDragging = dragItem?.type === 'folder' && dragItem?.key === folder;
                        const isFolderDragOver = dragOverItem?.type === 'folder' && dragOverItem?.key === folder && (dragItem?.type === 'folder' || dragItem?.type === 'service');
                        return (
                            <div key={folder}
                                style={{ opacity: isFolderDragging ? 0.4 : 1 }}
                            >
                                {/* Folder header: shown in search mode, at nav root, or for direct children of currentPath */}
                                {(searchResult || currentPath === '' || folder.startsWith(currentPath + '/')) && <div
                                    className={`custom-layers-folder${isFolderDragOver ? ' drag-over' : ''}`}
                                    data-search-match-id={searchResult?.matchedFolderNames?.has(folder) ? `folder-CUSTOM-${folder}` : undefined}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, 'folder', folder)}
                                    onClick={() => handleFolderClick(folder)}
                                    onContextMenu={(e) => handleContextMenu(e, 'folder', { folder })}
                                    onDragOver={(e) => handleDragOver(e, 'folder', folder)}
                                    onDrop={(e) => handleFolderDrop(e, folder)}
                                    onDragEnd={handleDragEnd}
                                >
                                    <FontAwesomeIcon icon={faFolder} style={{ flexShrink: 0, verticalAlign: 0 }} />
                                    <ArcgisRenameItem
                                        value={folder}
                                        displayValue={folderDisplayName(folder)}
                                        onSave={(newName) => handleFolderRename(folder, newName)}
                                        placeholder="Enter folder name..."
                                        isFolder={true}
                                        disabled={true}
                                        startEditing={renamingItem?.type === 'folder' && renamingItem?.key === folder}
                                        onEditingDone={() => setRenamingItem(null)}
                                    />
                                    <span style={{ color: '#999', fontSize: '10px', marginLeft: 'auto' }}>
                                        ({services.length})
                                    </span>
                                </div>}
                                {isFolderExpanded && (
                                    <div className="custom-layers-folder-content">
                                        {services.map(service => {
                                            const layers = serviceLayers[service.key] || [];
                                            const checkedIds = checkedLayerIds[service.key] || [];
                                            const rawLayers = layers.length > 0 ? layers : [];
                                            let layerTree = buildLayerTree(Array.isArray(rawLayers) ? rawLayers : []);
                                            // Apply saved layer order
                                            const savedOrder = layerOrder[service.key];
                                            if (savedOrder && savedOrder.length > 0) {
                                                layerTree = [...layerTree].sort((a, b) => {
                                                    const ai = savedOrder.indexOf(a.id);
                                                    const bi = savedOrder.indexOf(b.id);
                                                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                                                });
                                            }
                                            const allFeatureLayers = getAllLeafLayers(layerTree);
                                            const isServiceExpanded = expandedServices.has(service.key);
                                            const isServiceDragging = dragItem?.type === 'service' && dragItem?.key === service.key;
                                            const isServiceDragOver = dragOverItem?.type === 'service' && dragOverItem?.key === service.key && dragItem?.type === 'service';

                                            return (
                                                <div key={service.key} style={{ opacity: isServiceDragging ? 0.4 : 1 }}>
                                                    <div
                                                        className={`custom-layers-item${isServiceDragOver ? ' drag-over' : ''}${currentMatchId === `service-${service.key}` ? ' search-nav-current' : ''}${serviceInfoOpenKey === service.key ? ' service-info-active' : ''}`}
                                                        data-onboarding-target="custom-layers-service-row"
                                                        data-search-match-id={searchResult?.matchedServiceKeys?.has(service.key) ? `service-${service.key}` : undefined}
                                                        onClick={() => handleServiceClick(service.key)}
                                                        onContextMenu={(e) => handleContextMenu(e, 'service', { service, layersToShow: allFeatureLayers })}
                                                        onDragOver={(e) => handleDragOver(e, 'service', service.key, folder)}
                                                        onDrop={(e) => handleServiceDrop(e, service.key, folder)}
                                                        onDragEnd={handleDragEnd}
                                                    >
                                                        <span
                                                            className="drag-handle"
                                                            draggable
                                                            onDragStart={(e) => handleDragStart(e, 'service', service.key, folder)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            title="Drag to reorder"
                                                        >⠿</span>
                                                        <input
                                                            type="checkbox"
                                                            checked={checkedIds.length > 0 && checkedIds.length === allFeatureLayers.length}
                                                            ref={el => {
                                                                if (el) el.indeterminate = checkedIds.length > 0 && checkedIds.length < allFeatureLayers.length;
                                                            }}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                handleSelectAll(service, allFeatureLayers);
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            style={{ marginRight: 4, flexShrink: 0 }}
                                                        />
                                                        {isServiceExpanded ? "▼" : "►"}
                                                        <ArcgisRenameItem
                                                            value={service.label}
                                                            displayValue={service.label}
                                                            onSave={(newLabel) => handleServiceRename(service.key, newLabel)}
                                                            placeholder="Enter service name..."
                                                            isFolder={false}
                                                            disabled={true}
                                                            startEditing={renamingItem?.type === 'service' && renamingItem?.key === service.key}
                                                            onEditingDone={() => setRenamingItem(null)}
                                                        />
                                                        {service.state && (
                                                            <span style={{ color: '#999', fontSize: '10px' }}>
                                                                {service.state.substring(0, 2).toUpperCase()}
                                                            </span>
                                                        )}
                                                        <button
                                                            className="custom-layers-service-row-action-btn"
                                                            data-onboarding-target="custom-layers-service-info-button"
                                                            onClick={(e) => { e.stopPropagation(); openServiceInfo(service); }}
                                                            title="Learn more"
                                                        >
                                                            <FontAwesomeIcon icon={faEllipsisV} />
                                                        </button>
                                                    </div>
                                                    {isServiceExpanded && layerTree.length > 0 && (
                                                        <div className="tree-children" style={{ paddingLeft: 16 }} data-onboarding-target="custom-layers-layer-tree">
                                                            {layerTree.map(node =>
                                                                renderLayerNode(node, service, checkedIds, allFeatureLayers)
                                                            )}
                                                        </div>
                                                    )}
                                                    {isServiceExpanded && layerTree.length === 0 && (
                                                        <div style={{ paddingLeft: 24, color: '#999', fontSize: 11, padding: '4px 0 4px 24px' }}>
                                                            Loading layers...
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                </div>
            )}

            {/* Context Menu */}
            <LayerContextMenuPopup
                contextMenu={contextMenu}
                isPinned={isPinned}
                onRename={handleContextRename}
                onLearnMore={handleContextLearnMore}
                onTogglePin={handleTogglePin}
                extraServiceItems={[
                    { label: 'Remove from Custom Layers', onClick: handleRemoveCustomLayer },
                ]}
                extraFolderItems={[
                    { label: 'Delete Folder', onClick: () => {
                        if (contextMenu?.type === 'folder') {
                            const folderName = contextMenu.data.folder;
                            closeContextMenu();
                            handleDeleteFolder(folderName);
                        }
                    }},
                ]}
            />

            {/* Status messages */}
            {statusMsg && (
                <div className="custom-layers-loading-messages">
                    <div className="custom-layers-loading-message">{statusMsg}</div>
                </div>
            )}

            {/* Service Info Modal — shared component */}
            <ServiceInfoModal
                serviceKey={serviceInfoOpenKey}
                service={serviceInfoOpenKey ? (customServices.find(s => s.key === serviceInfoOpenKey) || null) : null}
                info={serviceInfoOpenKey ? serviceInfoCache[serviceInfoOpenKey] : null}
                loading={serviceInfoLoading}
                getStyle={getInfoModalStyle}
                onboardingPrefix="custom-layers"
                onClose={closeServiceInfo}
                mapInstance={mapInstance}
                mapKeyPrefix="custom-"
                defaultOpacity={layerOpacity}
                renderLayerLinks={renderServiceLayerLinks}
                onSave={handleSaveServiceToCustomLayers}
            />

            {/* Layer Info Modal — shared component */}
            <LayerInfoModal
                layerInfo={layerInfoOpen}
                info={layerInfoOpen ? layerInfoCache[`${layerInfoOpen.serviceKey}-${layerInfoOpen.layerId}`] : null}
                loading={layerInfoLoading}
                getStyle={getLayerInfoModalStyle}
                onboardingPrefix="custom-layers"
                onClose={closeLayerInfo}
                mapInstance={mapInstance}
                mapKeyPrefix="custom-"
                defaultOpacity={layerOpacity}
                rawLayers={layerInfoOpen ? (serviceLayers[layerInfoOpen.serviceKey] || []) : []}
                legend={layerInfoOpen ? serviceLegends[layerInfoOpen.serviceKey] : null}
                onOpenLayerInfo={openLayerInfo}
                onSave={handleSaveLayerToCustomLayers}
                showMessage={showStatus}
            />

            <CustomLayersPanelOnboarding
                isOpen={isOnboardingOpen}
                onClose={() => setIsOnboardingOpen(false)}
                isPanelCollapsed={!isOpen}
                onStepChange={setOnboardingStepIndex}
            />
        </div>
    );
}

export default CustomLayersPanel;
