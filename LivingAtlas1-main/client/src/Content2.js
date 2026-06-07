import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import './Content2.css';
import './Sidebars.css';
import Card from './Card.js';
import FormModal from './FormModal';
import FilterDropdown from './FilterDropdown';
import SortDropdown from './SortDropdown';
import CardPanelOnboarding from './OnboardingCardPanel';
import axios from 'axios';
import { showAll, filterCategory, filterTag, filterCategoryAndTag } from "./Filter.js";
import { curLocationCoordinates, searchLocationCoordinates } from './Content1.js';
import { allMarkers } from './Content1.js';
import api from './api.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAngleDoubleLeft, faAngleDoubleRight, faHeart, faSearch, faTimes, faPlus, faMapMarkerAlt, faList, faGrip, faRightLeft, faThumbtack, faEllipsisV, faQuestion, faPlay } from '@fortawesome/free-solid-svg-icons';
import { useLocation } from 'react-router-dom';

function Content2(props) {
    const { setCardPanelWidth, cardPanelSide, setCardPanelSide } = props;
    const isOnLeft = cardPanelSide === 'left';
    const bothOnLeft = isOnLeft && !props.isCollapsed && props.isUploadPanelOpen;
    const [isModalOpen, setIsModalOpen] = useState(false); // State to control modal visibility
    const [pendingPolygonData, setPendingPolygonData] = useState(null);
    const [pendingImageOverlayData, setPendingImageOverlayData] = useState(null);
    const [pendingPointToolSignal, setPendingPointToolSignal] = useState(null);
    const containerWidth = props.cardPanelWidth ?? 300;
    const containerRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const startX = useRef(0);
    const startWidth = useRef(500);
    const cardContainerRef = useRef(null);
    const lastHandledSidebarSearchRequestRef = useRef(0);
    const [openMenuCardID, setOpenMenuCardID] = useState(null);
    const menuRef = useRef(null);

    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => {
        setIsModalOpen(false);
        setPendingPolygonData(null);
        setPendingImageOverlayData(null);
        setPendingPointToolSignal(null);
    };


    // Listen for polygon-tool-save from Content1's Polygon Tool
    useEffect(() => {
        const handler = (e) => {
            if (!props.isLoggedIn) {
                setShowLoginPrompt(true);
                return;
            }
            setPendingPolygonData(e.detail);
            setIsModalOpen(true);
        };
        window.addEventListener('polygon-tool-save', handler);
        return () => window.removeEventListener('polygon-tool-save', handler);
    }, [props.isLoggedIn]);

    useEffect(() => {
        const handler = (e) => {
            if (!props.isLoggedIn) {
                setShowLoginPrompt(true);
                return;
            }
            setPendingImageOverlayData(e.detail);
            setIsModalOpen(true);
        };
        window.addEventListener('map-image-tool-save', handler);
        return () => window.removeEventListener('map-image-tool-save', handler);
    }, [props.isLoggedIn]);

    useEffect(() => {
        const handler = () => {
            if (!props.isLoggedIn) {
                setShowLoginPrompt(true);
                return;
            }
            setPendingPointToolSignal(Date.now());
        };
        window.addEventListener('map-point-tool-start', handler);
        return () => window.removeEventListener('map-point-tool-start', handler);
    }, [props.isLoggedIn]);

    useEffect(() => {
        const handler = () => {
            if (!props.isLoggedIn) {
                setShowLoginPrompt(true);
                return;
            }
            openModal();
        };
        window.addEventListener('atlas:open-create-card-modal', handler);
        return () => window.removeEventListener('atlas:open-create-card-modal', handler);
    }, [props.isLoggedIn]);

    // Fired by Content1's polygon/image tool buttons when the user is not logged in
    useEffect(() => {
        const handler = () => setShowLoginPrompt(true);
        window.addEventListener('atlas:login-required', handler);
        return () => window.removeEventListener('atlas:login-required', handler);
    }, []);

    function useDidMount() {
        const mountRef = useRef(false);
        useEffect(() => { mountRef.current = true }, []);
        return () => mountRef.current;
    }

    const didMount = useDidMount();
    const didMountRef = useRef(false);

    const toggleCollapse = () => {
        props.setIsCollapsed?.(!props.isCollapsed);
    };

    // Drag handlers for resizing
    const onMouseDown = (e) => {
        e.preventDefault(); // Prevent text selection
        setIsDragging(true);
        startX.current = e.clientX;
        startWidth.current = containerWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    };

    useEffect(() => {
        if (!isDragging) return;
        const onMouseMove = (e) => {
            const dx = isOnLeft
                ? e.clientX - startX.current
                : startX.current - e.clientX;
            let newWidth = startWidth.current + dx;
            // Keep two responsive columns: derive width limits from desired
            // per-card min/max sizes under a fixed 2-column grid.
            const COLUMNS = 2;
            const CARD_MIN = 170;
            const CARD_MAX = 360;
            const GRID_GAP = 16;
            const GRID_PADDING = 32;
            const SCROLLBAR_GUTTER = 20;
            const minWidth = Math.max(300, Math.floor(COLUMNS * CARD_MIN + (COLUMNS - 1) * GRID_GAP + GRID_PADDING + SCROLLBAR_GUTTER));
            const maxWidth = Math.ceil(COLUMNS * CARD_MAX + (COLUMNS - 1) * GRID_GAP + GRID_PADDING + SCROLLBAR_GUTTER);
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
            setCardPanelWidth?.(newWidth);
        };
        const onMouseUp = () => {
            setIsDragging(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [isDragging, setCardPanelWidth, isOnLeft]);

    // Close card action menu when clicking outside
    useEffect(() => {
        if (!openMenuCardID) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setOpenMenuCardID(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openMenuCardID]);

    useEffect(() => {
        if (props.isCollapsed && isOnboardingOpen) {
            setIsOnboardingOpen(false);
        }
    }, [props.isCollapsed, isOnboardingOpen]);

    const location = useLocation();
    const resolvedUsername = props.username || location.state?.username || localStorage.getItem("username");

    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const [markersVisible, setMarkersVisible] = useState(true);
    const [cardSearchKeyword, setCardSearchKeyword] = useState(props.searchCondition || '');
    const [cardTypeFilter, setCardTypeFilter] = useState(props.CategoryCondition || '');
    const [sortMode, setSortMode] = useState((props.sortCondition || '').split(',')[0] || '');
    const [showOnlyInView, setShowOnlyInView] = useState(false);
    const [learnMoreRequest, setLearnMoreRequest] = useState(null);
    const [isListView, setIsListView] = useState((props.initialCardViewMode || 'grid') === 'list');
    const [containerPanelSearchVersion, setContainerPanelSearchVersion] = useState(0);
    const PINNED_CARDS_STORAGE_KEY = 'pinned_card_ids';
    const [pinnedCardIDs, setPinnedCardIDs] = useState(() => {
        try {
            const raw = localStorage.getItem(PINNED_CARDS_STORAGE_KEY);
            return raw ? new Set(JSON.parse(raw)) : new Set();
        } catch {
            return new Set();
        }
    });
    const togglePin = (cardID) => {
        setPinnedCardIDs(prev => {
            const next = new Set(prev);
            if (next.has(cardID)) next.delete(cardID);
            else next.add(cardID);
            try {
                localStorage.setItem(PINNED_CARDS_STORAGE_KEY, JSON.stringify([...next]));
            } catch {}
            return next;
        });
    };
    const prevWidthBeforeList = useRef(null);
    const prevListViewBeforeBothLeft = useRef(null);

    // Force list view when card panel + upload panel both on left
    useEffect(() => {
        if (bothOnLeft && !isListView) {
            prevListViewBeforeBothLeft.current = false;
            setIsListView(true);
        } else if (!bothOnLeft && prevListViewBeforeBothLeft.current === false) {
            prevListViewBeforeBothLeft.current = null;
            setIsListView(false);
        }
    }, [bothOnLeft]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!props.initialCardViewMode) return;
        setIsListView(props.initialCardViewMode === 'list');
    }, [props.initialCardViewMode]);
    const selectedCardIdFromMap = props.selectedCardIdFromMap != null
        ? String(props.selectedCardIdFromMap)
        : null;

    const handleFavoritesToggle = () => {
        if (!props.isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }
        setShowFavoritesOnly(prev => !prev);
    };

    const toggleViewScope = () => {
        setShowOnlyInView(prev => !prev);
    };

    const notifyCardsLoaded = (cardCount) => {
        window.dispatchEvent(new CustomEvent('atlas:cards-loaded', {
            detail: { cardCount }
        }));
    };

    const handleCardSearch = () => {
        props.setSearchTriggerSource?.('container-panel');
        props.setSearchCondition?.(cardSearchKeyword.trim().toLowerCase());
        props.setCategoryConditionCondition?.(cardTypeFilter);
        setContainerPanelSearchVersion(prev => prev + 1);
    };

    const handleCardSearchClear = () => {
        props.setSearchTriggerSource?.('container-panel');
        setCardSearchKeyword('');
        setCardTypeFilter('');
        props.setSearchCondition?.('');
        props.setCategoryConditionCondition?.('');
    };

    const handleSortModeChange = (nextSortMode) => {

        if (!nextSortMode) {
            setSortMode('');
            props.setSortCondition?.('');
            return;
        }

        if (nextSortMode === 'ClosestToMe') {
            const { lat, lng } = curLocationCoordinates;
            if (!lat && !lng) {
                alert('Please turn on your current location to use this sorting method.');
                return;
            }
            setSortMode(nextSortMode);
            props.setSortCondition?.(`${nextSortMode},${lat},${lng}`);
            return;
        }

        if (nextSortMode === 'ClosestToPin') {
            const { lat, lng } = searchLocationCoordinates;
            if (!lat && !lng) {
                alert('Please search a location on the map first to use this sorting method.');
                return;
            }
            setSortMode(nextSortMode);
            props.setSortCondition?.(`${nextSortMode},${lat},${lng}`);
            return;
        }

        setSortMode(nextSortMode);
        props.setSortCondition?.(nextSortMode);
    };

    // Edited by Flavio: same code used to load the cards based on filter. Made it into a function in order to call it under searchConditions being reset to ''
    function loadCardsByCriteria() {
        let params = {};

        if (props.CategoryCondition) params.categoryString = props.CategoryCondition;
        if (props.filterCondition) params.tagString = props.filterCondition;
        if (props.sortCondition) params.sortString = props.sortCondition;

        // Show all locally if no filters
        if (!props.CategoryCondition && !props.filterCondition && !props.searchCondition && !props.sortCondition) {
            showAll();
            api.get('/allCards')
                .then(response => {
                    const cardData = response.data?.data || [];
                    console.log('[Content2] /allCards response:', cardData.length, 'cards');
                    
                    // Deduplicate by cardID
                    const uniqueCards = cardData.filter((card, index, self) => 
                        index === self.findIndex(c => c.cardID === card.cardID)
                    );
                    // console.log('[Content2] After deduplication:', uniqueCards.length, 'unique cards');
                    // console.table(uniqueCards);
                    setCards(uniqueCards);
                    notifyCardsLoaded(uniqueCards.length);
                })
                .catch(error => console.error(error));
            return;
        }

        // Always fetch filtered/sorted cards from the server
        showAll();
        api.get('/allCardsByTag', { params })
            .then(response => {
                const cardData = response.data?.data || [];
                
                // Deduplicate by cardID
                const uniqueCards = cardData.filter((card, index, self) => 
                    index === self.findIndex(c => c.cardID === card.cardID)
                );
                // console.log('[Content2] /allCardsByTag:', uniqueCards.length, 'unique cards from', cardData.length);
                // console.table(uniqueCards);
                setCards(uniqueCards);
                notifyCardsLoaded(uniqueCards.length);
            })
            .catch(error => console.error('Error fetching cards by criteria:', error));
        /*
        if (!didMountRef.current) {
            return;
        }
        console.log(props.filterCondition, props.CategoryCondition, props.sortCondition, props.searchCondition);
        if (props.filterCondition === '' && props.searchCondition === '' && props.CategoryCondition === '' && props.sortCondition === '') {
            console.log("running filter 199" + props.filterCondition);
            showAll();

            api.get('/allCards')

                .then(response => {
                    console.log("Fetched cards:", response.data.data);
                    setCards(response.data.data);
                })
                .catch(error => {
                    console.error(error);
                });
        }
        else {
            // Fetch cards when props.filterCondition changes
            console.log("running filter 197" + props.filterCondition);
            if (props.filterCondition === '') {
                console.log("running category " + props.CategoryCondition);
                showAll();
                filterCategory(props.CategoryCondition);
                let params = {categoryString: props.CategoryCondition};
                if (props.sortCondition) {
                    params.sortString = props.sortCondition;
                }
                if (props.searchCondition) {
                    params.titleSearch = props.searchCondition
                }

                api.get('/allCardsByTag', {
                    params: params
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', error);
                    });
            } else if (props.CategoryCondition === '') {
                console.log("running filter 196 " + props.filterCondition);
                showAll();
                filterTag(props.filterCondition);
                let params = {tagString: props.filterCondition};
                if (props.sortCondition) {
                    params.sortString = props.sortCondition;
                }
                if (props.searchCondition) {
                    params.titleSearch = props.searchCondition
                }

                api.get('/allCardsByTag', {
                    params: params
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', error);
                    });
            } else if (props.CategoryCondition !== '' && props.filterCondition !== '') {
                showAll();
                filterCategoryAndTag(props.CategoryCondition, props.filterCondition)
                let params = {categoryString: props.CategoryCondition,
                                tagString: props.filterCondition};
                if (props.sortCondition) {
                    params.sortString = props.sortCondition;
                }
                if (props.searchCondition) {
                    params.titleSearch = props.searchCondition
                }

                api.get('/allCardsByTag', {
                    params: params
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', error);
                    });
            } else if (props.sortCondition !== '') {
                showAll();
                let params = {sortString: props.sortCondition};
                if (props.searchCondition) {
                    params.titleSearch = props.searchCondition
                }
                api.get('/allCardsByTag', {
                    params: params
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', props.sortCondition);
                    });
            } else if (props.searchCondition !== '') {
                api.get('/allCardsByTag', {
                    params: {titleSearch: props.searchCondition}
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', props.searchCondition);
                    });
            }
        }
        */
    }

    const [cards, setCards] = useState([]);
    const [bookmarkedCardIDs, setBookmarkedCardIDs] = useState(new Set());
    const [bookmarksLoaded, setBookmarksLoaded] = useState(false);   // keeps track of bookmark fetch
    const [filterCondition, setFilterCondition] = useState(props.filterCondition);
    const [searchCondition, setSearchCondition] = useState(props.searchCondition);
    const [sortCondition, setSortCondition] = useState(props.sortCondition);

    // Tag filter state (managed here, passed to FilterDropdown)
    const [activeTagFilters, setActiveTagFilters] = useState([]);

    useEffect(() => {
        if (resolvedUsername) {
            localStorage.setItem("username", resolvedUsername);
            fetchBookmarks();
        } else {
            // 🔹 NOT LOGGED IN: treat bookmarks as "loaded" with an empty set
            setBookmarkedCardIDs(new Set());
            setBookmarksLoaded(true);
            setShowFavoritesOnly(false);
        }
    }, [resolvedUsername]);

    useEffect(() => {
        setCardSearchKeyword(props.searchCondition || '');
    }, [props.searchCondition]);

    useEffect(() => {
        setCardTypeFilter(props.CategoryCondition || '');
    }, [props.CategoryCondition]);

    useEffect(() => {
        setSortMode((props.sortCondition || '').split(',')[0] || '');
    }, [props.sortCondition]);

    // Reload card list when a new card is uploaded
    useEffect(() => {
        const handler = () => loadCardsByCriteria();
        window.addEventListener('atlas:card-uploaded', handler);
        return () => window.removeEventListener('atlas:card-uploaded', handler);
    }, []);

    useEffect(() => {
        loadCardsByCriteria();
        /*
        if (!didMountRef.current) {
            return;
        }

        if (props.filterCondition === '' && props.searchCondition === '' && props.CategoryCondition === '' && props.sortCondition === '') {
            console.log("running filter193" + props.filterCondition);
            showAll();

            api.get('/allCards')

                .then(response => {
                    console.log(response.data.data);
                    setCards(response.data.data);
                })
                .catch(error => {
                    console.error(error);
                });
        }
        else {
            console.log("running filter194" + props.filterCondition);
            if (props.filterCondition === '') {
                console.log("running category " + props.CategoryCondition);
                showAll();
                filterCategory(props.CategoryCondition)

                let params = {categoryString: props.CategoryCondition};
                if (props.sortCondition) {
                    params.sortString = props.sortCondition;
                }
                api.get('/allCardsByTag', {
                    params: params
                })
                    .then(response => {
                        setCards(response.data.data);
                        console.log("Incoming card data:", response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', error);
                    });
            } else if (props.CategoryCondition === '') {
                console.log("running filter 195" + props.filterCondition);
                showAll();
                filterTag(props.filterCondition);

                let params = {tagString: props.filterCondition};
                if (props.sortCondition) {
                    params.sortString = props.sortCondition;
                }

                api.get('/allCardsByTag', {
                    params: params
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', error);
                    });
            } else if (props.CategoryCondition !== '' && props.filterCondition !== '') {
                showAll();
                filterCategoryAndTag(props.CategoryCondition, props.filterCondition)

                let params = {categoryString: props.CategoryCondition,
                tagString: props.filterCondition};
                if (props.sortCondition) {
                    params.sortString = props.sortCondition;
                }

                api.get('/allCardsByTag', {
                    params: params
                })
                .then(response => {
                    setCards(response.data.data);
                })
                .catch(error => {
                    console.error('Error fetching cards by tag:', error);
                });
            } else if (props.sortCondition !== '') {
                showAll();
                api.get('/allCardsByTag', {
                    params: {sortString: props.sortCondition}
                })
                    .then(response => {
                        setCards(response.data.data);
                    })
                    .catch(error => {
                        console.error('Error fetching cards by tag:', props.sortCondition);
                    });
            }
        }
        */
    }, [props.filterCondition, props.CategoryCondition, props.sortCondition]);

    useEffect(() => {
        if (props.searchCondition != '') {
            console.log("running search" + props.searchCondition);


            api.get('/searchBar', {
                params: {
                    titleSearch: props.searchCondition
                }
            })
                .then(response => {
                    if (Array.isArray(response.data.data)) {
                        const cardData = response.data.data;
                        
                        // Deduplicate by cardID
                        const uniqueCards = cardData.filter((card, index, self) => 
                            index === self.findIndex(c => c.cardID === card.cardID)
                        );
                        // console.log('[Content2] Search results:', uniqueCards.length, 'unique cards from', cardData.length);
                        setCards(uniqueCards);
                        notifyCardsLoaded(uniqueCards.length);

                        const isNewSidebarSearchRequest =
                            props.searchTriggerSource === 'sidebar-mini' &&
                            props.sidebarSearchRequestId > lastHandledSidebarSearchRequestRef.current;

                        if (isNewSidebarSearchRequest) {
                            const firstCardWithCoords = uniqueCards.find(card => {
                                const latitude = Number(card.latitude);
                                const longitude = Number(card.longitude);
                                return Number.isFinite(latitude) && Number.isFinite(longitude);
                            });

                            if (firstCardWithCoords) {
                                handleCardClick(firstCardWithCoords);
                            }

                            lastHandledSidebarSearchRequestRef.current = props.sidebarSearchRequestId;
                        }
                    } else {
                        console.warn("No card data returned from searchBar:", response.data);
                        setCards([]);
                    }

                    props.setSearchTriggerSource?.('');
                })
                .catch(error => {
                    console.error(error);
                    props.setSearchTriggerSource?.('');
                });
        }
        else {
            console.log("Not running search" + props.searchCondition);
            loadCardsByCriteria();
            props.setSearchTriggerSource?.('');
        }
    }, [props.searchCondition, props.sidebarSearchRequestId, containerPanelSearchVersion]);

    const fetchBookmarks = async () => {
        console.log("Fetching bookmarks for:", resolvedUsername);

        if (!resolvedUsername) {
            console.warn("[fetchBookmarks] resolvedUsername is null or undefined, skipping API call.");
            return;
        }
        console.log("[fetchBookmarks] Sending GET /getBookmarkedCards request...");

        try {
            await new Promise(r => setTimeout(r, 50));

            const res = await api.get('/getBookmarkedCards', {
                params: { username: resolvedUsername }
            });

            console.log("[fetchBookmarks] Raw bookmarked data:", res.data.bookmarkedCards);

            const cardIDs = new Set(
                res.data.bookmarkedCards.map(card =>
                    card.cardID || card.cardid || card.CardID
                )
            );

            setBookmarkedCardIDs(new Set(cardIDs));
            setBookmarksLoaded(true);  //  mark loaded when done
        } catch (error) {
            console.error("[fetchBookmarks] Error fetching bookmarks:", error);
            setBookmarksLoaded(true);  // avoid infinite spinner on error
        }
    };

    // Fetch all cards when boundCondition changes
    const fetchAllCards = async () => {
        try {
            /*
            const response = await api.get('/allCards');
            console.table(response.data.data);
            const fixedResponse = fixBadLoadMap(response.data.data);
            setCards(fixedResponse);
            */
        } catch (error) {
            console.error('Error fetching all cards:', error);
        }
    };

    const fixBadLoadMap = (cards) => cards.map(fixBadLoad);

    const fixBadLoad = (cards) => {
        if (typeof cards.username === "number" && typeof cards.name === "number" && typeof cards.title === "number") {
            return {
                cardID: cards.username,
                latitude: cards.name,
                title: cards.email,
                longitude: cards.title,
                tags: cards.category,
                category: cards.cardID
            };
        }
        return cards;
    }

    useEffect(() => {
        // Keep search results stable while dragging map viewport.
        if (props.searchCondition) return;
        loadCardsByCriteria();
    }, [props.boundCondition, props.searchCondition]);

    const handleCardClick = (card) => {
        console.log('[Content2] Card clicked:', card);
        const latitude = Number(card.latitude);
        const longitude = Number(card.longitude);

        if (props.onCardClick && Number.isFinite(latitude) && Number.isFinite(longitude)) {
            console.log('[Content2] Calling onCardClick with:', {
                latitude,
                longitude
            });
            props.onCardClick({
                latitude,
                longitude
            });
        } else {
            console.warn('[Content2] Card missing lat/lng or onCardClick not provided:', card);
        }
    };

    // Viewport filter for cards based on current map bounds 
    // First deduplicate the cards array to prevent any duplicates
    const uniqueCards = cards.filter((card, index, self) => 
        index === self.findIndex(c => c.cardID === card.cardID)
    );
    
    const isViewportFilteringActive = showOnlyInView && !props.searchCondition;

    const cardsInView = uniqueCards.filter((card) => {
        // During active search or all-cards mode, do not clip by viewport.
        if (!isViewportFilteringActive) {
            return true;
        }

        // If we don't have bounds yet, show everything
        if (!props.boundCondition || !props.boundCondition.NE || !props.boundCondition.SW) {
            return true;
        }

        if (!card.latitude || !card.longitude) {
            return false;
        }

        const lat = Number(card.latitude);
        const lng = Number(card.longitude);

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return false;
        }

        return (
            lat <= props.boundCondition.NE.Lat &&
            lat >= props.boundCondition.SW.Lat &&
            lng <= props.boundCondition.NE.Lng &&
            lng >= props.boundCondition.SW.Lng
        );
    });

    const cardsInViewByType = cardsInView.filter((card) => {
        if (!props.CategoryCondition) return true;
        return card.category === props.CategoryCondition;
    });

    const scopeSubtitle = isViewportFilteringActive ? 'in view' : 'all cards';
    const scopeButtonLabel = isViewportFilteringActive ? 'In View' : 'All Cards';
    const scopeButtonTitle = isViewportFilteringActive
        ? 'Currently showing cards inside the map viewport. Click to show all cards.'
        : 'Currently showing all cards. Click to show only cards in the map viewport.';

    const cardsFilteredByTag = cardsInViewByType.filter((card) => {
        if (activeTagFilters.length === 0) return true;
        const cardTags = (card.tags || '').toLowerCase().split(',').map(t => t.trim());
        return activeTagFilters.every(f => cardTags.includes(f.toLowerCase()));
    });

    const displayedCards = cardsFilteredByTag.filter(
        card => !showFavoritesOnly || bookmarkedCardIDs.has(card.cardID)
    );

    const prioritizedDisplayedCards = (() => {
        const pinned = displayedCards.filter(card => pinnedCardIDs.has(card.cardID));
        const unpinned = displayedCards.filter(card => !pinnedCardIDs.has(card.cardID));

        let orderedUnpinned = unpinned;
        if (selectedCardIdFromMap && !props.isCollapsed) {
            const sel = unpinned.filter(card => String(card.cardID) === selectedCardIdFromMap);
            if (sel.length > 0) {
                orderedUnpinned = [...sel, ...unpinned.filter(card => String(card.cardID) !== selectedCardIdFromMap)];
            }
        }

        return [...pinned, ...orderedUnpinned];
    })();

    const firstVisibleCardID = prioritizedDisplayedCards.length > 0
        ? String(prioritizedDisplayedCards[0].cardID)
        : null;

    useEffect(() => {
        if (!props.isCollapsed && selectedCardIdFromMap && cardContainerRef.current) {
            cardContainerRef.current.scrollTop = 0;
        }
    }, [props.isCollapsed, selectedCardIdFromMap]);

    useEffect(() => {
        if (cardContainerRef.current) {
            cardContainerRef.current.scrollTop = 0;
        }
    }, [props.searchCondition]);

    useEffect(() => {
        const handleOpenLearnMoreFromMapPin = (event) => {
            const cardID = event?.detail?.cardID;
            if (cardID == null) return;

            setLearnMoreRequest({
                cardID: String(cardID),
                token: Date.now()
            });
        };

        window.addEventListener('atlas:open-card-learn-more', handleOpenLearnMoreFromMapPin);
        return () => {
            window.removeEventListener('atlas:open-card-learn-more', handleOpenLearnMoreFromMapPin);
        };
    }, []);

    useEffect(() => {
        if (!learnMoreRequest) return;

        // Keep force-open signal short-lived so it cannot be replayed on later rerenders.
        const timeoutId = window.setTimeout(() => {
            setLearnMoreRequest(null);
        }, 600);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [learnMoreRequest]);

    useEffect(() => {
        // Clicking/selecting a different map pin should never reuse an older learn-more signal.
        setLearnMoreRequest(null);
    }, [selectedCardIdFromMap]);

    // Log for debugging
    if (cards.length !== uniqueCards.length) {
        // console.warn('[Content2] Found duplicates in cards state!', cards.length, 'total,', uniqueCards.length, 'unique');
        // const duplicateCardIDs = cards.map(c => c.cardID).filter((id, index, self) => self.indexOf(id) !== index);
        // console.warn('[Content2] Duplicate CardIDs:', [...new Set(duplicateCardIDs)]);
    }
    // console.log('[Content2] cardsInView:', cardsInView.length, 'cards from', uniqueCards.length, 'unique cards (', cards.length, 'total)');

    return (
        <>
            {/* Sidebar collapse toggle */}
            <div id="right-sidebar">
                <div className={`collapse-toggle ${isOnLeft ? 'collapse-toggle--left' : ''}`} onClick={toggleCollapse}>
                    <FontAwesomeIcon icon={
                        isOnLeft
                            ? (props.isCollapsed ? faAngleDoubleRight : faAngleDoubleLeft)
                            : (props.isCollapsed ? faAngleDoubleLeft : faAngleDoubleRight)
                    } />
                </div>
            </div>

            <FormModal 
                username={resolvedUsername} 
                email={props.email} 
                isOpen={isModalOpen} 
                onRequestClose={closeModal}
                onPointLocationSelected={openModal}
                initialPolygonData={pendingPolygonData}
                initialImageOverlayData={pendingImageOverlayData}
                initialPointToolSignal={pendingPointToolSignal}
                onStartOnboarding={() => setIsOnboardingOpen(true)}
            />
    
            <section
                id="content-2"
                className={`${props.isCollapsed ? 'collapsed' : ''} ${isOnLeft ? 'content-2--left' : ''} ${bothOnLeft ? 'content-2--split-top' : ''}`}
                ref={containerRef}
                style={{ width: containerWidth }}
            >
                {/* Draggable edge handle */}
                <div
                    style={{
                        position: 'absolute',
                        [isOnLeft ? 'right' : 'left']: 0,
                        top: 0,
                        width: '6px',
                        height: '100%',
                        cursor: 'ew-resize',
                        zIndex: 1002,
                        background: 'transparent',
                    }}
                    onMouseDown={onMouseDown}
                />

                <div className="card-panel-top">
                    <div className="card-panel-titlebar" data-onboarding-target="card-titlebar">
                        <div className="card-panel-titlebar-text-group">
                            <span className="card-panel-titlebar-text">Cards</span>
                            <span className="card-panel-titlebar-subtitle">{cardsInViewByType.length} {scopeSubtitle}</span>
                        </div>
                        <div className="card-panel-titlebar-actions">
                            <button
                                className="card-panel-titlebar-btn"
                                title="Help"
                                data-onboarding-target="card-help-button"
                                onClick={() => window.open('/user-manual?section=card-container', '_blank')}
                            >
                                <FontAwesomeIcon icon={faQuestion} />
                            </button>
                            <button
                                className="card-panel-titlebar-btn card-panel-titlebar-btn--onboarding"
                                title="Start onboarding"
                                data-onboarding-target="card-onboarding-button"
                                onClick={() => setIsOnboardingOpen(true)}
                            >
                                <FontAwesomeIcon icon={faPlay} />
                            </button>
                            <button
                                className="card-panel-titlebar-btn"
                                title="Close panel"
                                onClick={() => props.setIsCollapsed?.(true)}
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </div>
                    </div>
                    <div className="card-panel-toolbar" data-onboarding-target="card-toolbar">
                            <button
                                type="button"
                                className="card-toolbar-button card-toolbar-button--icon"
                                title={props.isLoggedIn ? 'Add Card' : 'Log in to add a card'}
                                onClick={() => {
                                    if (!props.isLoggedIn) {
                                        setShowLoginPrompt(true);
                                        return;
                                    }
                                    openModal();
                                }}
                            >
                                <FontAwesomeIcon icon={faPlus} />
                            </button>

                            <button
                                type="button"
                                className={`card-toolbar-button card-toolbar-button--icon ${!markersVisible ? 'active' : ''}`}
                                title={markersVisible ? 'Hide Markers' : 'Show Markers'}
                                onClick={() => {
                                    const newVisible = !markersVisible;
                                    setMarkersVisible(newVisible);
                                    allMarkers.forEach(m => {
                                        const el = m.getElement();
                                        if (el) el.style.display = newVisible ? '' : 'none';
                                    });
                                }}
                            >
                                <FontAwesomeIcon icon={faMapMarkerAlt} />
                            </button>

                            <SortDropdown
                                value={sortMode}
                                onChange={handleSortModeChange}
                            />

                            <FilterDropdown
                                categoryValue={cardTypeFilter}
                                onCategoryChange={(newValue) => {
                                    setCardTypeFilter(newValue);
                                    props.setCategoryConditionCondition?.(newValue);
                                }}
                                activeTagFilters={activeTagFilters}
                                onTagFiltersChange={(newTags) => {
                                    setActiveTagFilters(newTags);
                                    props.setFilterCondition?.(newTags.join(','));
                                }}
                            />

                            <button
                                type="button"
                                className={`card-toolbar-button ${showFavoritesOnly ? 'active' : ''}`}
                                onClick={handleFavoritesToggle}
                                title={props.isLoggedIn ? 'Show only favorited cards' : 'Log in to use favorites filter'}
                            >
                                <FontAwesomeIcon icon={faHeart} />
                                <span>{showFavoritesOnly ? 'Favorites On' : 'Favorites'}</span>
                            </button>

                            <button
                                type="button"
                                className={`card-toolbar-button card-toolbar-button--scope ${isViewportFilteringActive ? 'in-view' : 'all-cards'}`}
                                onClick={toggleViewScope}
                                title={scopeButtonTitle}
                            >
                                {scopeButtonLabel}
                            </button>

                            <button
                                type="button"
                                className={`card-toolbar-button card-toolbar-button--icon ${isListView ? 'active' : ''}`}
                                disabled={bothOnLeft}
                                onClick={() => {
                                    const goingToList = !isListView;
                                    if (goingToList) {
                                        prevWidthBeforeList.current = containerWidth;
                                        const minW = Math.round(window.innerWidth * 0.25);
                                        setCardPanelWidth?.(minW);
                                    } else if (prevWidthBeforeList.current) {
                                        setCardPanelWidth?.(prevWidthBeforeList.current);
                                        prevWidthBeforeList.current = null;
                                    }
                                    setIsListView(goingToList);
                                    props.onCardViewModeChange?.(goingToList ? 'list' : 'grid');
                                }}
                                title={isListView ? 'Grid View' : 'List View'}
                            >
                                <FontAwesomeIcon icon={isListView ? faGrip : faList} />
                            </button>

                            <button
                                type="button"
                                className="card-toolbar-button card-toolbar-button--icon"
                                onClick={() => setCardPanelSide?.(isOnLeft ? 'right' : 'left')}
                                title={isOnLeft ? 'Move panel to right' : 'Move panel to left'}
                            >
                                <FontAwesomeIcon icon={faRightLeft} />
                            </button>
                    </div>

                    <div className="card-panel-searchbar" data-onboarding-target="card-searchbar">
                        <input
                            type="text"
                            value={cardSearchKeyword}
                            onChange={(e) => setCardSearchKeyword(e.target.value)}
                            placeholder="Search cards..."
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleCardSearch();
                                }
                            }}
                        />

                        <button
                            className="card-panel-searchbar-btn search"
                            title="Search"
                            onClick={handleCardSearch}
                        >
                            <FontAwesomeIcon icon={faSearch} />
                        </button>

                        <button
                            className="card-panel-searchbar-btn clear"
                            title="Clear Search"
                            onClick={handleCardSearchClear}
                        >
                            <FontAwesomeIcon icon={faTimes} />
                        </button>
                    </div>
                </div>


                {(!props.isLoggedIn || bookmarksLoaded) ? (
                    <div
                        className={`card-container ${isListView ? 'card-container--list' : ''}`}
                        data-onboarding-target="card-list-area"
                        ref={cardContainerRef}
                        style={{ display: props.isCollapsed ? 'none' : (isListView ? 'flex' : 'grid') }}
                    >
                        {(() => {
                            console.log('[Content2] Rendering cards:', prioritizedDisplayedCards.map(c => ({ cardID: c.cardID, title: c.title })));
                            return prioritizedDisplayedCards.map((card, index) => {
                                const cardKey = `card-${card.cardID}-${index}`;
                                const learnMoreSignal =
                                    learnMoreRequest && String(card.cardID) === learnMoreRequest.cardID
                                        ? learnMoreRequest.token
                                        : null;

                                if (isListView) {
                                    return (
                                        <div
                                            key={cardKey}
                                            className={`card-list-item${openMenuCardID === card.cardID ? ' menu-open' : ''}${pinnedCardIDs.has(card.cardID) ? ' pinned' : ''}`}
                                            data-onboarding-target={index === 0 ? 'onboarding-single-card' : undefined}
                                        >
                                            <span
                                                className="card-list-item-title"
                                                onClick={() => {
                                                    setLearnMoreRequest({ cardID: String(card.cardID), token: Date.now() });
                                                }}
                                                title={card.title}
                                            >
                                                {card.title}
                                            </span>
                                            <div
                                                className="card-list-item-actions"
                                                data-onboarding-target={index === 0 ? 'onboarding-single-card-actions' : undefined}
                                                ref={openMenuCardID === card.cardID ? menuRef : null}
                                            >
                                                <button
                                                    className="card-list-more-btn"
                                                    title="More options"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuCardID(prev => prev === card.cardID ? null : card.cardID);
                                                    }}
                                                >
                                                    <FontAwesomeIcon icon={faEllipsisV} />
                                                </button>
                                                {openMenuCardID === card.cardID && (
                                                    <div className="card-list-menu">
                                                        <button
                                                            className={`card-list-menu-item${pinnedCardIDs.has(card.cardID) ? ' active-pin' : ''}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!props.isLoggedIn) { setShowLoginPrompt(true); setOpenMenuCardID(null); return; }
                                                                togglePin(card.cardID);
                                                                setOpenMenuCardID(null);
                                                            }}
                                                        >
                                                            <FontAwesomeIcon icon={faThumbtack} />
                                                            <span>{pinnedCardIDs.has(card.cardID) ? 'Unpin' : 'Pin to top'}</span>
                                                        </button>
                                                        <button
                                                            className={`card-list-menu-item${bookmarkedCardIDs.has(card.cardID) ? ' active-fav' : ''}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!props.isLoggedIn) { setShowLoginPrompt(true); setOpenMenuCardID(null); return; }
                                                                const endpoint = bookmarkedCardIDs.has(card.cardID) ? '/unbookmarkCard' : '/bookmarkCard';
                                                                const fd = new FormData();
                                                                fd.append('username', resolvedUsername);
                                                                fd.append('cardID', card.cardID);
                                                                api.post(endpoint, fd).then(() => fetchBookmarks()).catch(err => console.error(err));
                                                                setOpenMenuCardID(null);
                                                            }}
                                                        >
                                                            <FontAwesomeIcon icon={faHeart} />
                                                            <span>{bookmarkedCardIDs.has(card.cardID) ? 'Unfavorite' : 'Favorite'}</span>
                                                        </button>
                                                        <button
                                                            className="card-list-menu-item"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleCardClick(card);
                                                                setOpenMenuCardID(null);
                                                            }}
                                                        >
                                                            <FontAwesomeIcon icon={faMapMarkerAlt} />
                                                            <span>Locate on map</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Hidden Card for learn-more modal */}
                                            <div style={{ display: 'none' }}>
                                                <Card
                                                    formData={{
                                                        ...card,
                                                        files: card.files || [],
                                                        viewerUsername: resolvedUsername,
                                                        cardID: card.cardID
                                                    }}
                                                    forceOpenLearnMoreSignal={learnMoreSignal}
                                                    isSelectedFromMap={false}
                                                    isFavorited={bookmarkedCardIDs.has(card.cardID)}
                                                    username={resolvedUsername}
                                                    fetchBookmarks={fetchBookmarks}
                                                    isLoggedIn={props.isLoggedIn}
                                                    onZoom={() => handleCardClick(card)}
                                                    onboardingTargetPrefix={index === 0 ? 'onboarding-single-card' : undefined}
                                                />
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={cardKey}
                                        className={`card-grid-wrapper${pinnedCardIDs.has(card.cardID) ? ' pinned' : ''}`}
                                        data-onboarding-target={index === 0 ? 'onboarding-single-card' : undefined}
                                        onClick={() => handleCardClick(card)}
                                        onContextMenu={(e) => e.preventDefault()}
                                    >
                                        <Card
                                            formData={{
                                                ...card,
                                                files: card.files || [],
                                                viewerUsername: resolvedUsername,
                                                cardID: card.cardID
                                            }}
                                            forceOpenLearnMoreSignal={learnMoreSignal}
                                            isSelectedFromMap={!!selectedCardIdFromMap && String(card.cardID) === selectedCardIdFromMap}
                                            isFavorited={bookmarkedCardIDs.has(card.cardID)}
                                            username={resolvedUsername}
                                            fetchBookmarks={fetchBookmarks}
                                            isLoggedIn={props.isLoggedIn}
                                            onZoom={() => handleCardClick(card)}
                                            onboardingTargetPrefix={index === 0 ? 'onboarding-single-card' : undefined}
                                        />
                                        <button
                                            className={`card-grid-pin-btn ${pinnedCardIDs.has(card.cardID) ? 'active' : ''}`}
                                            data-onboarding-target={index === 0 ? 'onboarding-single-card-actions' : undefined}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!props.isLoggedIn) { setShowLoginPrompt(true); return; }
                                                togglePin(card.cardID);
                                            }}
                                            title={pinnedCardIDs.has(card.cardID) ? 'Unpin card' : 'Pin to top'}
                                        >
                                            <FontAwesomeIcon icon={faThumbtack} />
                                        </button>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                ) : (
                    <p className="card-container-loading" data-onboarding-target="card-list-area">Loading Cards...</p>
                )}
            </section>

            <CardPanelOnboarding
                isOpen={isOnboardingOpen}
                onClose={() => setIsOnboardingOpen(false)}
                isPanelCollapsed={props.isCollapsed}
                firstCardId={firstVisibleCardID}
            />

            {/* Login Required Prompt */}
            {showLoginPrompt && ReactDOM.createPortal(
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
        </>
    );
}

export default Content2;
