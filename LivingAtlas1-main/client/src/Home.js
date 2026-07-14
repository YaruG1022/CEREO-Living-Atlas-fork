import React, { useState, useEffect, useRef } from 'react';
import Header from './Header';
import Main from './Main';
import Content2 from './Content2';
import Content1 from './Content1';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { faTimes } from '@fortawesome/free-solid-svg-icons';
import { faThumbtack } from '@fortawesome/free-solid-svg-icons';
import { faAngleDoubleLeft, faAngleDoubleRight } from '@fortawesome/free-solid-svg-icons';
import { faClone } from '@fortawesome/free-solid-svg-icons';
import './Home.css';
import './Sidebars.css';
import ArcgisUploadPanel from './ArcgisUploadPanel';
import CustomLayersPanel from './CustomLayersPanel';
import { applyAreaVisibility } from './AreaFilter';
import { showAll } from "./Filter.js";
import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { faBell, faMap, faObjectGroup, faInfoCircle, faEarthAmericas } from '@fortawesome/free-solid-svg-icons';
import BasemapSwitcher from './BasemapSwitcher';
import Modal from 'react-modal';
import ChangelogModal from './ChangelogModal';
import GeneralOnboardingModal from './GeneralOnboardingModal';
import GeneralOnboarding from './OnboardingGeneral';
import { fetchUserPreferences, saveUserPreferences } from './userPreferencesApi';
import ChatbotWidget from './ChatbotWidget';
import {
    readPendingLocalPreferences,
    writePendingLocalPreferences,
    clearPendingLocalPreferences,
    deepMergePreferences,
    hasPreferenceValues,
} from './userPreferencesLocalCache';

const GENERAL_ONBOARDING_SEEN_KEY = 'general_onboarding_seen_v1';

