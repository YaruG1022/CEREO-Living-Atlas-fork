// Shared marker-icon registry for multi-point cards.
// Used by both the CoordinatesPanel (icon picker) and Content1 (map rendering)
// so the stored icon key always maps to the same FontAwesome glyph.
import { icon as faIconToSvg } from '@fortawesome/fontawesome-svg-core';
import {
    faLocationDot,
    faCircle,
    faStar,
    faSquare,
    faFlag,
    faHeart,
    faBookmark,
    faThumbtack,
    faTriangleExclamation,
    faDroplet,
    faTree,
    faMountain,
    faFish,
    faHouse,
    faCamera,
    faAnchor,
    faLeaf,
    faWater,
} from '@fortawesome/free-solid-svg-icons';

// key -> FontAwesome icon definition. The key is what gets persisted to the backend.
export const MARKER_ICON_OPTIONS = [
    { key: 'location-dot', label: 'Pin', icon: faLocationDot },
    { key: 'circle', label: 'Circle', icon: faCircle },
    { key: 'star', label: 'Star', icon: faStar },
    { key: 'square', label: 'Square', icon: faSquare },
    { key: 'flag', label: 'Flag', icon: faFlag },
    { key: 'heart', label: 'Heart', icon: faHeart },
    { key: 'bookmark', label: 'Bookmark', icon: faBookmark },
    { key: 'thumbtack', label: 'Thumbtack', icon: faThumbtack },
    { key: 'triangle-exclamation', label: 'Warning', icon: faTriangleExclamation },
    { key: 'droplet', label: 'Droplet', icon: faDroplet },
    { key: 'tree', label: 'Tree', icon: faTree },
    { key: 'mountain', label: 'Mountain', icon: faMountain },
    { key: 'fish', label: 'Fish', icon: faFish },
    { key: 'house', label: 'House', icon: faHouse },
    { key: 'camera', label: 'Camera', icon: faCamera },
    { key: 'anchor', label: 'Anchor', icon: faAnchor },
    { key: 'leaf', label: 'Leaf', icon: faLeaf },
    { key: 'water', label: 'Water', icon: faWater },
];

export const DEFAULT_MARKER_ICON_KEY = 'location-dot';

const ICON_BY_KEY = MARKER_ICON_OPTIONS.reduce((map, opt) => {
    map[opt.key] = opt;
    return map;
}, {});

// Returns the FontAwesome icon definition for a stored key (falls back to default).
export function getMarkerIconDef(key) {
    return (ICON_BY_KEY[key] || ICON_BY_KEY[DEFAULT_MARKER_ICON_KEY]).icon;
}

// Default fill color for multi-point markers.
export const MARKER_ICON_COLOR = '#d9381e';

// Builds a DOM element rendering the given icon, for use as a mapboxgl.Marker element.
export function buildMarkerIconElement(key, color = MARKER_ICON_COLOR) {
    const el = document.createElement('div');
    el.className = 'multipoint-map-marker';
    const rendered = faIconToSvg(getMarkerIconDef(key));
    if (rendered && rendered.html && rendered.html[0]) {
        el.innerHTML = rendered.html[0];
    }
    el.style.color = color;
    return el;
}
