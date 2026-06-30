import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import './Content1.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import updateMarkers from './PolygonFiltering.js';
import { showAll } from './Filter';
import api from './api.js';
import PolygonDrawingModal from './PolygonDrawingModal';
import html2canvas from 'html2canvas';
import { icon } from '@fortawesome/fontawesome-svg-core';
import { faEye, faEyeSlash, faCamera, faImage, faLocationDot, faPlus, faDrawPolygon } from '@fortawesome/free-solid-svg-icons';
import { buildMarkerIconElement } from './markerIcons';

// Mapbox Token
mapboxgl.accessToken =
  'pk.eyJ1IjoibGl2aW5nYXRsYXMiLCJhIjoiY2xwcDU4OHJyMHZwYTJpcGdvdDN3NWNneiJ9.86JTUg6ZUVm1PdqQ177WYQ';

const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: {
    polygon: true,
    trash: true
  }
});

let marker_clicked = false;
let stream_clicked = false;
let allMarkers = [];
let blueMarkers = [];
let greenMarkers = [];
let yellowMarkers = [];
let curLocationCoordinates = { lat: 0, lng: 0 };
let searchLocationCoordinates = { lat: 0, lng: 0 };

const createZoomAxisControl = (targetMap) => {
  let container = null;
  let scale = null;
  let pointer = null;
  let value = null;
  let isDragging = false;
  let handleScaleMouseDown = null;
  let handleScaleTouchStart = null;
  let handleWindowMouseMove = null;
  let handleWindowTouchMove = null;
  let handleWindowMouseUp = null;
  let handleWindowTouchEnd = null;

  const clampZoom = (z) => {
    const min = targetMap.getMinZoom();
    const max = targetMap.getMaxZoom();
    if (max <= min) return min;
    return Math.min(max, Math.max(min, z));
  };

  const SPINE_MARGIN_PX = 8;  // must match top/bottom on .atlas-z-axis__spine
  const AXIS_HEIGHT_PX = 140; // must match --axis-height CSS variable
  const zoomToTopPercent = (z) => {
    const min = targetMap.getMinZoom();
    const max = targetMap.getMaxZoom();
    if (max <= min) return 100;
    const clamped = clampZoom(z);
    const rawPercent = (max - clamped) / (max - min);
    const topPx = SPINE_MARGIN_PX + rawPercent * (AXIS_HEIGHT_PX - 2 * SPINE_MARGIN_PX);
    return (topPx / AXIS_HEIGHT_PX) * 100;
  };

  const buildTickValues = () => {
    const min = Math.floor(targetMap.getMinZoom());
    const max = Math.ceil(targetMap.getMaxZoom());
    const values = [];
    const step = Math.max(1, Math.round((max - min) / 5));

    for (let current = min; current <= max; current += step) {
      values.push(current);
    }

    if (values[values.length - 1] !== max) {
      values.push(max);
    }

    return values;
  };

  const updatePointer = () => {
    const currentZoom = targetMap.getZoom();
    if (pointer) {
      pointer.style.top = `${zoomToTopPercent(currentZoom)}%`;
    }
    if (value) {
      value.textContent = `z ${currentZoom.toFixed(1)}`;
    }
  };

  const getClientY = (event) => {
    if (event.touches && event.touches.length > 0) return event.touches[0].clientY;
    if (event.changedTouches && event.changedTouches.length > 0) return event.changedTouches[0].clientY;
    return event.clientY;
  };

  const updateZoomFromClientY = (clientY) => {
    if (!scale) return;
    const rect = scale.getBoundingClientRect();
    if (!rect.height) return;

    const min = targetMap.getMinZoom();
    const max = targetMap.getMaxZoom();
    if (max <= min) return;

    const clampedY = Math.min(rect.bottom - SPINE_MARGIN_PX, Math.max(rect.top + SPINE_MARGIN_PX, clientY));
    const relativeY = clampedY - rect.top - SPINE_MARGIN_PX;
    const usableHeight = rect.height - 2 * SPINE_MARGIN_PX;
    if (usableHeight <= 0) return;

    const ratio = relativeY / usableHeight;
    const targetZoom = clampZoom(max - ratio * (max - min));
    targetMap.setZoom(targetZoom);
    updatePointer();
  };

  const stopDragging = () => {
    isDragging = false;
    if (container) {
      container.classList.remove('atlas-z-axis-control--dragging');
    }
  };

  const startDragging = (event) => {
    isDragging = true;
    if (container) {
      container.classList.add('atlas-z-axis-control--dragging');
    }
    updateZoomFromClientY(getClientY(event));
  };

  return {
    onAdd: () => {
      container = document.createElement('div');
      container.className = 'mapboxgl-ctrl atlas-z-axis-control';
      container.setAttribute('data-onboarding-target', 'map-control-z-axis');

      scale = document.createElement('div');
      scale.className = 'atlas-z-axis__scale';

      const spine = document.createElement('div');
      spine.className = 'atlas-z-axis__spine';
      scale.appendChild(spine);

      pointer = document.createElement('div');
      pointer.className = 'atlas-z-axis__pointer';

      scale.appendChild(pointer);
      container.appendChild(scale);

      value = document.createElement('div');
      value.className = 'atlas-z-axis__value';
      container.appendChild(value);

      handleScaleMouseDown = (event) => {
        event.preventDefault();
        startDragging(event);
      };

      handleScaleTouchStart = (event) => {
        event.preventDefault();
        startDragging(event);
      };

      handleWindowMouseMove = (event) => {
        if (!isDragging) return;
        event.preventDefault();
        updateZoomFromClientY(event.clientY);
      };

      handleWindowTouchMove = (event) => {
        if (!isDragging) return;
        event.preventDefault();
        updateZoomFromClientY(getClientY(event));
      };

      handleWindowMouseUp = () => {
        if (!isDragging) return;
        stopDragging();
      };

      handleWindowTouchEnd = () => {
        if (!isDragging) return;
        stopDragging();
      };

      scale.addEventListener('mousedown', handleScaleMouseDown);
      scale.addEventListener('touchstart', handleScaleTouchStart, { passive: false });
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
      window.addEventListener('mouseup', handleWindowMouseUp);
      window.addEventListener('touchend', handleWindowTouchEnd);

      targetMap.on('zoom', updatePointer);
      targetMap.on('zoomend', updatePointer);
      updatePointer();

      return container;
    },
    onRemove: () => {
      targetMap.off('zoom', updatePointer);
      targetMap.off('zoomend', updatePointer);
      if (scale && handleScaleMouseDown) {
        scale.removeEventListener('mousedown', handleScaleMouseDown);
      }
      if (scale && handleScaleTouchStart) {
        scale.removeEventListener('touchstart', handleScaleTouchStart);
      }
      if (handleWindowMouseMove) {
        window.removeEventListener('mousemove', handleWindowMouseMove);
      }
      if (handleWindowTouchMove) {
        window.removeEventListener('touchmove', handleWindowTouchMove);
      }
      if (handleWindowMouseUp) {
        window.removeEventListener('mouseup', handleWindowMouseUp);
      }
      if (handleWindowTouchEnd) {
        window.removeEventListener('touchend', handleWindowTouchEnd);
      }
      stopDragging();
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
      container = null;
      scale = null;
      pointer = null;
      value = null;
      handleScaleMouseDown = null;
      handleScaleTouchStart = null;
      handleWindowMouseMove = null;
      handleWindowTouchMove = null;
      handleWindowMouseUp = null;
      handleWindowTouchEnd = null;
    },
    getDefaultPosition: () => 'top-left'
  };
};