function Home(props) {
    const [filterCondition, setFilterCondition] = useState('');
    const [CategoryCondition, setCategoryConditionCondition] = useState('');
    const [searchCondition, setSearchCondition] = useState('');
    const [sortCondition, setSortCondition] = useState('');
    const coordinates = {
        NE: { Lng: -116.5981, Lat: 47.0114 },
        SW: { Lng: -117.7654, Lat: 46.4466 }
    };
    const [boundCondition, setboundCondition] = useState(coordinates);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [cardPanelWidth, setCardPanelWidth] = useState(() => {
        // Derive default panel width from the card size formula so it always fits exactly 2 columns.
        // Card width in CSS = 20vw, grid-gap = 16px, padding = 16px × 2 sides = 32px
        // scrollbar-gutter: stable reserves ~17px for scrollbar even when hidden
        // Panel for 2 cols = 2 × (20vw) + 1 × gap + padding + scrollbar_gutter
        const CARD_VW = 0.20;
        const GRID_GAP = 16;
        const GRID_PADDING = 32;
        const SCROLLBAR_GUTTER = 20; // matches scrollbar-gutter:stable reserved width
        const SUBPIXEL_BUFFER = 4;  // absorbs browser subpixel rounding of vw values
        const COLS = 2;
        // Math.ceil avoids being 1px short when Windows display scaling (e.g. 125%) reduces vw
        return Math.max(300, Math.ceil(
            window.innerWidth * CARD_VW * COLS + GRID_GAP * (COLS - 1) + GRID_PADDING + SCROLLBAR_GUTTER + SUBPIXEL_BUFFER
        ));
    });
    const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(false);
    const [arcgisNavigateTarget, setArcgisNavigateTarget] = useState(null);
    const [isCustomLayerPanelOpen, setIsCustomLayerPanelOpen] = useState(false);
    const [customLayersRefreshKey, setCustomLayersRefreshKey] = useState(0);
    const [cardPanelSide, setCardPanelSide] = useState('right');
    const [folderExpanded, setFolderExpanded] = useState(false);
    const [itemExpanded, setItemExpanded] = useState(false);
    const [arcgisLayers, setArcgisLayers] = useState([]);
    const [arcgisLegend, setArcgisLegend] = useState(null);
    const [arcgisLayerAdded, setArcgisLayerAdded] = useState(false);
    const [isChangelogOpen, setIsChangelogOpen] = useState(false);
    const [hasUnseenChangelog, setHasUnseenChangelog] = useState(() => {
        return !localStorage.getItem('changelog_seen_v19');
    });
    const [isGeneralOnboardingOpen, setIsGeneralOnboardingOpen] = useState(false);
    const [isGeneralOnboardingTourOpen, setIsGeneralOnboardingTourOpen] = useState(false);
    const [chatbotDisplayMode, setChatbotDisplayMode] = useState('floating');
    const [isChatbotOpen, setIsChatbotOpen] = useState(false);
    const [isMapFullscreen, setIsMapFullscreen] = useState(false);

    const closeChangelog = () => {
        localStorage.setItem('changelog_seen_v19', 'true');
        setHasUnseenChangelog(false);
        setIsChangelogOpen(false);
    };

    const closeGeneralOnboarding = () => {
        setIsGeneralOnboardingOpen(false);
    };

    const startGeneralOnboardingTour = () => {
        setIsGeneralOnboardingOpen(false);
        setIsGeneralOnboardingTourOpen(true);
    };

    const closeGeneralOnboardingTour = () => {
        setIsGeneralOnboardingTourOpen(false);
    };

    useEffect(() => {
        if (hasAutoStartedGeneralOnboardingRef.current) return;
        hasAutoStartedGeneralOnboardingRef.current = true;

        if (localStorage.getItem(GENERAL_ONBOARDING_SEEN_KEY)) return;

        localStorage.setItem(GENERAL_ONBOARDING_SEEN_KEY, 'true');
        setIsGeneralOnboardingOpen(true);
    }, []);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        const previousOverscrollBehaviorY = document.body.style.overscrollBehaviorY;

        document.body.style.overflow = 'hidden';
        document.body.style.overscrollBehaviorY = 'none';

        return () => {
            document.body.style.overflow = previousOverflow;
            document.body.style.overscrollBehaviorY = previousOverscrollBehaviorY;
        };
    }, []);

    useEffect(() => {
        const updateFullscreenState = () => {
            const fullscreenElement = document.fullscreenElement;
            const isFullscreenActive = !!fullscreenElement && (
                fullscreenElement === document.documentElement ||
                fullscreenElement.classList?.contains('AtlasMap__container') ||
                fullscreenElement.classList?.contains('AtlasMap') ||
                !!fullscreenElement.closest?.('.AtlasMap')
            );

            setIsMapFullscreen(isFullscreenActive);
            document.documentElement.classList.toggle('app-map-fullscreen', isFullscreenActive);
        };

        updateFullscreenState();
        document.addEventListener('fullscreenchange', updateFullscreenState);

        return () => {
            document.removeEventListener('fullscreenchange', updateFullscreenState);
            document.documentElement.classList.remove('app-map-fullscreen');
        };
    }, []);

    // Listen for card linked-ArcGIS-item clicks → open panel and navigate
    useEffect(() => {
        const handler = (e) => {
            setIsUploadPanelOpen(true);
            setIsCustomLayerPanelOpen(false);
            setIsBasemapOpen(false);
            if (chatbotDisplayMode === 'sidebar') {
                setIsChatbotOpen(false);
            }
            setArcgisNavigateTarget(e.detail);
        };
        window.addEventListener('open-arcgis-panel', handler);
        return () => window.removeEventListener('open-arcgis-panel', handler);
    }, [chatbotDisplayMode]);

    // Fetch layers and legend for demo folder/item
    useEffect(() => {
        if (isUploadPanelOpen) {
            const SERVICE_URL = "https://gis.ecology.wa.gov/serverext/rest/services/Authoritative/AQ/MapServer";
            fetch(`${SERVICE_URL}/layers?f=json`)
                .then(res => res.json())
                .then(data => {
                    setArcgisLayers(prevLayers => {
                        if (JSON.stringify(prevLayers) !== JSON.stringify(data.layers || [])) {
                            setCheckedArcgisLayerIds([]);
                        }
                        return data.layers || [];
                    });
                });
            fetch(`${SERVICE_URL}/legend?f=json`)
                .then(res => res.json())
                .then(data => setArcgisLegend(data));
        }
    }, [isUploadPanelOpen]);

    const [selectedCardCoords, setSelectedCardCoords] = useState(null);
    const [selectedCardIdFromMap, setSelectedCardIdFromMap] = useState(null);
    const [searchTriggerSource, setSearchTriggerSource] = useState('');
    const [sidebarSearchRequestId, setSidebarSearchRequestId] = useState(0);

    const [miniSearchTerm, setMiniSearchTerm] = useState('');
    const [miniFeatureResults, setMiniFeatureResults] = useState([]);
    const [recentFeatures, setRecentFeatures] = useState(() => {
        try {
            const raw = localStorage.getItem('search_panel_recent_features_v1');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(f => f && typeof f.id === 'string' && typeof f.label === 'string')
                .map(f => ({ id: f.id, label: f.label, pinned: !!f.pinned }));
        } catch {
            return [];
        }
    });
    const miniSearchInputRef = useRef(null);
    const isSearchModalOpenRef = useRef(false);
    const searchPanelOpenedByOnboardingRef = useRef(false);
    const uiPrefsWriteInitializedRef = useRef(false);
    const hasAutoStartedGeneralOnboardingRef = useRef(false);

    useEffect(() => {
        isSearchModalOpenRef.current = isSearchModalOpen;
    }, [isSearchModalOpen]);

    useEffect(() => {
        if (isSearchModalOpen && miniSearchInputRef.current) {
            miniSearchInputRef.current.focus();
        }
    }, [isSearchModalOpen]);

    useEffect(() => {
        try {
            localStorage.setItem('search_panel_recent_features_v1', JSON.stringify(recentFeatures));
        } catch {
            /* ignore persistence errors (e.g. storage disabled) */
        }
    }, [recentFeatures]);

    useEffect(() => {
        const handler = (event) => {
            const selector = event?.detail?.selector;
            const isOpen = !!event?.detail?.isOpen;
            const isSearchPanelStep = selector === '[data-onboarding-target="left-sidebar-search-panel"]';

            if (!isOpen) {
                if (searchPanelOpenedByOnboardingRef.current) {
                    setIsSearchModalOpen(false);
                    searchPanelOpenedByOnboardingRef.current = false;
                }
                return;
            }

            if (isSearchPanelStep) {
                if (!isSearchModalOpenRef.current) {
                    setIsSearchModalOpen(true);
                    searchPanelOpenedByOnboardingRef.current = true;
                }
                return;
            }

            if (searchPanelOpenedByOnboardingRef.current) {
                setIsSearchModalOpen(false);
                searchPanelOpenedByOnboardingRef.current = false;
            }
        };

        window.addEventListener('atlas:general-onboarding-step-change', handler);
        return () => window.removeEventListener('atlas:general-onboarding-step-change', handler);
    }, []);

    const triggerAndHighlight = (selector, fallbackAction) => {
        const target = document.querySelector(selector);
        if (target) {
            target.click();
            target.focus({ preventScroll: false });
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            target.classList.add('feature-search-hit');
            window.setTimeout(() => {
                target.classList.remove('feature-search-hit');
            }, 900);
            return;
        }

        if (typeof fallbackAction === 'function') {
            fallbackAction();
        }
    };

    const highlightElement = (target) => {
        if (!target) return;
        target.focus({ preventScroll: false });
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        target.classList.add('feature-search-hit');
        window.setTimeout(() => {
            target.classList.remove('feature-search-hit');
        }, 900);
    };

    const clickElementByTitle = ({
        titles,
        rootSelector,
        ensureOpen,
        retries = 10,
        delay = 120,
    }) => {
        const titleList = Array.isArray(titles) ? titles : [titles];
        const normalizedTitles = titleList.map(title => String(title || '').toLowerCase());

        if (typeof ensureOpen === 'function') {
            ensureOpen();
        }

        const attempt = (remaining) => {
            const root = rootSelector ? document.querySelector(rootSelector) : document;
            if (!root) {
                if (remaining > 0) {
                    window.setTimeout(() => attempt(remaining - 1), delay);
                }
                return;
            }

            const target = Array.from(root.querySelectorAll('button[title], a[title]')).find((element) => {
                const title = (element.getAttribute('title') || '').toLowerCase();
                return normalizedTitles.includes(title);
            });

            if (target) {
                target.click();
                highlightElement(target);
                return;
            }

            if (remaining > 0) {
                window.setTimeout(() => attempt(remaining - 1), delay);
            }
        };

        attempt(retries);
    };

    const clickElementBySelector = ({ selector, ensureOpen, retries = 10, delay = 120 }) => {
        if (typeof ensureOpen === 'function') {
            ensureOpen();
        }

        const attempt = (remaining) => {
            const target = document.querySelector(selector);
            if (target) {
                target.click();
                highlightElement(target);
                return;
            }

            if (remaining > 0) {
                window.setTimeout(() => attempt(remaining - 1), delay);
            }
        };

        attempt(retries);
    };

    const clickElementByTitleContains = ({ containsText, rootSelector, ensureOpen, retries = 10, delay = 120 }) => {
        const targetText = String(containsText || '').toLowerCase();

        if (typeof ensureOpen === 'function') {
            ensureOpen();
        }

        const attempt = (remaining) => {
            const root = rootSelector ? document.querySelector(rootSelector) : document;
            if (!root) {
                if (remaining > 0) {
                    window.setTimeout(() => attempt(remaining - 1), delay);
                }
                return;
            }

            const target = Array.from(root.querySelectorAll('button[title], a[title]')).find((element) => {
                const title = (element.getAttribute('title') || '').toLowerCase();
                return title.includes(targetText);
            });

            if (target) {
                target.click();
                highlightElement(target);
                return;
            }

            if (remaining > 0) {
                window.setTimeout(() => attempt(remaining - 1), delay);
            }
        };

        attempt(retries);
    };

    const clickBasemapStyle = (styleLabel) => {
        setIsUploadPanelOpen(false);
        setIsCustomLayerPanelOpen(false);
        setIsBasemapOpen(true);

        const targetLabel = String(styleLabel || '').toLowerCase();
        const attempt = (remaining = 10) => {
            const panel = document.querySelector('.basemap-switcher-panel');
            if (!panel) {
                if (remaining > 0) {
                    window.setTimeout(() => attempt(remaining - 1), 120);
                }
                return;
            }

            const item = Array.from(panel.querySelectorAll('.basemap-switcher-item')).find((element) => {
                const basemapId = (element.getAttribute('data-basemap-id') || '').toLowerCase();
                if (basemapId === targetLabel) {
                    return true;
                }
                const label = element.querySelector('.basemap-switcher-label')?.textContent?.trim()?.toLowerCase() || '';
                return label === targetLabel;
            });

            if (item) {
                item.click();
                highlightElement(item);
                return;
            }

            if (remaining > 0) {
                window.setTimeout(() => attempt(remaining - 1), 120);
            }
        };

        attempt();
    };

    const ensureCardPanelOpen = () => setIsCollapsed(false);
    const ensureUploadPanelOpen = () => {
        setIsUploadPanelOpen(true);
        setIsCustomLayerPanelOpen(false);
        setIsBasemapOpen(false);
        if (chatbotDisplayMode === 'sidebar') {
            setIsChatbotOpen(false);
        }
    };
    const ensureCustomLayersPanelOpen = () => {
        setIsCustomLayerPanelOpen(true);
        setIsUploadPanelOpen(false);
        setIsBasemapOpen(false);
        if (chatbotDisplayMode === 'sidebar') {
            setIsChatbotOpen(false);
        }
    };
    const ensureBasemapPanelOpen = () => {
        setIsUploadPanelOpen(false);
        setIsCustomLayerPanelOpen(false);
        setIsBasemapOpen(true);
        if (chatbotDisplayMode === 'sidebar') {
            setIsChatbotOpen(false);
        }
    };

    const getFeatureCatalog = () => ([
        // Global / left sidebar functions
        {
            id: 'add-card',
            label: 'Add Card',
            keywords: ['add', 'add card', 'create card', 'new card', 'create card modal', 'card form'],
            action: () => {
                ensureCardPanelOpen();
                window.dispatchEvent(new CustomEvent('atlas:open-create-card-modal'));
            },
        },
        {
            id: 'view-all-cards',
            label: 'View All Cards',
            keywords: ['view', 'view all cards', 'show cards', 'open cards', 'card container', 'cards panel', 'card list'],
            action: () => ensureCardPanelOpen(),
        },
        {
            id: 'hide-cards',
            label: 'Hide Cards',
            keywords: ['hide cards', 'close cards', 'collapse cards', 'close card panel'],
            action: () => setIsCollapsed(true),
        },
        {
            id: 'toggle-layers',
            label: 'Toggle Layers',
            keywords: ['layers', 'toggle layers', 'arcgis layers', 'gis layers', 'open layers'],
            action: () => triggerAndHighlight('[data-onboarding-target="left-sidebar-gis"]', () => ensureUploadPanelOpen()),
        },
        {
            id: 'custom-layers',
            label: 'Custom Layers',
            keywords: ['custom', 'custom layers', 'my layers', 'layer folder'],
            action: () => triggerAndHighlight('[data-onboarding-target="left-sidebar-customlayers"]', () => ensureCustomLayersPanelOpen()),
        },
        {
            id: 'change-basemap',
            label: 'Change Basemap',
            keywords: ['basemap', 'change basemap', 'map style', 'background map'],
            action: () => triggerAndHighlight('[data-onboarding-target="left-sidebar-basemap"]', () => ensureBasemapPanelOpen()),
        },
        {
            id: 'chatbot',
            label: 'Open Chatbot',
            keywords: ['chat', 'chatbot', 'ai chat', 'assistant'],
            action: () => {
                if (chatbotDisplayMode === 'sidebar') {
                    triggerAndHighlight('[data-onboarding-target="left-sidebar-chatbot"]', () => setIsChatbotOpen(v => !v));
                    return;
                }
                setIsChatbotOpen(true);
            },
        },
        {
            id: 'whats-new',
            label: "What's New",
            keywords: ['what\'s new', 'whats new', 'changelog', 'release notes', 'updates'],
            action: () => triggerAndHighlight('[data-onboarding-target="left-sidebar-changelog"]', () => setIsChangelogOpen(true)),
        },
        {
            id: 'app-onboarding',
            label: 'App Onboarding',
            keywords: ['onboarding', 'tutorial', 'help tour', 'guide'],
            action: () => triggerAndHighlight('[data-onboarding-target="left-sidebar-general-onboarding"]', () => setIsGeneralOnboardingOpen(true)),
        },
        {
            id: 'search-features',
            label: 'Feature Search',
            keywords: ['search', 'feature search', 'find feature'],
            action: () => setIsSearchModalOpen(true),
        },

        // Card container functions
        {
            id: 'card-help',
            label: 'Card Panel Help',
            keywords: ['card help', 'card panel help', 'cards help', 'manual card container'],
            action: () => clickElementByTitle({ titles: 'Help', rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-onboarding',
            label: 'Card Panel Onboarding',
            keywords: ['card onboarding', 'card tutorial', 'start onboarding cards'],
            action: () => clickElementByTitle({ titles: 'Start onboarding', rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-close-panel',
            label: 'Close Card Panel',
            keywords: ['close card panel', 'collapse card panel', 'hide card container'],
            action: () => clickElementByTitle({ titles: 'Close panel', rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-toggle-markers',
            label: 'Toggle Markers',
            keywords: ['markers', 'toggle markers', 'hide markers', 'show markers', 'card markers'],
            action: () => clickElementByTitle({ titles: ['Hide Markers', 'Show Markers'], rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-favorites-filter',
            label: 'Favorites Filter',
            keywords: ['favorites', 'favorite cards', 'bookmark filter', 'show favorited cards'],
            action: () => clickElementByTitle({ titles: ['Show only favorited cards', 'Log in to use favorites filter'], rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-scope-toggle',
            label: 'Scope Toggle',
            keywords: ['scope', 'in view', 'all cards', 'view scope', 'filter by map view'],
            action: () => clickElementBySelector({ selector: '#content-2 .card-toolbar-button--scope', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-view-mode',
            label: 'Grid/List View Toggle',
            keywords: ['grid view', 'list view', 'view mode', 'card layout', 'toggle list grid'],
            action: () => clickElementByTitle({ titles: ['Grid View', 'List View'], rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-sort',
            label: 'Sort Cards',
            keywords: ['sort cards', 'card sorting', 'order cards', 'sort dropdown'],
            action: () => clickElementByTitle({ titles: 'Sort cards', rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-filter',
            label: 'Filter Cards',
            keywords: ['filter cards', 'card filter', 'tag filter', 'category filter'],
            action: () => clickElementByTitle({ titles: 'Filter cards', rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-move-side',
            label: 'Move Card Panel Side',
            keywords: ['move panel left', 'move panel right', 'swap card panel side', 'card panel side'],
            action: () => clickElementByTitle({ titles: ['Move panel to right', 'Move panel to left'], rootSelector: '#content-2', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-search',
            label: 'Card Search',
            keywords: ['card search', 'search cards', 'find cards', 'search in card container'],
            action: () => clickElementByTitle({ titles: 'Search', rootSelector: '#content-2 .card-panel-searchbar', ensureOpen: ensureCardPanelOpen }),
        },
        {
            id: 'card-clear-search',
            label: 'Clear Card Search',
            keywords: ['clear card search', 'reset card search', 'remove card keyword'],
            action: () => clickElementByTitle({ titles: 'Clear Search', rootSelector: '#content-2 .card-panel-searchbar', ensureOpen: ensureCardPanelOpen }),
        },

        // Upload panel functions
        {
            id: 'upload-help',
            label: 'Upload Panel Help',
            keywords: ['upload panel help', 'arcgis panel help', 'gis help'],
            action: () => clickElementByTitle({ titles: 'Help', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-close',
            label: 'Close Upload Panel',
            keywords: ['close upload panel', 'hide upload panel', 'close arcgis panel'],
            action: () => clickElementBySelector({ selector: '.upload-panel .upload-panel-header-close-btn:not(.upload-panel-header-close-btn--help):not(.upload-panel-header-close-btn--play)', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-tutorial',
            label: 'Upload Panel Tutorial',
            keywords: ['upload tutorial', 'arcgis tutorial', 'gis tutorial'],
            action: () => clickElementByTitle({ titles: 'Tutorial', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-search',
            label: 'Upload Panel Search',
            keywords: ['upload search', 'search services', 'search arcgis services', 'find layers'],
            action: () => clickElementByTitle({ titles: 'Search', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-clear-search',
            label: 'Clear Upload Search',
            keywords: ['clear upload search', 'reset upload search', 'clear services search'],
            action: () => clickElementByTitle({ titles: 'Clear Search', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-update-services',
            label: 'Update ArcGIS Services Data',
            keywords: ['update services', 'refresh services', 'sync arcgis services', 'fetch latest arcgis'],
            action: () => clickElementByTitle({ titles: 'Update services data from ArcGIS REST servers', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-clear-all-layers',
            label: 'Clear All Upload Layers',
            keywords: ['clear all layers', 'uncheck all layers', 'remove all upload layers'],
            action: () => clickElementByTitle({ titles: 'Uncheck all layers on map', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-prev-match',
            label: 'Previous Upload Match',
            keywords: ['previous match upload', 'prev search match upload', 'navigate previous upload result'],
            action: () => clickElementByTitle({ titles: 'Previous match', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-next-match',
            label: 'Next Upload Match',
            keywords: ['next match upload', 'next search match upload', 'navigate next upload result'],
            action: () => clickElementByTitle({ titles: 'Next match', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-back',
            label: 'Upload Panel Back',
            keywords: ['upload back', 'arcgis back', 'back breadcrumb upload'],
            action: () => clickElementByTitle({ titles: 'Back', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-learn-more',
            label: 'Upload Service Learn More',
            keywords: ['upload learn more', 'service info', 'arcgis service details', 'open service info'],
            action: () => clickElementByTitle({ titles: 'Learn more', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-open-state-folder',
            label: 'Open Upload Folder/State',
            keywords: ['open upload folder', 'open upload state', 'browse state services', 'click to open upload'],
            action: () => clickElementByTitle({ titles: 'Click to open', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },
        {
            id: 'upload-load-state-services',
            label: 'Load State Services',
            keywords: ['load state services', 'load wa services', 'load id services', 'load or services'],
            action: () => clickElementByTitleContains({ containsText: 'load', rootSelector: '.upload-panel', ensureOpen: ensureUploadPanelOpen }),
        },

        // Custom layers panel functions
        {
            id: 'custom-help',
            label: 'Custom Layers Help',
            keywords: ['custom layers help', 'custom panel help', 'layer help'],
            action: () => clickElementByTitle({ titles: 'Help', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-close',
            label: 'Close Custom Layers Panel',
            keywords: ['close custom layers panel', 'hide custom layers panel', 'close custom panel'],
            action: () => clickElementBySelector({ selector: '.custom-layers-panel .custom-layers-panel-close-btn:not(.custom-layers-panel-close-btn--help):not(.custom-layers-panel-close-btn--play)', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-tutorial',
            label: 'Custom Layers Tutorial',
            keywords: ['custom layers tutorial', 'custom panel tutorial', 'custom onboarding'],
            action: () => clickElementByTitle({ titles: 'Tutorial', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-new-folder',
            label: 'Create New Custom Folder',
            keywords: ['new folder', 'create folder', 'add folder', 'custom folder'],
            action: () => clickElementByTitle({ titles: 'New Folder', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-search',
            label: 'Custom Layers Search',
            keywords: ['custom search', 'search custom layers', 'find custom service'],
            action: () => clickElementByTitle({ titles: 'Search', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-clear-search',
            label: 'Clear Custom Search',
            keywords: ['clear custom search', 'reset custom search', 'clear custom keyword'],
            action: () => clickElementByTitle({ titles: 'Clear Search', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-clear-all-layers',
            label: 'Clear All Custom Layers',
            keywords: ['clear all custom layers', 'uncheck custom layers', 'remove custom layers from map'],
            action: () => clickElementByTitle({ titles: 'Uncheck all layers on map', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-prev-match',
            label: 'Previous Custom Match',
            keywords: ['previous custom match', 'prev custom search result'],
            action: () => clickElementByTitle({ titles: 'Previous match', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-next-match',
            label: 'Next Custom Match',
            keywords: ['next custom match', 'next custom search result'],
            action: () => clickElementByTitle({ titles: 'Next match', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-back',
            label: 'Custom Layers Back',
            keywords: ['custom back', 'custom breadcrumb back', 'navigate custom folder back'],
            action: () => clickElementByTitle({ titles: 'Back', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-reorder',
            label: 'Reorder Custom Service',
            keywords: ['drag to reorder', 'reorder custom services', 'sort custom services'],
            action: () => clickElementByTitle({ titles: 'Drag to reorder', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },
        {
            id: 'custom-learn-more',
            label: 'Custom Service Learn More',
            keywords: ['custom learn more', 'custom service info', 'custom service details'],
            action: () => clickElementByTitle({ titles: 'Learn more', rootSelector: '.custom-layers-panel', ensureOpen: ensureCustomLayersPanelOpen }),
        },

        // Basemap modal functions
        {
            id: 'basemap-help',
            label: 'Basemap Help',
            keywords: ['basemap help', 'map style help', 'basemap manual'],
            action: () => clickElementByTitle({ titles: 'Help', rootSelector: '.basemap-switcher-panel', ensureOpen: ensureBasemapPanelOpen }),
        },
        {
            id: 'basemap-tutorial',
            label: 'Basemap Tutorial',
            keywords: ['basemap tutorial', 'map style tutorial', 'basemap onboarding'],
            action: () => clickElementByTitle({ titles: 'Tutorial', rootSelector: '.basemap-switcher-panel', ensureOpen: ensureBasemapPanelOpen }),
        },
        {
            id: 'basemap-close',
            label: 'Close Basemap Panel',
            keywords: ['close basemap', 'hide basemap panel', 'dismiss map style panel'],
            action: () => clickElementByTitle({ titles: 'Close', rootSelector: '.basemap-switcher-panel', ensureOpen: ensureBasemapPanelOpen }),
        },
        {
            id: 'basemap-navigation-day',
            label: 'Basemap: navigation-day-v1',
            keywords: ['navigation day', 'navigation-day-v1', 'day map style', 'basemap navigation day'],
            action: () => clickBasemapStyle('navigation-day-v1'),
        },
        {
            id: 'basemap-navigation-night',
            label: 'Basemap: navigation-night-v1',
            keywords: ['navigation night', 'navigation-night-v1', 'night map style', 'basemap navigation night'],
            action: () => clickBasemapStyle('navigation-night-v1'),
        },
        {
            id: 'basemap-outdoors',
            label: 'Basemap: outdoors-v12',
            keywords: ['outdoors', 'outdoors-v12', 'terrain basemap', 'outdoor map style'],
            action: () => clickBasemapStyle('outdoors-v12'),
        },
        {
            id: 'basemap-satellite-streets',
            label: 'Basemap: satellite-streets-v12',
            keywords: ['satellite streets', 'satellite-streets-v12', 'hybrid basemap', 'satellite with labels'],
            action: () => clickBasemapStyle('satellite-streets-v12'),
        },
        {
            id: 'basemap-satellite',
            label: 'Basemap: satellite-v9',
            keywords: ['satellite', 'satellite-v9', 'imagery basemap', 'aerial map'],
            action: () => clickBasemapStyle('satellite-v9'),
        },
        {
            id: 'basemap-streets',
            label: 'Basemap: streets-v12',
            keywords: ['streets', 'streets-v12', 'street basemap', 'default basemap'],
            action: () => clickBasemapStyle('streets-v12'),
        },
    ]);

    const runFeatureSearch = (rawTerm) => {
        const term = (rawTerm || '').trim().toLowerCase();
        if (!term) {
            setMiniFeatureResults([]);
            return;
        }

        const results = getFeatureCatalog().filter(feature => {
            const normalizedKeywords = feature.keywords.map(keyword => keyword.toLowerCase());
            return normalizedKeywords.some(keyword => keyword.includes(term) || term.includes(keyword));
        });
        setMiniFeatureResults(results);
    };

    const handleMiniSearch = (e) => {
        e.preventDefault();
        runFeatureSearch(miniSearchTerm);
    };

    const handleMiniSearchInputChange = (e) => {
        const value = e.target.value;
        setMiniSearchTerm(value);
        runFeatureSearch(value);
    };

    const handleMiniSearchClear = () => {
        setMiniSearchTerm('');
        setMiniFeatureResults([]);
        if (miniSearchInputRef.current) {
            miniSearchInputRef.current.focus();
        }
    };

    const handleFeatureResultClick = (feature) => {
        if (!feature || typeof feature.action !== 'function') return;
        feature.action();
        addRecentFeature(feature);
        setIsSearchModalOpen(false);
    };

    const addRecentFeature = (feature) => {
        if (!feature || !feature.id || !feature.label) return;
        setRecentFeatures(prev => {
            const existing = prev.find(f => f.id === feature.id);
            const pinned = existing ? existing.pinned : false;
            const rest = prev.filter(f => f.id !== feature.id);
            const entry = { id: feature.id, label: feature.label, pinned };
            const ordered = pinned
                ? [entry, ...rest]
                : [...rest.filter(f => f.pinned), entry, ...rest.filter(f => !f.pinned)];
            // Cap unpinned entries; pinned items are always kept.
            let unpinnedCount = 0;
            return ordered.filter(f => {
                if (f.pinned) return true;
                unpinnedCount += 1;
                return unpinnedCount <= 10;
            });
        });
    };

    const togglePinRecentFeature = (id) => {
        setRecentFeatures(prev => {
            const target = prev.find(f => f.id === id);
            if (!target) return prev;
            const rest = prev.filter(f => f.id !== id);
            const entry = { ...target, pinned: !target.pinned };
            return entry.pinned
                ? [entry, ...rest]
                : [...rest.filter(f => f.pinned), entry, ...rest.filter(f => !f.pinned)];
        });
    };

    const removeRecentFeature = (id) => {
        setRecentFeatures(prev => prev.filter(f => f.id !== id));
    };

    const runRecentFeature = (id) => {
        const feature = getFeatureCatalog().find(f => f.id === id);
        if (!feature || typeof feature.action !== 'function') {
            // Stale entry no longer in the catalog – drop it.
            removeRecentFeature(id);
            return;
        }
        feature.action();
        addRecentFeature(feature);
        setIsSearchModalOpen(false);
    };

    const handleCardClick = (coords) => {
        console.log('[Home] handleCardClick received coords:', coords);
        setSelectedCardCoords(coords);
    };

    const toggleSearchModal = () => {
        setIsSearchModalOpen(!isSearchModalOpen);
    };

    const toggleCardContainer = () => {
        setIsCollapsed(prev => !prev);
    };

    const toggleSidebarChatbotPanel = () => {
        if (chatbotDisplayMode === 'floating') return;
        setIsChatbotOpen(prev => {
            const next = !prev;
            if (next) {
                setIsUploadPanelOpen(false);
                setIsCustomLayerPanelOpen(false);
                setIsBasemapOpen(false);
            }
            return next;
        });
    };

    const handleChatbotDisplayModeChange = (nextMode) => {
        setChatbotDisplayMode(nextMode);
        if (nextMode === 'sidebar') {
            setIsUploadPanelOpen(false);
            setIsCustomLayerPanelOpen(false);
            setIsBasemapOpen(false);
        }
        setIsChatbotOpen(true);
    };

    const getMapboxMap = () => window.atlasMapInstance;

    // Basemap switcher state
    const [isBasemapOpen, setIsBasemapOpen] = useState(false);
    const [preferredBasemapId, setPreferredBasemapId] = useState('streets-v12');
    const [cardViewModePreference, setCardViewModePreference] = useState('grid');
    const [preferencesLoaded, setPreferencesLoaded] = useState(false);
    const [localPreferencesReady, setLocalPreferencesReady] = useState(false);

    const applyUiPreferences = (preferences) => {
        const uiPrefs = preferences?.ui || {};
        setPreferredBasemapId(
            typeof uiPrefs.basemapId === 'string' && uiPrefs.basemapId.trim()
                ? uiPrefs.basemapId
                : 'streets-v12'
        );
        const newCardViewMode = uiPrefs.cardViewMode === 'list' ? 'list' : 'grid';
        setCardViewModePreference(newCardViewMode);
        if (newCardViewMode === 'list') {
            setCardPanelWidth(Math.round(window.innerWidth * 0.25));
        }
        setCardPanelSide(uiPrefs.cardPanelSide === 'left' ? 'left' : 'right');
        setChatbotDisplayMode(uiPrefs.chatbotDisplayMode === 'sidebar' ? 'sidebar' : 'floating');
    };

    useEffect(() => {
        let cancelled = false;

        const loadPreferences = async () => {
            if (!props.isLoggedIn || !props.email) {
                const localPreferences = readPendingLocalPreferences();
                if (!cancelled && hasPreferenceValues(localPreferences)) {
                    applyUiPreferences(localPreferences);
                }
                if (!cancelled) {
                    setPreferencesLoaded(false);
                    setLocalPreferencesReady(true);
                }
                return;
            }

            if (!cancelled) {
                setPreferencesLoaded(false);
                setLocalPreferencesReady(false);
            }

            try {
                const [cloudPreferences, localPendingPreferences] = await Promise.all([
                    fetchUserPreferences(props.email),
                    Promise.resolve(readPendingLocalPreferences()),
                ]);

                if (cancelled) return;

                const mergedPreferences = deepMergePreferences(cloudPreferences, localPendingPreferences);
                applyUiPreferences(mergedPreferences);

                if (hasPreferenceValues(localPendingPreferences)) {
                    await saveUserPreferences(props.email, mergedPreferences);
                    clearPendingLocalPreferences();
                }
            } catch (error) {
                console.warn('[Home] Failed to load user preferences:', error);
            } finally {
                if (!cancelled) {
                    setPreferencesLoaded(true);
                }
            }
        };

        loadPreferences();

        return () => {
            cancelled = true;
        };
    }, [props.isLoggedIn, props.email]);

    useEffect(() => {
        if (!props.isLoggedIn || !props.email || !preferencesLoaded) {
            return;
        }

        if (!uiPrefsWriteInitializedRef.current) {
            uiPrefsWriteInitializedRef.current = true;
            return;
        }

        const timer = setTimeout(() => {
            saveUserPreferences(props.email, {
                ui: {
                    basemapId: preferredBasemapId,
                    cardViewMode: cardViewModePreference,
                    cardPanelSide,
                    chatbotDisplayMode,
                },
            }).catch(error => {
                console.warn('[Home] Failed to save user preferences:', error);
            });
        }, 300);

        return () => clearTimeout(timer);
    }, [
        props.isLoggedIn,
        props.email,
        preferencesLoaded,
        preferredBasemapId,
        cardViewModePreference,
        cardPanelSide,
        chatbotDisplayMode,
    ]);

    useEffect(() => {
        if (props.isLoggedIn || !localPreferencesReady) {
            return;
        }

        const timer = setTimeout(() => {
            writePendingLocalPreferences({
                ui: {
                    basemapId: preferredBasemapId,
                    cardViewMode: cardViewModePreference,
                    cardPanelSide,
                    chatbotDisplayMode,
                },
            });
        }, 200);

        return () => clearTimeout(timer);
    }, [
        props.isLoggedIn,
        localPreferencesReady,
        preferredBasemapId,
        cardViewModePreference,
        cardPanelSide,
        chatbotDisplayMode,
    ]);

    const addArcgisLayer = (layerIds = checkedArcgisLayerIds) => {
        const map = window.atlasMapInstance;
        if (!map) return;

        if (map.getLayer('arcgis-raster-layer')) map.removeLayer('arcgis-raster-layer');
        if (map.getSource('arcgis-raster')) map.removeSource('arcgis-raster');

        let layersParam = '';
        if (layerIds.length > 0) {
            layersParam = '&layers=show:' + layerIds.join(',');
        }

        map.addSource('arcgis-raster', {
            type: 'raster',
            tiles: [
                `https://gis.ecology.wa.gov/serverext/rest/services/Authoritative/AQ/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image${layersParam}`
            ],
            tileSize: 256,
            minzoom: 5,
            maxzoom: 12
        });
        map.addLayer({
            id: 'arcgis-raster-layer',
            type: 'raster',
            source: 'arcgis-raster',
            paint: {
                'raster-opacity': 0.35
            }
        });
        setArcgisLayerAdded(true);
    };

    const removeArcgisLayer = () => {
        const map = window.atlasMapInstance;
        if (!map) return;
        if (map.getLayer('arcgis-raster-layer')) map.removeLayer('arcgis-raster-layer');
        if (map.getSource('arcgis-raster')) map.removeSource('arcgis-raster');
        setArcgisLayerAdded(false);
    };

    const [checkedArcgisLayerIds, setCheckedArcgisLayerIds] = useState([]);

    const handleLayerCheckbox = (layerId) => {
        let newChecked;
        if (checkedArcgisLayerIds.includes(layerId)) {
            newChecked = checkedArcgisLayerIds.filter(id => id !== layerId);
        } else {
            newChecked = [...checkedArcgisLayerIds, layerId];
        }
        setCheckedArcgisLayerIds(newChecked);
        if (arcgisLayerAdded) {
            addArcgisLayer(newChecked);
        }
    };

    const handleSelectAll = () => {
        if (checkedArcgisLayerIds.length === arcgisLayers.length) {
            setCheckedArcgisLayerIds([]);
            if (arcgisLayerAdded) removeArcgisLayer();
        } else {
            const allIds = arcgisLayers.map(l => l.id);
            setCheckedArcgisLayerIds(allIds);
            if (arcgisLayerAdded) addArcgisLayer(allIds);
        }
    };

    useEffect(() => {
        if (checkedArcgisLayerIds.length === 0) {
            if (arcgisLayerAdded) removeArcgisLayer();
        } else {
            if (!arcgisLayerAdded) {
                addArcgisLayer(checkedArcgisLayerIds);
            } else {
                addArcgisLayer(checkedArcgisLayerIds);
            }
        }
        // eslint-disable-next-line
    }, [checkedArcgisLayerIds]);

    // Card marker visibility state
    const [layerVisibility, setLayerVisibility] = useState({
        River: true,
        Watershed: true,
        Places: true,
    });

    // Colored area (vector tile) visibility state
    const [areaVisibility, setAreaVisibility] = useState({
        River: false,
        Watershed: false,
        Places: false,
    });

    // Helper to show/hide markers by class
    const updateLayerVisibility = (visibility) => {
        const rivers = document.getElementsByClassName("blue-marker");
        for (let i = 0; i < rivers.length; i++) {
            rivers[i].style.visibility = visibility.River ? "visible" : "hidden";
        }
        const watersheds = document.getElementsByClassName("green-marker");
        for (let i = 0; i < watersheds.length; i++) {
            watersheds[i].style.visibility = visibility.Watershed ? "visible" : "hidden";
        }
        const places = document.getElementsByClassName("yellow-marker");
        for (let i = 0; i < places.length; i++) {
            places[i].style.visibility = visibility.Places ? "visible" : "hidden";
        }
    };

    // Show/hide colored areas (vector tile layers)
    useEffect(() => {
        applyAreaVisibility(areaVisibility);
    }, [areaVisibility]);

    // Update marker visibility when checkboxes change
    useEffect(() => {
        if (layerVisibility.River && layerVisibility.Watershed && layerVisibility.Places) {
            showAll();
        } else {
            updateLayerVisibility(layerVisibility);
        }
    }, [layerVisibility]);

    const handleCategoryLayerCheckbox = (category) => {
        setLayerVisibility((prev) => ({
            ...prev,
            [category]: !prev[category],
        }));
    };

    const handleAreaCheckbox = (category) => {
        setAreaVisibility((prev) => ({
            ...prev,
            [category]: !prev[category],
        }));
    };

    return (
        <div className={`home-container${isMapFullscreen ? ' home-container--fullscreen' : ''}`}>
            <div className={`left-sidebar ${isSidebarOpen ? 'open' : ''}`} data-onboarding-target="left-sidebar-root">
                {/* Left Sidebar Search Button */}
                <button
                    className={`left-sidebar-search-button${isSearchModalOpen ? ' active' : ''}`}
                    data-onboarding-target="left-sidebar-search"
                    onClick={toggleSearchModal}
                >
                    <FontAwesomeIcon icon={faSearch} />
                </button>

                {/* Card Container Toggle Button */}
                <button
                    className={`left-sidebar-cards-button${!isCollapsed ? ' active' : ''}`}
                    data-onboarding-target="left-sidebar-cards"
                    onClick={toggleCardContainer}
                    title={isCollapsed ? "Show Cards" : "Hide Cards"}
                >
                    <FontAwesomeIcon icon={faClone} />
                </button>

                {/* GIS Services Button */}
                <button
                    className={`left-sidebar-gis-button${isUploadPanelOpen ? ' active' : ''}`}
                    data-onboarding-target="left-sidebar-gis"
                    onClick={() => {
                        setIsUploadPanelOpen(v => {
                            const next = !v;
                            if (next && chatbotDisplayMode === 'sidebar') setIsChatbotOpen(false);
                            return next;
                        });
                        setIsCustomLayerPanelOpen(false);
                        setIsBasemapOpen(false);
                    }}
                    title="Toggle Layers"
                >
                    <FontAwesomeIcon icon={faLayerGroup} />
                </button>

                {/* Upload Panel */}
                <ArcgisUploadPanel
                    isOpen={isUploadPanelOpen}
                    onClose={() => setIsUploadPanelOpen(false)}
                    splitBottom={cardPanelSide === 'left' && !isCollapsed}
                    mapInstance={getMapboxMap}
                    arcgisLayerAdded={arcgisLayerAdded}
                    setArcgisLayerAdded={setArcgisLayerAdded}
                    areaVisibility={areaVisibility}
                    handleAreaCheckbox={handleAreaCheckbox}
                    navigateToItem={arcgisNavigateTarget}
                    onNavigateToItemDone={() => setArcgisNavigateTarget(null)}
                    onCustomLayerSaved={() => setCustomLayersRefreshKey(k => k + 1)}
                />

                {/* Custom Layers Button */}
                <button
                    className={`left-sidebar-customlayers-button${isCustomLayerPanelOpen ? ' active' : ''}`}
                    data-onboarding-target="left-sidebar-customlayers"
                    onClick={() => {
                        setIsCustomLayerPanelOpen(v => {
                            const next = !v;
                            if (next && chatbotDisplayMode === 'sidebar') setIsChatbotOpen(false);
                            return next;
                        });
                        setIsUploadPanelOpen(false);
                        setIsBasemapOpen(false);
                    }}
                    title="Custom Layers"
                >
                    <FontAwesomeIcon icon={faObjectGroup} />
                </button>

                {/* Custom Layers Panel */}
                <CustomLayersPanel
                    isOpen={isCustomLayerPanelOpen}
                    onClose={() => setIsCustomLayerPanelOpen(false)}
                    splitBottom={cardPanelSide === 'left' && !isCollapsed}
                    mapInstance={getMapboxMap}
                    refreshKey={customLayersRefreshKey}
                />

                {/* Basemap Switcher Button */}
                <button
                    className={`left-sidebar-basemap-button${isBasemapOpen ? ' active' : ''}`}
                    data-onboarding-target="left-sidebar-basemap"
                    onClick={() => {
                        const shouldForceOpen = isUploadPanelOpen || isCustomLayerPanelOpen;
                        setIsUploadPanelOpen(false);
                        setIsCustomLayerPanelOpen(false);
                        setIsBasemapOpen(v => (shouldForceOpen ? true : !v));
                        if (chatbotDisplayMode === 'sidebar') {
                            setIsChatbotOpen(false);
                        }
                    }}
                    title="Change Basemap"
                >
                    <FontAwesomeIcon icon={faMap} />
                </button>

                <button
                    className={`left-sidebar-chatbot-button${chatbotDisplayMode === 'sidebar' && isChatbotOpen ? ' active' : ''}`}
                    data-onboarding-target="left-sidebar-chatbot"
                    onClick={toggleSidebarChatbotPanel}
                    title={
                        chatbotDisplayMode === 'floating'
                            ? 'Chatbot button disabled in floating mode'
                            : (isChatbotOpen ? 'Close Chatbot' : 'Open Chatbot')
                    }
                    disabled={chatbotDisplayMode === 'floating'}
                >
                    <FontAwesomeIcon icon={faEarthAmericas} />
                </button>

                {/* Basemap Switcher Panel */}
                <BasemapSwitcher
                    isOpen={isBasemapOpen}
                    onClose={() => setIsBasemapOpen(false)}
                    splitBottom={cardPanelSide === 'left' && !isCollapsed}
                    mapInstance={getMapboxMap}
                    currentBasemapId={preferredBasemapId}
                    onBasemapChange={setPreferredBasemapId}
                />

                {/* Spacer pushes bell to bottom */}
                <div className="left-sidebar-spacer" />

                {/* Changelog Bell Button */}
                <button
                    className="left-sidebar-changelog-button"
                    data-onboarding-target="left-sidebar-changelog"
                    onClick={() => setIsChangelogOpen(true)}
                    title="What's new"
                >
                    <FontAwesomeIcon icon={faBell} />
                    {hasUnseenChangelog && <span className="changelog-notification-dot" />}
                </button>

                <button
                    className="left-sidebar-onboarding-button"
                    data-onboarding-target="left-sidebar-general-onboarding"
                    onClick={() => setIsGeneralOnboardingOpen(true)}
                    title="App onboarding"
                >
                    <FontAwesomeIcon icon={faInfoCircle} />
                </button>

                {/* Expanded Left Sidebar Content */}
                {isSidebarOpen && (
                    <div className="left-sidebar-content">
                        <Header
                            isLoggedIn={props.isLoggedIn}
                            filterCondition={filterCondition}
                            setFilterCondition={setFilterCondition}
                            searchCondition={searchCondition}
                            setSearchCondition={setSearchCondition}
                            sortCondition={sortCondition}
                            setSortCondition={setSortCondition}
                            CategoryCondition={CategoryCondition}
                            setCategoryConditionCondition={setCategoryConditionCondition}
                            email={props.email}
                            username={props.username}
                            isAdmin={props.isAdmin}
                        />
                    </div>
                )}
            </div>

            {/* Mini Search Modal */}
            <div
                className={`search-mini-modal${isSearchModalOpen ? ' search-mini-modal--open' : ''}`}
                data-onboarding-target="left-sidebar-search-panel"
            >
                <form className="search-mini-form" onSubmit={handleMiniSearch}>
                    <input
                        ref={miniSearchInputRef}
                        type="text"
                        className="search-mini-input"
                        placeholder="Search homepage features..."
                        value={miniSearchTerm}
                        onChange={handleMiniSearchInputChange}
                    />
                    <button type="submit" className="search-mini-button">
                        <FontAwesomeIcon icon={faSearch} />
                    </button>
                    <button
                        type="button"
                        className="search-mini-clear-button"
                        onClick={handleMiniSearchClear}
                        title="Clear Search"
                        aria-label="Clear Search"
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </form>
                <div className="search-mini-results" aria-live="polite">
                    {!miniSearchTerm.trim() && (
                        <div className="search-mini-results-empty">Search features by keywords.</div>
                    )}
                    {!!miniSearchTerm.trim() && miniFeatureResults.length === 0 && (
                        <div className="search-mini-results-empty">No features matched this keyword.</div>
                    )}
                    {miniFeatureResults.map((feature) => (
                        <button
                            key={feature.id}
                            type="button"
                            className="search-mini-result-item"
                            onClick={() => handleFeatureResultClick(feature)}
                        >
                            {feature.label}
                        </button>
                    ))}
                </div>
                {recentFeatures.length > 0 && (
                    <div className="search-mini-recent">
                        <div className="search-mini-recent-title">Recently used</div>
                        <div className="search-mini-recent-list">
                            {recentFeatures.map((item) => (
                                <div
                                    key={item.id}
                                    className={`search-mini-recent-item${item.pinned ? ' search-mini-recent-item--pinned' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className="search-mini-recent-run"
                                        onClick={() => runRecentFeature(item.id)}
                                        title={item.label}
                                    >
                                        {item.pinned && (
                                            <FontAwesomeIcon
                                                icon={faThumbtack}
                                                className="search-mini-recent-pin-indicator"
                                            />
                                        )}
                                        <span className="search-mini-recent-label">{item.label}</span>
                                    </button>
                                    <div className="search-mini-recent-actions">
                                        <button
                                            type="button"
                                            className={`search-mini-recent-action${item.pinned ? ' search-mini-recent-action--active' : ''}`}
                                            onClick={() => togglePinRecentFeature(item.id)}
                                            title={item.pinned ? 'Unpin' : 'Pin to top'}
                                            aria-label={item.pinned ? 'Unpin' : 'Pin to top'}
                                        >
                                            <FontAwesomeIcon icon={faThumbtack} />
                                        </button>
                                        <button
                                            type="button"
                                            className="search-mini-recent-action"
                                            onClick={() => removeRecentFeature(item.id)}
                                            title="Remove"
                                            aria-label="Remove"
                                        >
                                            <FontAwesomeIcon icon={faTimes} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Main Map + Right Sidebar */}
            <Main
                filterCondition={filterCondition}
                setFilterCondition={setFilterCondition}
                searchCondition={searchCondition}
                setSearchCondition={setSearchCondition}
                sortCondition={sortCondition}
                setSortCondition={setSortCondition}
                boundCondition={boundCondition}
                setboundCondition={setboundCondition}
                CategoryCondition={CategoryCondition}
                setCategoryConditionCondition={setCategoryConditionCondition}
                isAdmin={props.isAdmin}
                username={props.username}
                isLoggedIn={props.isLoggedIn}            /* <-- added */
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
                isSidebarOpen={isSidebarOpen}
                isUploadPanelOpen={isUploadPanelOpen}
                isCustomLayerPanelOpen={isCustomLayerPanelOpen}
                isBasemapOpen={isBasemapOpen}
                isChatbotSidebarOpen={isChatbotOpen && chatbotDisplayMode === 'sidebar'}
                selectedCardCoords={selectedCardCoords}
                onMarkerCardSelect={setSelectedCardIdFromMap}
                cardPanelWidth={cardPanelWidth}
                cardPanelSide={cardPanelSide}
                isMapFullscreen={isMapFullscreen}
            />

            <Content2
                filterCondition={filterCondition}
                setFilterCondition={setFilterCondition}
                searchCondition={searchCondition}
                setSearchCondition={setSearchCondition}
                searchTriggerSource={searchTriggerSource}
                setSearchTriggerSource={setSearchTriggerSource}
                sidebarSearchRequestId={sidebarSearchRequestId}
                sortCondition={sortCondition}
                setSortCondition={setSortCondition}
                boundCondition={boundCondition}
                setboundCondition={setboundCondition}
                CategoryCondition={CategoryCondition}
                setCategoryConditionCondition={setCategoryConditionCondition}
                username={props.username}
                isLoggedIn={props.isLoggedIn}             /* <-- added */
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
                selectedCardIdFromMap={selectedCardIdFromMap}
                cardPanelWidth={cardPanelWidth}
                setCardPanelWidth={setCardPanelWidth}
                cardPanelSide={cardPanelSide}
                setCardPanelSide={setCardPanelSide}
                initialCardViewMode={cardViewModePreference}
                onCardViewModeChange={setCardViewModePreference}
                isUploadPanelOpen={isUploadPanelOpen}
                onCardClick={handleCardClick}
            />

            {/* Changelog Modal */}
            <ChangelogModal isOpen={isChangelogOpen} onClose={closeChangelog} />

            {/* App General Onboarding Modal */}
            <GeneralOnboardingModal isOpen={isGeneralOnboardingOpen} onClose={closeGeneralOnboarding} onPlay={startGeneralOnboardingTour} />

            {/* App General Onboarding Tour */}
            <GeneralOnboarding isOpen={isGeneralOnboardingTourOpen} onClose={closeGeneralOnboardingTour} />

            {/* AI Chatbot floating widget */}
            <ChatbotWidget
                displayMode={chatbotDisplayMode}
                isOpen={isChatbotOpen}
                onOpenChange={setIsChatbotOpen}
                onDisplayModeChange={handleChatbotDisplayModeChange}
                splitBottom={cardPanelSide === 'left' && !isCollapsed}
            />

        </div>
    );
}

export default Home;
