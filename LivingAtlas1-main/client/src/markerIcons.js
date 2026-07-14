// Shared marker-icon registry for multi-point cards.
// Used by both the CoordinatesPanel (icon picker) and Content1 (map rendering)
// so the stored icon key always maps to the same FontAwesome glyph or image.
import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
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
    faSeedling,
    faPaw,
    faBug,
    faDove,
    faFrog,
    faCow,
    faWheatAwn,
    faSun,
    faCloudRain,
    faSnowflake,
    faWind,
    faBolt,
    faFire,
    faSmog,
    faTemperatureHalf,
    faPersonHiking,
    faCampground,
    faBinoculars,
    faShip,
    faSailboat,
    faBridge,
    faRoad,
    faIndustry,
    faBuilding,
    faFlask,
    faVial,
    faFaucet,
    faRecycle,
    faGaugeHigh,
    faTowerObservation,
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
    { key: 'seedling', label: 'Seedling', icon: faSeedling },
    { key: 'paw', label: 'Wildlife', icon: faPaw },
    { key: 'bug', label: 'Insect', icon: faBug },
    { key: 'dove', label: 'Bird', icon: faDove },
    { key: 'frog', label: 'Frog', icon: faFrog },
    { key: 'cow', label: 'Livestock', icon: faCow },
    { key: 'wheat-awn', label: 'Agriculture', icon: faWheatAwn },
    { key: 'sun', label: 'Sun', icon: faSun },
    { key: 'cloud-rain', label: 'Rain', icon: faCloudRain },
    { key: 'snowflake', label: 'Snow', icon: faSnowflake },
    { key: 'wind', label: 'Wind', icon: faWind },
    { key: 'bolt', label: 'Lightning', icon: faBolt },
    { key: 'fire', label: 'Fire', icon: faFire },
    { key: 'smog', label: 'Smog', icon: faSmog },
    { key: 'temperature-half', label: 'Temperature', icon: faTemperatureHalf },
    { key: 'person-hiking', label: 'Hiking', icon: faPersonHiking },
    { key: 'campground', label: 'Campground', icon: faCampground },
    { key: 'binoculars', label: 'Observation', icon: faBinoculars },
    { key: 'ship', label: 'Ship', icon: faShip },
    { key: 'sailboat', label: 'Sailboat', icon: faSailboat },
    { key: 'bridge', label: 'Bridge', icon: faBridge },
    { key: 'road', label: 'Road', icon: faRoad },
    { key: 'industry', label: 'Industry', icon: faIndustry },
    { key: 'building', label: 'Building', icon: faBuilding },
    { key: 'flask', label: 'Lab Sample', icon: faFlask },
    { key: 'vial', label: 'Vial', icon: faVial },
    { key: 'faucet', label: 'Faucet', icon: faFaucet },
    { key: 'recycle', label: 'Recycle', icon: faRecycle },
    { key: 'gauge-high', label: 'Gauge', icon: faGaugeHigh },
    { key: 'tower-observation', label: 'Monitoring Tower', icon: faTowerObservation },
    // Image-based markers (colored pins) served from the public folder.
    { key: 'marker-blue', label: 'Blue Marker', image: '/blue_marker.png' },
    { key: 'marker-green', label: 'Green Marker', image: '/green_marker.png' },
    { key: 'marker-yellow', label: 'Yellow Marker', image: '/yellow_marker.png' },
];

export const DEFAULT_MARKER_ICON_KEY = 'location-dot';

const ICON_BY_KEY = MARKER_ICON_OPTIONS.reduce((map, opt) => {
    map[opt.key] = opt;
    return map;
}, {});

// Returns the full option object for a stored key (falls back to default).
export function getMarkerIconOption(key) {
    return ICON_BY_KEY[key] || ICON_BY_KEY[DEFAULT_MARKER_ICON_KEY];
}

// Returns the FontAwesome icon definition for a stored key (falls back to default).
export function getMarkerIconDef(key) {
    const opt = getMarkerIconOption(key);
    return opt.icon || ICON_BY_KEY[DEFAULT_MARKER_ICON_KEY].icon;
}

// Renders the glyph for a marker option in pickers — an <img> for image-based
// markers, or a FontAwesome icon otherwise.
export function MarkerIconGlyph({ optionKey }) {
    const opt = getMarkerIconOption(optionKey);
    if (opt.image) {
        return <img src={opt.image} alt="" className="marker-icon-glyph-img" />;
    }
    return <FontAwesomeIcon icon={opt.icon} />;
}

// Default fill color for multi-point markers. Matches the icon-menu glyph color
// so a marker looks the same in the picker and on the map.
export const MARKER_ICON_COLOR = '#333';

// Builds a DOM element rendering the given icon, for use as a mapboxgl.Marker element.
export function buildMarkerIconElement(key, color = MARKER_ICON_COLOR) {
    const opt = getMarkerIconOption(key);
    const el = document.createElement('div');
    el.className = 'multipoint-map-marker';
    if (opt.image) {
        el.classList.add('multipoint-map-marker--image');
        const img = document.createElement('img');
        img.src = opt.image;
        img.alt = '';
        el.appendChild(img);
        return el;
    }
    const rendered = faIconToSvg(opt.icon);
    if (rendered && rendered.html && rendered.html[0]) {
        el.innerHTML = rendered.html[0];
    }
    el.style.color = color;
    return el;
}