// helper to convert mapbox bounds → your Home.js bounding format
const convertBounds = (b) => ({
  NE: { Lat: b._ne.lat, Lng: b._ne.lng },
  SW: { Lat: b._sw.lat, Lng: b._sw.lng }
});

const Content1 = (props) => {
  const atlasMapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerPopupRef = useRef(null);
  const openMarkerIdRef = useRef(null);
  const [creditPortalHost, setCreditPortalHost] = useState(null);
  const { setSearchCondition, onMarkerCardSelect } = props;
  const [lng, setLng] = useState(-120);
  const [lat, setLat] = useState(46);
  const [zoom, setZoom] = useState(5.5);
  const [mouseCoordinates, setMouseCoordinates] = useState({ lat: 0, lng: 0 });
  const [bounds, setBounds] = useState({});
  const [isPolygonToolDrawing, setIsPolygonToolDrawing] = useState(false);
  const [isImageToolDrawing, setIsImageToolDrawing] = useState(false);
  const markersVisibleRef = useRef(true);
  // Ref so that DOM-level click handlers (inside the map setup useEffect) can
  // read the latest login state without going stale in their closure.
  const isLoggedInRef = useRef(props.isLoggedIn);
  useEffect(() => { isLoggedInRef.current = props.isLoggedIn; }, [props.isLoggedIn]);

  const closeMarkerPopup = useCallback(() => {
    if (markerPopupRef.current) {
      markerPopupRef.current.remove();
      markerPopupRef.current = null;
    }
    openMarkerIdRef.current = null;
    marker_clicked = false;
    setSearchCondition("");
    onMarkerCardSelect?.(null);
  }, [setSearchCondition, onMarkerCardSelect]);

  const resolveImageUrl = useCallback((url) => {
    if (!url) return '/CEREO-logo.png';
    if (/^https?:\/\//i.test(url)) return url;

    const baseURL = (api.defaults.baseURL || '').replace(/\/$/, '');
    if (!baseURL) return url;
    return url.startsWith('/') ? `${baseURL}${url}` : `${baseURL}/${url}`;
  }, []);

  const arrayBufferToDataUrl = useCallback((arrayBuffer, contentType = 'image/png') => {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  }, []);

  const fetchImageDataUrlViaProxy = useCallback(async (rawUrl) => {
    const resolvedUrl = resolveImageUrl(rawUrl);
    if (!resolvedUrl) return null;

    const response = await api.get('/imageUrlProxy', {
      params: { url: resolvedUrl },
      responseType: 'arraybuffer'
    });

    const contentType = response.headers?.['content-type'] || 'image/png';
    return arrayBufferToDataUrl(response.data, contentType);
  }, [arrayBufferToDataUrl, resolveImageUrl]);

  const buildMarkerPopupContent = useCallback((feature) => {
    const root = document.createElement('div');
    root.className = 'card-pin-popup-panel';

    let imageOverlay = null;
    let removeOverlayKeyHandler = null;

    const cleanupImageOverlay = () => {
      if (removeOverlayKeyHandler) {
        document.removeEventListener('keydown', removeOverlayKeyHandler);
        removeOverlayKeyHandler = null;
      }

      if (imageOverlay) {
        imageOverlay.remove();
        imageOverlay = null;
      }
    };

    const mediaContainer = document.createElement('div');
    mediaContainer.className = 'card-pin-popup-media';

    const thumbnail = document.createElement('img');
    thumbnail.className = 'card-pin-popup-thumbnail';
    thumbnail.alt = 'Card Thumbnail';

    const thumbnailButton = document.createElement('button');
    thumbnailButton.type = 'button';
    thumbnailButton.className = 'card-pin-popup-thumbnail-button';
    thumbnailButton.setAttribute('aria-label', 'Open larger image preview');
    thumbnailButton.appendChild(thumbnail);

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'card-pin-popup-image-nav card-pin-popup-image-nav-prev';
    prevButton.setAttribute('aria-label', 'Previous image');
    prevButton.textContent = '❮';

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'card-pin-popup-image-nav card-pin-popup-image-nav-next';
    nextButton.setAttribute('aria-label', 'Next image');
    nextButton.textContent = '❯';

    const indicators = document.createElement('div');
    indicators.className = 'card-pin-popup-image-indicators';

    mediaContainer.appendChild(thumbnailButton);
    mediaContainer.appendChild(prevButton);
    mediaContainer.appendChild(nextButton);
    mediaContainer.appendChild(indicators);

    const initialImage = (feature.location_type !== 'image' && feature.thumbnail_link && String(feature.thumbnail_link).trim() !== '')
      ? resolveImageUrl(feature.thumbnail_link)
      : '/CEREO-logo.png';

    let popupImages = [{
      imageID: null,
      url: initialImage,
      alt: 'Card Thumbnail'
    }];
    let currentImageIndex = 0;

    const renderPopupImage = () => {
      const currentImage = popupImages[currentImageIndex] || popupImages[0];
      thumbnail.src = currentImage?.url || '/CEREO-logo.png';
      thumbnail.alt = currentImage?.alt || 'Card Thumbnail';
      thumbnail.onerror = function() { this.onerror = null; this.src = '/CEREO-logo.png'; };

      const hasMultipleImages = popupImages.length > 1;
      prevButton.style.display = hasMultipleImages ? 'inline-flex' : 'none';
      nextButton.style.display = hasMultipleImages ? 'inline-flex' : 'none';

      indicators.replaceChildren();
      if (!hasMultipleImages) {
        indicators.style.display = 'none';
        return;
      }

      indicators.style.display = 'flex';
      popupImages.forEach((_, index) => {
        const dot = document.createElement('span');
        dot.className = `card-pin-popup-image-dot ${index === currentImageIndex ? 'active' : ''}`;
        dot.setAttribute('aria-hidden', 'true');
        indicators.appendChild(dot);
      });
    };

    const setPopupImages = (images) => {
      if (!Array.isArray(images) || images.length === 0) return;

      popupImages = images.map((img, idx) => ({
        imageID: img?.imageID ?? img?.imageId ?? img?.id ?? null,
        url: resolveImageUrl(img?.url || img?.imageURL || img?.thumbnail_link || initialImage),
        alt: img?.alt || img?.altText || `Card image ${idx + 1}`
      }));

      currentImageIndex = Math.min(currentImageIndex, popupImages.length - 1);
      renderPopupImage();
    };

    const openLargeImagePreview = () => {
      cleanupImageOverlay();

      let overlayImageIndex = currentImageIndex;

      imageOverlay = document.createElement('div');
      imageOverlay.className = 'card-pin-popup-image-overlay';

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'card-pin-popup-image-close';
      closeButton.setAttribute('aria-label', 'Close image preview');
      closeButton.textContent = '×';

      const largeImage = document.createElement('img');
      largeImage.className = 'card-pin-popup-image-large';

      const prevNav = document.createElement('button');
      prevNav.type = 'button';
      prevNav.className = 'card-pin-popup-overlay-nav card-pin-popup-overlay-nav-prev';
      prevNav.setAttribute('aria-label', 'Previous image');
      prevNav.innerHTML = '&#8249;';

      const nextNav = document.createElement('button');
      nextNav.type = 'button';
      nextNav.className = 'card-pin-popup-overlay-nav card-pin-popup-overlay-nav-next';
      nextNav.setAttribute('aria-label', 'Next image');
      nextNav.innerHTML = '&#8250;';

      const barContainer = document.createElement('div');
      barContainer.className = 'card-pin-popup-overlay-bars';

      const renderOverlay = () => {
        const img = popupImages[overlayImageIndex] || popupImages[0];
        largeImage.src = img?.url || '/CEREO-logo.png';
        largeImage.alt = img?.alt || 'Card image';
        largeImage.onerror = function() { this.onerror = null; this.src = '/CEREO-logo.png'; };

        const hasMultiple = popupImages.length > 1;
        prevNav.style.display = hasMultiple ? 'flex' : 'none';
        nextNav.style.display = hasMultiple ? 'flex' : 'none';
        barContainer.style.display = hasMultiple ? 'flex' : 'none';

        barContainer.replaceChildren();
        if (hasMultiple) {
          popupImages.forEach((_, idx) => {
            const bar = document.createElement('button');
            bar.type = 'button';
            bar.className = `card-pin-popup-overlay-bar${idx === overlayImageIndex ? ' active' : ''}`;
            bar.setAttribute('aria-label', `Go to image ${idx + 1}`);
            bar.addEventListener('click', (e) => {
              e.stopPropagation();
              overlayImageIndex = idx;
              renderOverlay();
            });
            barContainer.appendChild(bar);
          });
        }
      };

      prevNav.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupImages.length <= 1) return;
        overlayImageIndex = overlayImageIndex === 0 ? popupImages.length - 1 : overlayImageIndex - 1;
        renderOverlay();
      });

      nextNav.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupImages.length <= 1) return;
        overlayImageIndex = overlayImageIndex === popupImages.length - 1 ? 0 : overlayImageIndex + 1;
        renderOverlay();
      });

      closeButton.addEventListener('click', cleanupImageOverlay);
      imageOverlay.addEventListener('click', (event) => {
        if (event.target === imageOverlay) {
          cleanupImageOverlay();
        }
      });

      removeOverlayKeyHandler = (event) => {
        if (event.key === 'Escape') {
          cleanupImageOverlay();
        }
      };
      document.addEventListener('keydown', removeOverlayKeyHandler);

      imageOverlay.appendChild(closeButton);
      imageOverlay.appendChild(prevNav);
      imageOverlay.appendChild(largeImage);
      imageOverlay.appendChild(nextNav);
      imageOverlay.appendChild(barContainer);
      renderOverlay();
      document.body.appendChild(imageOverlay);
    };

    const moveToPrevImage = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (popupImages.length <= 1) return;
      currentImageIndex = currentImageIndex === 0 ? popupImages.length - 1 : currentImageIndex - 1;
      renderPopupImage();
    };

    const moveToNextImage = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (popupImages.length <= 1) return;
      currentImageIndex = currentImageIndex === popupImages.length - 1 ? 0 : currentImageIndex + 1;
      renderPopupImage();
    };

    prevButton.addEventListener('click', moveToPrevImage);
    nextButton.addEventListener('click', moveToNextImage);
    thumbnailButton.addEventListener('click', openLargeImagePreview);
    renderPopupImage();

    const fetchPopupImages = async () => {
      const cardID = Number(feature.cardID);
      if (!Number.isInteger(cardID) || cardID <= 0) return;

      try {
        const response = await api.get(`/cardImages/${cardID}`);
        const images = response?.data?.images || [];
        if (images.length > 0) {
          setPopupImages(images);
        }
      } catch (error) {
        console.error('Failed to fetch popup card images:', error);
      }
    };

    fetchPopupImages();

    const infoPanel = document.createElement('div');
    infoPanel.className = 'card-pin-popup-info-panel';
    infoPanel.setAttribute('role', 'button');
    infoPanel.setAttribute('tabindex', '0');
    infoPanel.setAttribute('aria-label', 'Open full card details');

    const title = document.createElement('h3');
    title.className = 'card-pin-popup-title';
    title.textContent = feature.title || 'Untitled Card';

    const category = document.createElement('p');
    category.className = 'card-pin-popup-category';
    category.textContent = feature.category || 'Uncategorized';

    const tags = document.createElement('p');
    tags.className = 'card-pin-popup-tags';
    tags.textContent = `Tags: ${feature.tags ? String(feature.tags) : 'N/A'}`;

    const openLearnMore = () => {
      window.dispatchEvent(new CustomEvent('atlas:open-card-learn-more', {
        detail: { cardID: feature.cardID }
      }));
    };

    infoPanel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLearnMore();
    });

    infoPanel.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLearnMore();
      }
    });

    infoPanel.appendChild(title);
    infoPanel.appendChild(category);
    infoPanel.appendChild(tags);

    root.appendChild(mediaContainer);
    root.appendChild(infoPanel);
    root.cleanupImageOverlay = cleanupImageOverlay;
    return root;
  }, [resolveImageUrl]);

  const openMarkerPopup = useCallback((feature, lngLatOrMarker, mapInstance) => {
    closeMarkerPopup();
    openMarkerIdRef.current = feature.cardID;

    const lngLat = lngLatOrMarker && typeof lngLatOrMarker.getLngLat === 'function'
      ? lngLatOrMarker.getLngLat()
      : lngLatOrMarker;

    const popupContent = buildMarkerPopupContent(feature);

    const popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      anchor: 'bottom-left',
      offset: [12, -8],
      className: 'card-pin-rich-popup'
    })
      .setLngLat(lngLat)
      .setDOMContent(popupContent)
      .addTo(mapInstance);

    popup.on('close', () => {
      popupContent.cleanupImageOverlay?.();
      if (markerPopupRef.current === popup) {
        markerPopupRef.current = null;
        openMarkerIdRef.current = null;
      }
      marker_clicked = false;
      setSearchCondition("");
      onMarkerCardSelect?.(null);
    });

    markerPopupRef.current = popup;
    onMarkerCardSelect?.(feature.cardID);
  }, [buildMarkerPopupContent, closeMarkerPopup, setSearchCondition, onMarkerCardSelect]);

  // Move map when user clicks a card
  useEffect(() => {
    if (
      mapRef.current &&
      props.selectedCardCoords &&
      typeof props.selectedCardCoords.latitude === 'number' &&
      typeof props.selectedCardCoords.longitude === 'number'
    ) {
      mapRef.current.flyTo({
        center: [props.selectedCardCoords.longitude, props.selectedCardCoords.latitude],
        zoom: 13
      });
    }
  }, [props.selectedCardCoords]);



  // Resize map when container changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Trigger resize immediately and once more after layout/transition settles.
    mapRef.current.resize();

    const rafId = window.requestAnimationFrame(() => {
      if (mapRef.current) mapRef.current.resize();
    });

    const timeoutId = window.setTimeout(() => {
      if (mapRef.current) mapRef.current.resize();
    }, 220);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [
    props.isCollapsed,
    props.cardPanelWidth,
    props.isUploadPanelOpen,
    props.isCustomLayerPanelOpen,
    props.isSidebarOpen,
    props.isMapFullscreen,
    props.isChatbotSidebarOpen
  ]);

  // Keep map size in sync when the card panel finishes its open/close transition.
  useEffect(() => {
    const cardPanel = document.getElementById('content-2');
    if (!cardPanel) return;

    const handleTransitionEnd = (event) => {
      if (event.propertyName !== 'transform') return;
      if (mapRef.current) mapRef.current.resize();
    };

    cardPanel.addEventListener('transitionend', handleTransitionEnd);
    return () => {
      cardPanel.removeEventListener('transitionend', handleTransitionEnd);
    };
  }, []);

  // MAIN MAP INITIALIZATION
  useEffect(() => {
    let isActive = true;
    let markersFetchInFlight = false;
    let preventGenericClickClose = false;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [lng, lat],
      zoom: zoom,
      preserveDrawingBuffer: true
    });

    window.atlasMapInstance = map;
    mapRef.current = map;

    // INITIAL bounds sync
    let b = map.getBounds();
    setBounds(b);
    props.setboundCondition(convertBounds(b));

    // Update center + zoom UI
    map.on('move', () => {
      setLng(map.getCenter().lng.toFixed(4));
      setLat(map.getCenter().lat.toFixed(4));
      setZoom(map.getZoom().toFixed(2));
    });

    // Mapbox geocoder setup
    const coordinatesGeocoder = function (query) {
      const matches = query.match(/^[ ]*(?:Lat: )?(-?\d+\.?\d*)[, ]+(?:Lng: )?(-?\d+\.?\d*)[ ]*$/i);
      if (!matches) return null;

      const coord1 = Number(matches[1]);
      const coord2 = Number(matches[2]);

      function feature(lng, lat) {
        return {
          center: [lng, lat],
          geometry: { type: 'Point', coordinates: [lng, lat] },
          place_name: `Lat: ${lat} Lng: ${lng}`,
          place_type: ['coordinate'],
          properties: {},
          type: 'Feature'
        };
      }

      const geocodes = [];

      if (coord1 < -90 || coord1 > 90) geocodes.push(feature(coord1, coord2));
      if (coord2 < -90 || coord2 > 90) geocodes.push(feature(coord2, coord1));
      if (geocodes.length === 0) {
        geocodes.push(feature(coord1, coord2), feature(coord2, coord1));
      }
      return geocodes;
    };

    const searchBar = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      localGeocoder: coordinatesGeocoder,
      placeholder: 'Address or LAT, LONG',
      mapboxgl: mapboxgl,
      reverseGeocode: true,
      marker: { color: 'green' }
    });

    map.addControl(searchBar);

    const geocoderControl = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-geocoder');
    if (geocoderControl) {
      geocoderControl.setAttribute('data-onboarding-target', 'map-control-search');
    }

    searchBar.on('result', (e) => {
      const [lng, lat] = e.result.center;
      searchLocationCoordinates = { lat, lng };

      // update bounds after geocoder selects a result
      const b = map.getBounds();
      props.setboundCondition(convertBounds(b));
    });

    map.addControl(draw);

    // Inject visibility toggle button into the draw control group
    {
      const drawGroup = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-top-right .mapboxgl-ctrl-group');
      if (drawGroup) {
        drawGroup.classList.add('map-add-tools-group');

        let isAddToolsMenuOpen = false;

        const addToolsBtn = document.createElement('button');
        addToolsBtn.className = 'mapbox-gl-draw_ctrl-draw-btn map-add-tools-btn';
        addToolsBtn.setAttribute('data-onboarding-target', 'map-control-add-cards');
        addToolsBtn.title = 'Add card from map';
        addToolsBtn.type = 'button';
        addToolsBtn.innerHTML = icon(faPlus).html[0];

        const addToolsMenu = document.createElement('div');
        addToolsMenu.className = 'map-add-tools-menu';

        const pointOption = document.createElement('button');
        pointOption.type = 'button';
        pointOption.className = 'map-add-tools-menu-item';
        pointOption.setAttribute('data-onboarding-target', 'map-control-add-point');
        pointOption.innerHTML = `${icon(faLocationDot).html[0]}<span>Coordinate</span>`;

        const polygonOption = document.createElement('button');
        polygonOption.type = 'button';
        polygonOption.className = 'map-add-tools-menu-item';
        polygonOption.setAttribute('data-onboarding-target', 'map-control-add-polygon');
        polygonOption.innerHTML = `${icon(faDrawPolygon).html[0]}<span>Polygon</span>`;

        const imageOption = document.createElement('button');
        imageOption.type = 'button';
        imageOption.className = 'map-add-tools-menu-item';
        imageOption.setAttribute('data-onboarding-target', 'map-control-add-png');
        imageOption.innerHTML = `${icon(faImage).html[0]}<span>Image</span>`;

        addToolsMenu.appendChild(pointOption);
        addToolsMenu.appendChild(polygonOption);
        addToolsMenu.appendChild(imageOption);
        drawGroup.appendChild(addToolsMenu);

        const closeAddToolsMenu = () => {
          isAddToolsMenuOpen = false;
          addToolsMenu.classList.remove('open');
          addToolsBtn.classList.remove('active');
        };

        const toggleAddToolsMenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          isAddToolsMenuOpen = !isAddToolsMenuOpen;
          addToolsMenu.classList.toggle('open', isAddToolsMenuOpen);
          addToolsBtn.classList.toggle('active', isAddToolsMenuOpen);
        };

        addToolsBtn.addEventListener('click', toggleAddToolsMenu);

        pointOption.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeAddToolsMenu();
          window.dispatchEvent(new CustomEvent('map-point-tool-start'));
        });

        polygonOption.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeAddToolsMenu();
          setIsPolygonToolDrawing(true);
        });

        imageOption.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeAddToolsMenu();
          window.dispatchEvent(new CustomEvent('map-image-tool-start'));
        });

        addToolsMenu.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        const handleDocPointerDown = (e) => {
          if (!drawGroup.contains(e.target)) {
            closeAddToolsMenu();
          }
        };
        document.addEventListener('mousedown', handleDocPointerDown);

        drawGroup.insertBefore(addToolsBtn, drawGroup.firstChild);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'mapbox-gl-draw_ctrl-draw-btn marker-visibility-toggle active';
        toggleBtn.setAttribute('data-onboarding-target', 'map-control-visibility');
        toggleBtn.title = 'Toggle markers & polygons visibility';
        toggleBtn.type = 'button';
        toggleBtn.innerHTML = icon(faEye).html[0];
        toggleBtn.addEventListener('click', () => {
          const visible = !markersVisibleRef.current;
          markersVisibleRef.current = visible;
          toggleBtn.classList.toggle('active', visible);
          toggleBtn.innerHTML = visible ? icon(faEye).html[0] : icon(faEyeSlash).html[0];
          toggleBtn.title = visible ? 'Hide markers & polygons' : 'Show markers & polygons';

          // Toggle marker DOM elements
          allMarkers.forEach(m => {
            const el = m.getElement();
            if (el) el.style.display = visible ? '' : 'none';
          });

          // Toggle polygon layers
          const style = map.getStyle();
          if (style && style.layers) {
            style.layers.forEach(layer => {
              if (
                layer.id.startsWith('card-polygon-fill-') ||
                layer.id.startsWith('card-polygon-line-') ||
                layer.id.startsWith('card-image-layer-') ||
                layer.id.startsWith('card-image-outline-') ||
                layer.id.startsWith('card-image-hit-')
              ) {
                map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
              }
            });
          }
        });
        drawGroup.appendChild(toggleBtn);

        const resetViewBtn = document.createElement('button');
        resetViewBtn.className = 'mapbox-gl-draw_ctrl-draw-btn reset-view-btn';
        resetViewBtn.setAttribute('data-onboarding-target', 'map-control-reset-view');
        resetViewBtn.title = 'Reset Map View';
        resetViewBtn.type = 'button';
        resetViewBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="1.5" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="14.5" y2="8"/><circle cx="8" cy="8" r="2"/></svg>';
        resetViewBtn.addEventListener('click', () => {
          map.flyTo({ center: [-120, 46], zoom: 5.5 });
        });
        drawGroup.appendChild(resetViewBtn);

        const screenshotBtn = document.createElement('button');
        screenshotBtn.className = 'mapbox-gl-draw_ctrl-draw-btn screenshot-btn';
        screenshotBtn.setAttribute('data-onboarding-target', 'map-control-screenshot');
        screenshotBtn.title = 'Screenshot Map';
        screenshotBtn.type = 'button';
        screenshotBtn.innerHTML = icon(faCamera).html[0];
        screenshotBtn.addEventListener('click', () => {
          const container = map.getContainer();
          html2canvas(container, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            scale: window.devicePixelRatio || 1,
            ignoreElements: (el) => el.classList.contains('mapboxgl-ctrl-top-right') || el.classList.contains('mapboxgl-ctrl-top-left') || el.classList.contains('mapboxgl-ctrl-bottom-right') || el.classList.contains('mapboxgl-ctrl-bottom-left'),
          }).then((snapshotCanvas) => {
            snapshotCanvas.toBlob((blob) => {
              if (!blob) return;
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `map-screenshot-${Date.now()}.png`;
              a.click();
              URL.revokeObjectURL(url);
            }, 'image/png');
          });
        });
        drawGroup.appendChild(screenshotBtn);

        map.on('remove', () => {
          document.removeEventListener('mousedown', handleDocPointerDown);
        });
      }
    }

    map.on('draw.modechange', (e) => {
      if (e.mode === 'draw_polygon') {
        draw.changeMode('simple_select');
        setIsPolygonToolDrawing(true);
      }
    });

    // Close popup when clicking on map background (not on markers or polygons)
    map.on('click', () => {
      if (preventGenericClickClose) {
        preventGenericClickClose = false;
        return;
      }
      if (markerPopupRef.current) {
        closeMarkerPopup();
      }
    });

    map.on('draw.create', updateMarkers);
    map.on('draw.delete', showAll);
    map.on('draw.update', updateMarkers);

    map.addControl(new mapboxgl.FullscreenControl({ container: document.documentElement }), 'top-left');
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    const currentLocation = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    });

    map.addControl(currentLocation, 'top-left');
    map.addControl(createZoomAxisControl(map), 'top-left');

    const fullscreenButton = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-fullscreen');
    if (fullscreenButton) {
      fullscreenButton.setAttribute('data-onboarding-target', 'map-control-fullscreen');
    }

    const zoomInButton = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-zoom-in');
    const navigationGroup = zoomInButton?.closest('.mapboxgl-ctrl-group');
    if (navigationGroup) {
      navigationGroup.setAttribute('data-onboarding-target', 'map-control-navigation');
    }

    const geolocateButton = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-geolocate');
    if (geolocateButton) {
      geolocateButton.setAttribute('data-onboarding-target', 'map-control-geolocate');
    }

    const syncBottomRightMeta = () => {
      if (!atlasMapRef.current) return;

      const bottomRightControls = atlasMapRef.current.querySelector('.mapboxgl-ctrl-bottom-right');
      if (!bottomRightControls) return;
      const attributionCtrl = bottomRightControls.querySelector('.mapboxgl-ctrl-attrib');

      let metaHost = atlasMapRef.current.querySelector('.AtlasMap__bottom-right-meta');
      if (!metaHost) {
        metaHost = document.createElement('div');
        metaHost.className = 'AtlasMap__bottom-right-meta mapboxgl-ctrl';
      }

      if (attributionCtrl) {
        bottomRightControls.insertBefore(metaHost, attributionCtrl);
      } else if (metaHost.parentElement !== bottomRightControls) {
        bottomRightControls.appendChild(metaHost);
      }

      const mapboxLogo = atlasMapRef.current.querySelector('.mapboxgl-ctrl-bottom-left .mapboxgl-ctrl-logo');
      if (mapboxLogo && mapboxLogo.parentElement !== metaHost) {
        metaHost.insertBefore(mapboxLogo, metaHost.firstChild);
      }

      setCreditPortalHost(metaHost);
    };

    syncBottomRightMeta();
    const creditSyncRafId = window.requestAnimationFrame(syncBottomRightMeta);
    map.on('load', syncBottomRightMeta);

    currentLocation.on('geolocate', (e) => {
      curLocationCoordinates = { lat: e.coords.latitude, lng: e.coords.longitude };
    });

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const clearMarkers = () => {
      allMarkers.forEach(m => m.remove());
      allMarkers = [];
      blueMarkers = [];
      greenMarkers = [];
      yellowMarkers = [];
    };

    const renderMarkers = (markersData) => {
      clearMarkers();

      for (let feature of markersData) {
        if (!isActive) return;

        // Skip overlay cards — they are rendered by renderCardPolygons
        if (
          (feature.location_type === 'polygon' && feature.polygon_vertices && feature.polygon_vertices.length >= 3) ||
          (feature.location_type === 'image' && feature.polygon_vertices && feature.polygon_vertices.length >= 4)
        ) {
          continue;
        }

        // Multi-point cards: render one marker per stored point, each with its own icon
        if (feature.location_type === 'multipoint' && feature.polygon_vertices && feature.polygon_vertices.length > 0) {
          feature.polygon_vertices.forEach((pt) => {
            const lng = parseFloat(pt.lng);
            const lat = parseFloat(pt.lat);
            if (isNaN(lng) || isNaN(lat)) return;

            const pointEl = buildMarkerIconElement(pt.icon);
            const pointMarker = new mapboxgl.Marker({ element: pointEl, anchor: 'bottom' });
            pointMarker.setLngLat([lng, lat]);
            yellowMarkers.push([feature.category, feature.tags, [lng, lat]]);

            pointMarker.getElement().addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (markerPopupRef.current && openMarkerIdRef.current === feature.cardID) {
                closeMarkerPopup();
                return;
              }
              marker_clicked = true;
              setSearchCondition(feature.title);
              openMarkerPopup(feature, pointMarker, map);
            });

            pointMarker.addTo(map);
            allMarkers.push(pointMarker);
          });
          continue;
        }

        const el = document.createElement('div');
        const normalizedCategory = (feature.category || '').toString().trim().toLowerCase();

        if (normalizedCategory === 'river') {
          el.className = 'blue-marker';
          blueMarkers.push([feature.category, feature.tags, [feature.longitude, feature.latitude]]);
        } else if (normalizedCategory === 'watershed') {
          el.className = 'green-marker';
          greenMarkers.push([feature.category, feature.tags, [feature.longitude, feature.latitude]]);
        } else if (normalizedCategory === 'places' || normalizedCategory === 'place') {
          el.className = 'yellow-marker';
          yellowMarkers.push([feature.category, feature.tags, [feature.longitude, feature.latitude]]);
        } else if (normalizedCategory === 'other') {
          el.className = 'other-marker';
          yellowMarkers.push([feature.category, feature.tags, [feature.longitude, feature.latitude]]);
        } else if (normalizedCategory === '' || normalizedCategory === 'none' || normalizedCategory === 'uncategorized') {
          el.className = 'none-marker';
          yellowMarkers.push([feature.category, feature.tags, [feature.longitude, feature.latitude]]);
        } else {
          el.className = 'other-marker';
          yellowMarkers.push([feature.category, feature.tags, [feature.longitude, feature.latitude]]);
        }

        const marker = new mapboxgl.Marker(el);

        if (!isNaN(feature.longitude) && !isNaN(feature.latitude)) {
          marker.setLngLat([feature.longitude, feature.latitude]);
        } else {
          continue;
        }

        marker.getElement().addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (markerPopupRef.current && openMarkerIdRef.current === feature.cardID) {
            closeMarkerPopup();
            return;
          }
          marker_clicked = true;
          setSearchCondition(feature.title);
          openMarkerPopup(feature, marker, map);
        });

        marker.addTo(map);
        allMarkers.push(marker);
      }

      // Render polygons for cards with polygon_vertices
      renderCardPolygons(markersData, map);

      showAll();
    };

    const renderCardPolygons = (markersData, mapInstance) => {
      // Remove existing overlay layers/sources
      markersData.forEach(feature => {
        const sourceId = `card-polygon-${feature.cardID}`;
        const fillLayerId = `card-polygon-fill-${feature.cardID}`;
        const lineLayerId = `card-polygon-line-${feature.cardID}`;
        const imageSourceId = `card-image-${feature.cardID}`;
        const imageLayerId = `card-image-layer-${feature.cardID}`;
        const imageHitSourceId = `card-image-hit-source-${feature.cardID}`;
        const imageHitLayerId = `card-image-hit-${feature.cardID}`;
        const imageOutlineSourceId = `card-image-outline-source-${feature.cardID}`;
        const imageOutlineLayerId = `card-image-outline-${feature.cardID}`;
        if (mapInstance.getLayer(fillLayerId)) mapInstance.removeLayer(fillLayerId);
        if (mapInstance.getLayer(lineLayerId)) mapInstance.removeLayer(lineLayerId);
        if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
        if (mapInstance.getLayer(imageHitLayerId)) mapInstance.removeLayer(imageHitLayerId);
        if (mapInstance.getLayer(imageLayerId)) mapInstance.removeLayer(imageLayerId);
        if (mapInstance.getLayer(imageOutlineLayerId)) mapInstance.removeLayer(imageOutlineLayerId);
        if (mapInstance.getSource(imageHitSourceId)) mapInstance.removeSource(imageHitSourceId);
        if (mapInstance.getSource(imageSourceId)) mapInstance.removeSource(imageSourceId);
        if (mapInstance.getSource(imageOutlineSourceId)) mapInstance.removeSource(imageOutlineSourceId);
      });

      // Line style dash patterns (must match PolygonDrawingModal.js)
      const LINE_STYLE_DASH = {
        solid: [],
        dashed: [4, 3],
        dotted: [1, 2],
        dashdot: [4, 2, 1, 2]
      };

      for (let feature of markersData) {
        const vertices = feature.polygon_vertices;
        if (!vertices || !Array.isArray(vertices)) continue;

        if (feature.location_type === 'polygon' && vertices.length >= 3) {
          // Group vertices by ring index and preserve per-ring style when provided.
          const ringMap = new Map();
          for (const v of vertices) {
            const r = v.ring ?? 0;
            if (!ringMap.has(r)) {
              ringMap.set(r, {
                coords: [],
                style: {
                  fillColor: v.fillColor,
                  fillOpacity: v.fillOpacity,
                  lineStyle: v.lineStyle,
                }
              });
            }
            ringMap.get(r).coords.push([parseFloat(v.lng), parseFloat(v.lat)]);
          }
          const ringFeatures = [...ringMap.entries()]
            .sort(([a], [b]) => a - b)
            .map(([ringIndex, data]) => {
              const coords = [...data.coords, data.coords[0]];
              const style = data.style || {};
              return {
                type: 'Feature',
                properties: {
                  ring: ringIndex,
                  fillColor: style.fillColor || feature.polygon_fill_color || '#0077c0',
                  fillOpacity: style.fillOpacity ?? feature.polygon_fill_opacity ?? 0.2,
                  lineStyle: style.lineStyle || feature.polygon_line_style || 'solid',
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [coords],
                }
              };
            });

          const sourceId = `card-polygon-${feature.cardID}`;
          const fillLayerId = `card-polygon-fill-${feature.cardID}`;
          const lineLayerId = `card-polygon-line-${feature.cardID}`;
          const fillColor = feature.polygon_fill_color || '#0077c0';

          mapInstance.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: ringFeatures
            }
          });

          mapInstance.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': ['coalesce', ['get', 'fillColor'], fillColor],
              'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.2]
            }
          });

          mapInstance.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': ['coalesce', ['get', 'fillColor'], fillColor],
              'line-width': 2,
              'line-dasharray': [
                'match',
                ['coalesce', ['get', 'lineStyle'], 'solid'],
                'dashed', ['literal', LINE_STYLE_DASH.dashed],
                'dotted', ['literal', LINE_STYLE_DASH.dotted],
                'dashdot', ['literal', LINE_STYLE_DASH.dashdot],
                ['literal', LINE_STYLE_DASH.solid],
              ]
            }
          });

          mapInstance.on('click', fillLayerId, (e) => {
            e.originalEvent.stopPropagation();
            preventGenericClickClose = true;
            if (markerPopupRef.current && openMarkerIdRef.current === feature.cardID) {
              closeMarkerPopup();
              return;
            }
            marker_clicked = true;
            setSearchCondition(feature.title);
            openMarkerPopup(feature, e.lngLat, mapInstance);
          });

          mapInstance.on('mouseenter', fillLayerId, () => {
            mapInstance.getCanvas().style.cursor = 'pointer';
          });
          mapInstance.on('mouseleave', fillLayerId, () => {
            mapInstance.getCanvas().style.cursor = '';
          });
          continue;
        }

        if (feature.location_type !== 'image' || vertices.length < 4) continue;

        const imageCoords = vertices.slice(0, 4).map(v => [parseFloat(v.lng), parseFloat(v.lat)]);
        const hasValidImageCoords = imageCoords.length === 4 && imageCoords.every((coord) => (
          Array.isArray(coord)
          && Number.isFinite(coord[0])
          && Number.isFinite(coord[1])
        ));
        if (!hasValidImageCoords) continue;

        const imageSourceId = `card-image-${feature.cardID}`;
        const imageLayerId = `card-image-layer-${feature.cardID}`;
        const imageHitSourceId = `card-image-hit-source-${feature.cardID}`;
        const imageHitLayerId = `card-image-hit-${feature.cardID}`;
        const imageHitCoords = [...imageCoords, imageCoords[0]];

        mapInstance.addSource(imageHitSourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [imageHitCoords] }
          }
        });

        mapInstance.addLayer({
          id: imageHitLayerId,
          type: 'fill',
          source: imageHitSourceId,
          paint: {
            'fill-color': '#000000',
            'fill-opacity': 0
          }
        });

        mapInstance.on('click', imageHitLayerId, (e) => {
          e.originalEvent.stopPropagation();
          preventGenericClickClose = true;
          if (markerPopupRef.current && openMarkerIdRef.current === feature.cardID) {
            closeMarkerPopup();
            return;
          }
          marker_clicked = true;
          setSearchCondition(feature.title);
          openMarkerPopup(feature, e.lngLat, mapInstance);
        });

        mapInstance.on('mouseenter', imageHitLayerId, () => {
          mapInstance.getCanvas().style.cursor = 'pointer';
        });
        mapInstance.on('mouseleave', imageHitLayerId, () => {
          mapInstance.getCanvas().style.cursor = '';
        });

        (async () => {
          try {
            const imageDataUrl = await fetchImageDataUrlViaProxy(feature.thumbnail_link);
            if (!imageDataUrl || !window.atlasMapInstance || !mapInstance.getStyle()) return;
            if (!mapInstance.getSource(imageSourceId)) {
              mapInstance.addSource(imageSourceId, {
                type: 'image',
                url: imageDataUrl,
                coordinates: imageCoords
              });
            }
            if (!mapInstance.getLayer(imageLayerId)) {
              mapInstance.addLayer({
                id: imageLayerId,
                type: 'raster',
                source: imageSourceId,
                paint: {
                  'raster-opacity': 1
                }
              });
            }
          } catch (error) {
            console.warn('Skipping image overlay raster due to proxy/image load failure:', feature.cardID, error?.message || error);
          }
        })();
      }
    };

    const fetchMarkersWithRetry = async (reason = 'initial-load') => {
      if (markersFetchInFlight) return;
      markersFetchInFlight = true;

      const maxAttempts = 4;
      const baseDelayMs = 1200;
      const timeoutMs = 90000;

      try {
        for (let attempt = 1; attempt <= maxAttempts && isActive; attempt++) {
          try {
            const response = await api.get('/getMarkers', { timeout: timeoutMs });
            if (!isActive) return;

            const data = response.data;
            const markersData = Array.isArray(data) ? data : data.data || [];
            renderMarkers(markersData);

            if (attempt > 1) {
              console.log(`[Content1] Marker fetch recovered after retry ${attempt}/${maxAttempts} (${reason}).`);
            }
            return;
          } catch (error) {
            const status = error?.response?.status || 'NO_RESPONSE';
            console.warn(`[Content1] /getMarkers failed on attempt ${attempt}/${maxAttempts} (${reason}), status=${status}`);

            if (attempt < maxAttempts) {
              const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
              await wait(delayMs);
            } else {
              console.error('Error fetching markers after retries:', error);
            }
          }
        }
      } finally {
        markersFetchInFlight = false;
      }
    };

    const handleCardsLoaded = () => {
      if (!isActive) return;
      if (allMarkers.length > 0) return;
      fetchMarkersWithRetry('cards-loaded-event');
    };

    const handleCardUploaded = () => {
      if (!isActive) return;
      // Force re-fetch so new card (including polygons) appears immediately
      markersFetchInFlight = false;
      fetchMarkersWithRetry('card-uploaded');
    };

    clearMarkers();
    window.addEventListener('atlas:cards-loaded', handleCardsLoaded);
    window.addEventListener('atlas:card-uploaded', handleCardUploaded);

    // Wait for map style/container readiness before mounting marker DOM nodes.
    if (map.loaded()) {
      fetchMarkersWithRetry('map-ready');
    } else {
      map.once('load', () => {
        fetchMarkersWithRetry('map-load');
      });
    }

    // BOUNDS SYNC — zoomend
    map.on('zoomend', () => {
      let b = map.getBounds();
      setBounds(b);
      props.setboundCondition(convertBounds(b));
    });

    // BOUNDS SYNC — dragend
    map.on('dragend', () => {
      let b = map.getBounds();
      setBounds(b);
      props.setboundCondition(convertBounds(b));
    });

    // BOUNDS SYNC — moveend (critical for viewport filtering)
    map.on('moveend', () => {
      let b = map.getBounds();
      props.setboundCondition(convertBounds(b));
    });

    // Track mouse coordinate display
    map.on('mousemove', (e) => {
      setMouseCoordinates({
        lat: e.lngLat.lat.toFixed(4),
        lng: e.lngLat.lng.toFixed(4)
      });
    });

    // Tileset layering (unchanged)
    map.on('load', function () {
      map.addLayer({
        id: 'vector-tileset',
        type: 'fill',
        source: {
          type: 'vector',
          url: 'mapbox://livingatlas.71vcn3c7',
        },
        'source-layer': 'NHD_streams-6qjkxa',
        layout: {
          'visibility': 'none',
        },
        paint: {
          'fill-color': 'blue',
          'fill-opacity': 0.5,
        },
      });

      map.addLayer({
        id: 'urban-areas-fill',
        type: 'fill',
        source: {
          type: 'vector',
          url: 'mapbox://livingatlas.78fvgfpd',
        },
        'source-layer': 'Washington_State_City_Urban_G-0e7hes',
        layout: {
          'visibility': 'none',
        },
        paint: {
          'fill-color': 'red',
          'fill-opacity': 0.4,
        },
      });

      map.addLayer({
        id: 'urban-areas-outline',
        type: 'line',
        source: {
          type: 'vector',
          url: 'mapbox://phearakboth.6pnz5bgy',
        },
        'source-layer': 'Washington_State_City_Urban_G-48j9h8',
        layout: {
          'visibility': 'none',
        },
        paint: {
          'line-color': 'white',
          'line-width': 1,
        },
      });

      // Click popup for Hydrological Boundaries (vector-tileset)
      map.on('click', 'vector-tileset', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['vector-tileset'] });
        if (!features.length) return;
        const feature = features[0];
        new mapboxgl.Popup({ offset: 30 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<ul><strong>GNIS Name: </strong>${feature.properties.GNIS_Name || 'N/A'}</ul>` +
            `<ul><strong>Object ID: </strong>${feature.properties.OBJECTID || 'N/A'}</ul>` +
            `<ul><strong>Length in KM: </strong>${feature.properties.LengthKM || 'N/A'}</ul>` +
            `<ul><strong>GNIS ID: </strong>${feature.properties.GNIS_ID || 'N/A'}</ul>`
          )
          .addTo(map);
      });
      map.on('mouseenter', 'vector-tileset', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'vector-tileset', () => { map.getCanvas().style.cursor = ''; });

      // Click popup for City Limits (urban-areas-fill)
      map.on('click', 'urban-areas-fill', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['urban-areas-fill'] });
        if (!features.length) return;
        const feature = features[0];
        new mapboxgl.Popup({ offset: 30 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<h3><strong>${feature.properties.CITY_NM || 'N/A'}</strong></h3>` +
            `<ul><strong>OBJECTID:</strong> ${feature.properties.OBJECTID || 'N/A'}</ul>` +
            `<ul><strong>UGA_NM:</strong> ${feature.properties.UGA_NM || 'N/A'}</ul>` +
            `<ul><strong>COUNTY_NM:</strong> ${feature.properties.COUNTY_NM || 'N/A'}</ul>` +
            `<ul><strong>GMA:</strong> ${feature.properties.GMA || 'N/A'}</ul>` +
            `<ul><strong>INCORP:</strong> ${feature.properties.INCORP || 'N/A'}</ul>`
          )
          .addTo(map);
      });
      map.on('mouseenter', 'urban-areas-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'urban-areas-fill', () => { map.getCanvas().style.cursor = ''; });
    });

    return () => {
      isActive = false;
      window.removeEventListener('atlas:cards-loaded', handleCardsLoaded);
      window.removeEventListener('atlas:card-uploaded', handleCardUploaded);
      window.cancelAnimationFrame(creditSyncRafId);
      map.off('load', syncBottomRightMeta);
      closeMarkerPopup();

      // Clean up map instance on unmount.
      // Keep this lifecycle tied to mount/unmount rather than auth state to avoid
      // auth-transition races that can leave markers missing until a hard refresh.
      map.remove();
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      // Directly open the modal without requiring a file first
      setIsImageToolDrawing(true);
    };
    window.addEventListener('map-image-tool-start', handler);
    return () => window.removeEventListener('map-image-tool-start', handler);
  }, []);

  // Compute styles for outer map container to respond to card panel state
  const leftSidebarWidth = props.isSidebarOpen
    ? 'var(--app-left-sidebar-expanded-width)'
    : 'var(--app-left-sidebar-collapsed-width)';
  const hasLeftPanel = props.isUploadPanelOpen || props.isCustomLayerPanelOpen || props.isBasemapOpen || props.isChatbotSidebarOpen;
  const cardPanelW = props.isCollapsed ? 0 : (Number(props.cardPanelWidth) || 300);
  const cardOnLeft = props.cardPanelSide === 'left';
  const bothOnLeft = cardOnLeft && !props.isCollapsed && hasLeftPanel;
  // When both card panel and upload panel are on left, they stack vertically in same column
  const cardLeftExtra = (cardOnLeft && !bothOnLeft) ? cardPanelW : 0;
  const mapContainerLeft = props.isMapFullscreen
    ? 0
    : hasLeftPanel
    ? `calc(${leftSidebarWidth} + ${cardLeftExtra}px + var(--app-secondary-panel-width))`
    : `calc(${leftSidebarWidth} + ${cardLeftExtra}px)`;
  const mapContainerRight = props.isMapFullscreen ? 0 : (cardOnLeft ? 0 : cardPanelW);

  return (
    <div 
      className="AtlasMap" 
      ref={atlasMapRef}
      style={{
        left: mapContainerLeft,
        right: `${mapContainerRight}px`
      }}
    >
      <div className="AtlasMap__container" ref={mapContainerRef}>
        <div className="AtlasMap__info-bottomleft">
          <div>
            Map Center - Lat: {lat} | Long: {lng} | Zoom: {zoom}
          </div>
          <div>
            Mouse Coordinates - Lat: {mouseCoordinates.lat} | Long: {mouseCoordinates.lng}
          </div>
        </div>
      </div>

      {creditPortalHost && createPortal(
        <div className="AtlasMap__credit">
          <span>Map icons by </span>
          <a href="https://icons8.com/icon/" title="marker icons" target="_blank" rel="noopener noreferrer">icons8.</a>
        </div>,
        creditPortalHost
      )}

      {isPolygonToolDrawing && (
        <PolygonDrawingModal
          mode="polygon"
          onSave={(allRings, centroid, style, ringStyles = []) => {
            setIsPolygonToolDrawing(false);
            // Flatten array-of-rings into a flat array with `ring` index property
            const flatVerts = allRings.flatMap((ring, ringIdx) => {
              const rs = ringStyles[ringIdx] || {};
              return ring.map(v => ({
                ...v,
                ring: ringIdx,
                fillColor: rs.fillColor,
                fillOpacity: rs.fillOpacity,
                lineStyle: rs.lineStyle,
              }));
            });
            window.dispatchEvent(new CustomEvent('polygon-tool-save', {
              detail: {
                vertices: flatVerts,
                centroid,
                fillColor: style?.fillColor,
                fillOpacity: style?.fillOpacity,
                lineStyle: style?.lineStyle
              }
            }));
          }}
          onCancel={() => setIsPolygonToolDrawing(false)}
        />
      )}

      {isImageToolDrawing && (
        <PolygonDrawingModal
          mode="image"
          title="Place Image"
          onSave={(vertices, centroid, style, imageSlots) => {
            setIsImageToolDrawing(false);
            const firstSlot = imageSlots?.[0];
            window.dispatchEvent(new CustomEvent('map-image-tool-save', {
              detail: {
                vertices: firstSlot?.vertices || vertices || [],
                centroid,
                imageFile: firstSlot?.file || null,
                previewUrl: firstSlot?.url || '',
                imageSlots: imageSlots || [],
                style: style || {},
              }
            }));
          }}
          onCancel={() => {
            setIsImageToolDrawing(false);
            window.dispatchEvent(new CustomEvent('map-image-tool-cancel'));
          }}
        />
      )}
    </div>
  );
};

export { allMarkers, draw, blueMarkers, greenMarkers, yellowMarkers, curLocationCoordinates, searchLocationCoordinates };
export default Content1;