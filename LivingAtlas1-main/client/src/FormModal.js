import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import Modal from 'react-modal';
import mapboxgl from 'mapbox-gl';
import './FormModal.css';
import api from './api.js';
import PolygonDrawingModal from './PolygonDrawingModal';
import ArcGISPickerModal from './ArcGISPickerModal';
import CreateCardModalOnboarding from './OnboardingCreateCardModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faQuestion, faPlay } from '@fortawesome/free-solid-svg-icons';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function serializeLinks(links) {
    const filtered = links.filter(l => l.url.trim() !== '');
    if (filtered.length === 0) return '';
    return JSON.stringify(filtered);
}

const FormModal = (props) => {
    const [modalIsOpen, setModalIsOpen] = useState(false);
    const [isSelectingLocation, setIsSelectingLocation] = useState(false);
    const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
    const [isPlacingImageOverlay, setIsPlacingImageOverlay] = useState(false);
    const [isCreateCardOnboardingOpen, setIsCreateCardOnboardingOpen] = useState(false);
    const [locationType, setLocationType] = useState('point'); // 'point' | 'polygon' | 'image'
    const [polygonVertices, setPolygonVertices] = useState([]);
    const [polygonFillColor, setPolygonFillColor] = useState('#0077c0');
    const [polygonLineStyle, setPolygonLineStyle] = useState('solid');
    const isModalOpen = modalIsOpen || props.isOpen;
    const selectLocationMarker = useRef(null);
    const lastPointToolSignalRef = useRef(null);
    const shouldCloseOnPointCancelRef = useRef(false);

    // Apply initial polygon data from Polygon Tool flow
    useEffect(() => {
        if (props.initialPolygonData) {
            const { vertices, centroid, fillColor, lineStyle } = props.initialPolygonData;
            setLocationType('polygon');
            setPolygonVertices(vertices);
            if (fillColor) setPolygonFillColor(fillColor);
            if (lineStyle) setPolygonLineStyle(lineStyle);
            setFormData(prev => ({
                ...prev,
                latitude: centroid.lat.toFixed(6),
                longitude: centroid.lng.toFixed(6),
            }));
        }
    }, [props.initialPolygonData]);

    useEffect(() => {
        if (props.initialImageOverlayData) {
            const { vertices, centroid, imageFile, previewUrl, imageSlots, style } = props.initialImageOverlayData;
            setLocationType('image');
            setPolygonVertices(vertices || []);
            setOverlayImageFile(imageFile || null);
            setOverlayImagePreview(previewUrl || '');
            setIsPlacingImageOverlay(false);
            setOverlayImageSlots(imageSlots || []);
            if (style?.imageOpacity !== undefined) setOverlayImageOpacity(style.imageOpacity);
            setFormData(prev => ({
                ...prev,
                latitude: centroid?.lat?.toFixed(6) || prev.latitude,
                longitude: centroid?.lng?.toFixed(6) || prev.longitude,
            }));
        }
    }, [props.initialImageOverlayData]);

    useEffect(() => {
        const handleImageToolCancel = () => {
            setIsPlacingImageOverlay(false);
        };

        window.addEventListener('map-image-tool-cancel', handleImageToolCancel);
        return () => window.removeEventListener('map-image-tool-cancel', handleImageToolCancel);
    }, []);

    const handleCloseModal = () => {
        setModalIsOpen(false);
        setIsDrawingPolygon(false);
        setIsPlacingImageOverlay(false);
        setIsCreateCardOnboardingOpen(false);
        if (selectLocationMarker.current) {
            selectLocationMarker.current.remove();
            selectLocationMarker.current = null;
        }
        if (props.onRequestClose) {
            props.onRequestClose();
        }
    };

    const handleOpenCreateCardHelp = () => {
        window.open('/user-manual?section=add-card', '_blank');
    };

    const handleStartCreateCardOnboarding = () => {
        setIsCreateCardOnboardingOpen(true);
    };

    const isCreateCardModalVisible = isModalOpen && !isSelectingLocation && !isDrawingPolygon && !isPlacingImageOverlay;

    useEffect(() => {
        if (!isCreateCardModalVisible && isCreateCardOnboardingOpen) {
            setIsCreateCardOnboardingOpen(false);
        }
    }, [isCreateCardModalVisible, isCreateCardOnboardingOpen]);

    const [formData, setFormData] = useState({
        username: props.username || '',   // required account login
        name: '',                         // display name
        email: props.email || '',
        title: '',
        category: '',
        description: '',
        funding: '',
        org: '',
        link: '',
        tags: '',
        latitude: '',
        longitude: '',
        is_public: true,                  // visibility: public by default
    });

    const [links, setLinks] = useState([{ url: '', text: '' }]);

    const [selectedFiles, setSelectedFiles] = useState([]);   // <-- multiple files
    const [imageFiles, setImageFiles] = useState([]);         // multi-image upload
    const [imagePreviews, setImagePreviews] = useState([]);
    const [overlayImageFile, setOverlayImageFile] = useState(null);
    const [overlayImagePreview, setOverlayImagePreview] = useState('');
    const [overlayImageSlots, setOverlayImageSlots] = useState([]);
    const [overlayImageOpacity, setOverlayImageOpacity] = useState(0.85);
    const [pendingArcgisItems, setPendingArcgisItems] = useState([]);
    const [isArcgisPickerOpen, setIsArcgisPickerOpen] = useState(false);
    const imageInputRef = useRef(null);
    const fileInputRef = useRef(null);

    const handleInputChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleFileInput = (e) => {
        const files = Array.from(e.target.files);
        const validFiles = [];

        for (let file of files) {
            if (file.size > MAX_FILE_SIZE) {
                alert(`File "${file.name}" exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB`);
                continue;
            }
            validFiles.push(file);
        }
        setSelectedFiles(prev => [...prev, ...validFiles]);
        e.target.value = '';
    };

    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleImageInput = (e) => {
        const files = Array.from(e.target.files);
        const validImages = [];
        const validTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];

        for (let file of files) {
            if (!validTypes.includes(file.type)) {
                alert(`"${file.name}" is not a supported image format. Use PNG, JPG, GIF, or WebP.`);
                continue;
            }
            if (file.size > MAX_FILE_SIZE) {
                alert(`Image "${file.name}" exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB`);
                continue;
            }
            validImages.push(file);
        }

        const newPreviews = validImages.map(f => URL.createObjectURL(f));
        setImageFiles(prev => [...prev, ...validImages]);
        setImagePreviews(prev => [...prev, ...newPreviews]);
        e.target.value = '';
    };

    const removeImage = (index) => {
        setImageFiles(prev => prev.filter((_, i) => i !== index));
        setImagePreviews(prev => {
            URL.revokeObjectURL(prev[index]);
            return prev.filter((_, i) => i !== index);
        });
    };

    const validateForm = () => {
        const errors = [];
        if (!formData.username.trim()) errors.push("Username is required.");
        if (!formData.name.trim()) errors.push("Name is required.");
        if (!formData.title.trim() || formData.title.length > 255) errors.push("Title is required and must be <256 chars.");
        if (locationType === 'polygon') {
            if (polygonVertices.length < 3) errors.push("Polygon must have at least 3 points.");
        } else if (locationType === 'image') {
            const placedSlots = overlayImageSlots.filter(s => s.vertices && s.vertices.length >= 4);
            if (placedSlots.length === 0 && polygonVertices.length < 4) errors.push("Image overlay must have at least one placed image.");
            if (!overlayImageFile && !overlayImagePreview && placedSlots.length === 0) errors.push("At least one image is required for the map overlay.");
        } else {
            if (!/^(-?\d+(\.\d{1,8})?)$/.test(formData.latitude)) errors.push("Latitude format is invalid.");
            if (!/^(-?\d+(\.\d{1,8})?)$/.test(formData.longitude)) errors.push("Longitude format is invalid.");
        }
        if (formData.description && formData.description.length > 2000) errors.push("Description must be <2001 chars.");
        if (formData.org && formData.org.length > 255) errors.push("Org must be <256 chars.");
        if (formData.funding && formData.funding.length > 255) errors.push("Funding must be <256 chars.");
        const serializedLink = serializeLinks(links);
        if (serializedLink.length > 2000) errors.push("Links text is too long.");
        return errors;
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        const formErrors = validateForm();
        if (formErrors.length > 0) {
            alert(formErrors.join("\n"));
            return;
        }

        // Always use current props.username to avoid stale state
        const payload = {
            ...formData,
            username: props.username || formData.username,
            category: formData.category || 'None',
            is_public: formData.is_public !== false ? 1 : 0,  // Convert to database format
        };

        const formData2 = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
            if (key === 'link') return; // handled separately via links state
            if (value !== undefined && value !== null && value !== '') {
                formData2.append(key, value);
            }
        });
        const serializedLink = serializeLinks(links);
        formData2.append('link', serializedLink);
        formData2.append('link_text', '');

        // Add location type and polygon data
        formData2.append('location_type', locationType);
        if ((locationType === 'polygon' && polygonVertices.length >= 3) || (locationType === 'image' && polygonVertices.length >= 4)) {
            if (locationType === 'image') {
                // Image overlays use flat vertices (4 corners, no ring concept)
                formData2.append('polygon_coordinates', JSON.stringify({
                    vertices: polygonVertices,
                    fillColor: polygonFillColor,
                    lineStyle: polygonLineStyle,
                    imageOpacity: overlayImageOpacity
                }));
            } else {
                // Polygon cards: build rings from flat array with ring property
                const ringMap = new Map();
                for (const v of polygonVertices) {
                    const r = v.ring ?? 0;
                    if (!ringMap.has(r)) {
                        ringMap.set(r, {
                            vertices: [],
                            style: {
                                fillColor: undefined,
                                fillOpacity: undefined,
                                lineStyle: undefined,
                            }
                        });
                    }
                    const ringData = ringMap.get(r);
                    ringData.vertices.push({ lat: v.lat, lng: v.lng });
                    if (v.fillColor !== undefined && v.fillColor !== null && v.fillColor !== '') {
                        ringData.style.fillColor = v.fillColor;
                    }
                    if (v.fillOpacity !== undefined && v.fillOpacity !== null && v.fillOpacity !== '') {
                        ringData.style.fillOpacity = v.fillOpacity;
                    }
                    if (v.lineStyle !== undefined && v.lineStyle !== null && v.lineStyle !== '') {
                        ringData.style.lineStyle = v.lineStyle;
                    }
                }
                const ordered = [...ringMap.entries()].sort(([a], [b]) => a - b).map(([, data]) => data);
                const rings = ordered.map(data => data.vertices);
                const ringStyles = ordered.map(data => ({
                    fillColor: data.style.fillColor || polygonFillColor,
                    fillOpacity: data.style.fillOpacity ?? 0.2,
                    lineStyle: data.style.lineStyle || polygonLineStyle,
                }));
                formData2.append('polygon_coordinates', JSON.stringify({
                    rings,
                    ringStyles,
                    fillColor: polygonFillColor,
                    fillOpacity: 0.2,
                    lineStyle: polygonLineStyle,
                }));
            }
            formData2.append('polygon_fill_color', polygonFillColor);
            formData2.append('polygon_line_style', polygonLineStyle);
        }

        // append multiple files
        if (selectedFiles.length > 0) {
            selectedFiles.forEach((file) => {
                formData2.append('files', file);
            });
        }
        
        // append multiple images
        if (locationType === 'image') {
            if (overlayImageFile) {
                formData2.append('thumbnail', overlayImageFile);
            }
            // Extra image slots (additional map overlays)
            const extraSlots = overlayImageSlots.slice(1).filter(s => s.file);
            extraSlots.forEach(slot => {
                formData2.append('images', slot.file);
            });
            imageFiles.forEach((file) => {
                formData2.append('images', file);
            });
        } else if (imageFiles.length > 0) {
            formData2.append('thumbnail', imageFiles[0]); // first image as thumbnail
            imageFiles.forEach((file) => {
                formData2.append('images', file);
            });
        }

        console.log("Uploading FormData:", [...formData2.entries()]);

        api.post('/uploadForm', formData2, {
            headers: { 'Content-Type': 'multipart/form-data' }
        })
        .then(async response => {
            const newCardId = response.data?.card_id;
            if (newCardId && pendingArcgisItems.length > 0) {
                for (const item of pendingArcgisItems) {
                    try {
                        await api.post('/cardArcGISLinks', {
                            card_id: newCardId,
                            service_key: item.service_key,
                            layer_id: item.layer_id ?? null,
                            sublayer_index: item.sublayer_index ?? null,
                            display_name: item.display_name,
                            item_type: item.item_type,
                            state_code: item.state_code,
                            folder_name: item.folder_name,
                        });
                    } catch (linkErr) {
                        console.error('Failed to link ArcGIS item:', linkErr);
                    }
                }
            }
            handleCloseModal();
            alert("Upload Successful");
            window.dispatchEvent(new CustomEvent('atlas:card-uploaded'));
        })
        .catch(error => {
            console.error("Upload error:", error.response?.data || error.message);
            alert("Upload failed.");
        });
    };

    const handleSelectLocation = useCallback(() => {
        const map = window.atlasMapInstance;

        if (!map) {
            console.error("Map not found");
            return;
        }

        // Hide the modal while selecting location
        setIsSelectingLocation(true);
        map.getCanvas().style.cursor = 'crosshair';

        const onMapClick = (e) => {
            const { lat, lng } = e.lngLat;

            // Remove previous temp marker if any
            if (selectLocationMarker.current) {
                selectLocationMarker.current.remove();
            }

            // Create popup with confirm/cancel buttons
            const popupContainer = document.createElement('div');
            popupContainer.className = 'location-select-popup';
            popupContainer.innerHTML = `
                <div style="font-size:12px;margin-bottom:6px;color:#333;">
                    ${lat.toFixed(6)}, ${lng.toFixed(6)}
                </div>
                <div style="display:flex;gap:6px;">
                    <button class="location-select-confirm">OK</button>
                    <button class="location-select-cancel">Cancel</button>
                </div>
            `;

            const popup = new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 25,
                className: 'location-select-mapbox-popup',
            }).setDOMContent(popupContainer);

            const marker = new mapboxgl.Marker({ color: "red" })
                .setLngLat([lng, lat])
                .setPopup(popup)
                .addTo(map);

            marker.togglePopup(); // open immediately
            selectLocationMarker.current = marker;

            // Confirm: fill form, close popup, show modal
            popupContainer.querySelector('.location-select-confirm').addEventListener('click', () => {
                setFormData((prevData) => ({
                    ...prevData,
                    latitude: lat.toFixed(6),
                    longitude: lng.toFixed(6),
                }));

                if (shouldCloseOnPointCancelRef.current && typeof props.onPointLocationSelected === 'function') {
                    props.onPointLocationSelected();
                }

                shouldCloseOnPointCancelRef.current = false;
                marker.remove();
                selectLocationMarker.current = null;
                setIsSelectingLocation(false);
                map.getCanvas().style.cursor = '';
                map.off('click', onMapClick);
            });

            // Cancel: just remove marker, let user click again
            popupContainer.querySelector('.location-select-cancel').addEventListener('click', () => {
                marker.remove();
                selectLocationMarker.current = null;
            });
        };

        map.on('click', onMapClick);

        // Store ref so we can clean up
        selectLocationMarker.current = { _onMapClick: onMapClick, remove: () => {} };
    }, []);

    const cancelSelectLocation = () => {
        const map = window.atlasMapInstance;
        if (map) {
            map.getCanvas().style.cursor = '';
            if (selectLocationMarker.current) {
                if (selectLocationMarker.current._onMapClick) {
                    map.off('click', selectLocationMarker.current._onMapClick);
                }
                selectLocationMarker.current.remove();
                selectLocationMarker.current = null;
            }
        }
        setIsSelectingLocation(false);

        // Point-tool launch from map toolbar: cancel without plotting should fully close create-card flow.
        if (shouldCloseOnPointCancelRef.current) {
            shouldCloseOnPointCancelRef.current = false;
            handleCloseModal();
        }
    };

    const handleStartPolygonDraw = () => {
        setIsDrawingPolygon(true);
    };

    const handleStartImageOverlayPlacement = () => {
        setIsPlacingImageOverlay(true);
        window.dispatchEvent(new CustomEvent('map-image-tool-start'));
    };

    const handlePolygonSave = (allRings, centroid, style) => {
        // Flatten array-of-rings into a flat array with `ring` index property
        const flatVerts = allRings.flatMap((ring, ringIdx) => ring.map(v => ({ ...v, ring: ringIdx })));
        setPolygonVertices(flatVerts);
        if (style) {
            if (style.fillColor) setPolygonFillColor(style.fillColor);
            if (style.lineStyle) setPolygonLineStyle(style.lineStyle);
        }
        setFormData(prev => ({
            ...prev,
            latitude: centroid.lat.toFixed(6),
            longitude: centroid.lng.toFixed(6),
        }));
        setIsDrawingPolygon(false);
    };

    const handlePolygonCancel = () => {
        setIsDrawingPolygon(false);
    };

    const handleLocationTypeChange = (type) => {
        setLocationType(type);
        if (type === 'point') {
            setPolygonVertices([]);
        }
    };

    useEffect(() => {
        const signal = props.initialPointToolSignal;
        if (!signal || signal === lastPointToolSignalRef.current) return;
        if (isSelectingLocation || isDrawingPolygon) return;

        lastPointToolSignalRef.current = signal;
        shouldCloseOnPointCancelRef.current = true;
        setLocationType('point');
        setPolygonVertices([]);
        handleSelectLocation();
    }, [props.initialPointToolSignal, isSelectingLocation, isDrawingPolygon, handleSelectLocation]);

    return (
        <div>
            {/* Floating hint when selecting location */}
            {isSelectingLocation && (
                <div className="location-select-hint">
                    <span>Click on the map to select a location</span>
                    <button type="button" onClick={cancelSelectLocation}>Cancel</button>
                </div>
            )}

            {/* Polygon drawing flow */}
            {isDrawingPolygon && (
                <PolygonDrawingModal
                    onSave={handlePolygonSave}
                    onCancel={handlePolygonCancel}
                />
            )}

            <Modal
                isOpen={isCreateCardModalVisible}
                onRequestClose={handleCloseModal}
                className="form-modal"
                overlayClassName="form-modal-overlay"
                ariaHideApp={false}
            >
                <div className="form-modal-top-actions" data-onboarding-target="create-card-top-actions">
                    <button
                        type="button"
                        className="form-modal-top-action-btn form-modal-top-action-btn--onboarding card-panel-titlebar-btn card-panel-titlebar-btn--onboarding"
                        title="Help"
                        onClick={handleOpenCreateCardHelp}
                    >
                        <FontAwesomeIcon icon={faQuestion} />
                    </button>
                    <button
                        type="button"
                        className="form-modal-top-action-btn form-modal-top-action-btn--onboarding card-panel-titlebar-btn card-panel-titlebar-btn--onboarding"
                        title="Start onboarding"
                        data-onboarding-target="create-card-onboarding-button"
                        onClick={handleStartCreateCardOnboarding}
                    >
                        <FontAwesomeIcon icon={faPlay} />
                    </button>
                </div>
                <button className="close-modal-button" onClick={handleCloseModal}>
                    &times;
                </button>
                <div data-onboarding-target="create-card-modal-root">
                <h2 data-onboarding-target="create-card-title">Create Card</h2>
                <form onSubmit={handleSubmit}>
                    <label>Author Name <span className="form-modal-required-star">*</span>:</label>
                    <input 
                        type="text" 
                        name="name" 
                        value={formData.name} 
                        onChange={handleInputChange} 
                        required 
                    />

                    <label>Email <span className="form-modal-required-star">*</span>:</label>
                    <input type="email" name="email" value={formData.email} onChange={handleInputChange} required />

                    <label>Title <span className="form-modal-required-star">*</span>:</label>
                    <input type="text" name="title" value={formData.title} onChange={handleInputChange} required />

                    <label>Category (optional):</label>
                    <select name="category" value={formData.category} onChange={handleInputChange}>
                        <option value="">Select a Category</option>
                        <option value="River">River</option>
                        <option value="Watershed">Watershed</option>
                        <option value="Places">Places</option>
                        <option value="Other">Other</option>
                    </select>

                    <label>Description (optional):</label>
                    <textarea name="description" value={formData.description} onChange={handleInputChange} />

                    <label>Funding (optional):</label>
                    <input type="text" name="funding" value={formData.funding} onChange={handleInputChange} />

                    <label>Organization (optional):</label>
                    <input type="text" name="org" value={formData.org} onChange={handleInputChange} />

                    <div className="form-modal-links-section">
                        <label className="form-modal-links-label">Links (optional):</label>
                        {links.map((linkItem, idx) => (
                            <div key={idx} className="form-modal-link-row">
                                <input
                                    type="text"
                                    className="form-modal-link-input"
                                    placeholder="URL"
                                    value={linkItem.url}
                                    onChange={e => setLinks(links.map((l, i) => i === idx ? { ...l, url: e.target.value } : l))}
                                />
                                <input
                                    type="text"
                                    className="form-modal-link-input form-modal-link-text-input"
                                    placeholder="Display text (optional)"
                                    value={linkItem.text}
                                    onChange={e => setLinks(links.map((l, i) => i === idx ? { ...l, text: e.target.value } : l))}
                                />
                                {links.length > 1 && (
                                    <button
                                        type="button"
                                        className="form-modal-link-remove-btn"
                                        onClick={() => setLinks(links.filter((_, i) => i !== idx))}
                                    >&times;</button>
                                )}
                            </div>
                        ))}
                        <button
                            type="button"
                            className="form-modal-add-link-btn"
                            onClick={() => setLinks([...links, { url: '', text: '' }])}
                        >+ Add More Links</button>
                    </div>

                    <label>Location Type (choose map placement mode) <span className="form-modal-required-star">*</span>:</label>
                    <div className="form-modal-location-tabs" data-onboarding-target="create-card-location-tabs">
                        <button
                            type="button"
                            className={`form-modal-location-tab ${locationType === 'point' ? 'active' : ''}`}
                            onClick={() => handleLocationTypeChange('point')}
                        >
                            Single Point
                        </button>
                        <button
                            type="button"
                            className={`form-modal-location-tab ${locationType === 'polygon' ? 'active' : ''}`}
                            onClick={() => handleLocationTypeChange('polygon')}
                        >
                            Polygon Area
                        </button>
                        <button
                            type="button"
                            className={`form-modal-location-tab ${locationType === 'image' ? 'active' : ''}`}
                            onClick={() => handleLocationTypeChange('image')}
                        >
                            Image Overlay
                        </button>
                    </div>

                    {locationType === 'point' && (
                        <div className="form-modal-location-content form-modal-location-content--point">
                            <p className="form-modal-location-description">Use one latitude/longitude point to pin this card at a single location.</p>
                            <button type="button" className="location_button" onClick={handleSelectLocation}>
                                Select a Location
                            </button>

                            <div className="form-modal-lat-lng-row">
                                <div className="form-modal-lat-lng-field">
                                    <label>Latitude <span className="form-modal-required-star">*</span>:</label>
                                    <input
                                        type="text"
                                        name="latitude"
                                        value={formData.latitude}
                                        onChange={handleInputChange}
                                        required
                                    />
                                </div>
                                <div className="form-modal-lat-lng-field">
                                    <label>Longitude <span className="form-modal-required-star">*</span>:</label>
                                    <input
                                        type="text"
                                        name="longitude"
                                        value={formData.longitude}
                                        onChange={handleInputChange}
                                        required
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {locationType === 'polygon' && (
                        <div className="form-modal-location-content form-modal-polygon-section">
                            <p className="form-modal-location-description">Draw a polygon area on the map to represent a region instead of a single point.</p>
                            <button type="button" className="location_button" onClick={handleStartPolygonDraw}>
                                {polygonVertices.length >= 3 ? 'Redraw Polygon' : 'Draw Polygon on Map'}
                            </button>
                            {polygonVertices.length >= 3 && (
                                <div className="form-modal-polygon-summary">
                                    <span className="form-modal-polygon-check">&#10003;</span>
                                    Polygon saved: {polygonVertices.length} points
                                </div>
                            )}
                        </div>
                    )}

                    {locationType === 'image' && (
                        <div className="form-modal-location-content form-modal-polygon-section">
                            <p className="form-modal-location-description">Place a georeferenced image overlay (PNG, JPG/JPEG, GIF, WebP) onto the map using four corner points.</p>
                            <button type="button" className="location_button" onClick={handleStartImageOverlayPlacement}>
                                {overlayImageSlots.some(s => s.vertices && s.vertices.length >= 4) || polygonVertices.length >= 4
                                    ? 'Edit Image Placement'
                                    : 'Add Image to Map'}
                            </button>
                            {(() => {
                                const placedCount = overlayImageSlots.filter(s => s.vertices && s.vertices.length >= 4).length;
                                if (placedCount > 0) {
                                    return (
                                        <div className="form-modal-polygon-summary">
                                            <span className="form-modal-polygon-check">&#10003;</span>
                                            {placedCount} image{placedCount > 1 ? 's' : ''} placed
                                        </div>
                                    );
                                }
                                if (polygonVertices.length >= 4) {
                                    const cLat = polygonVertices.reduce((s, v) => s + v.lat, 0) / polygonVertices.length;
                                    const cLng = polygonVertices.reduce((s, v) => s + v.lng, 0) / polygonVertices.length;
                                    return (
                                        <div className="form-modal-polygon-summary">
                                            <span className="form-modal-polygon-check">&#10003;</span>
                                            Image placed (center: {cLat.toFixed(4)}, {cLng.toFixed(4)})
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    )}

                    <label>Tags (comma-separated) (optional):</label>
                    <input type="text" name="tags" value={formData.tags} onChange={handleInputChange} />

                    <label>Visibility:</label>
                    <select
                        name="is_public"
                        value={formData.is_public !== false ? "true" : "false"}
                        onChange={(e) => setFormData(prev => ({ ...prev, is_public: e.target.value !== "false" }))}
                    >
                        <option value="true">Public (visible to everyone)</option>
                        <option value="false">Private (only visible to me)</option>
                    </select>

                    <label>Attach Images (optional):</label>
                    <div
                        className="form-modal-image-upload-area"
                        data-onboarding-target="create-card-image-upload"
                        onClick={() => imageInputRef.current?.click()}
                    >
                        <p>{locationType === 'image' ? 'Click or drag to add optional gallery images for the card details view' : 'Click or drag to add images (PNG, JPG, GIF, WebP)'}</p>
                        <span className="form-modal-image-upload-btn">Choose Images</span>
                        <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            multiple
                            onChange={handleImageInput}
                        />
                    </div>
                    {imagePreviews.length > 0 && (
                        <div className="form-modal-image-previews">
                            {imagePreviews.map((src, i) => (
                                <div key={i} className="form-modal-image-preview-item">
                                    <img src={src} alt={`preview ${i + 1}`} />
                                    <button
                                        type="button"
                                        className="form-modal-image-preview-remove"
                                        onClick={() => removeImage(i)}
                                    >&times;</button>
                                </div>
                            ))}
                        </div>
                    )}

                    <label>Upload Files (optional):</label>
                    <div
                        className="form-modal-file-upload-area"
                        data-onboarding-target="create-card-file-upload"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <p>Click to add files (max 5 MB each)</p>
                        <span className="form-modal-image-upload-btn">Choose Files</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={handleFileInput}
                        />
                    </div>
                    {selectedFiles.length > 0 && (
                        <div className="form-modal-file-list">
                            {selectedFiles.map((file, i) => (
                                <div key={i} className="form-modal-file-item">
                                    <span>{file.name}</span>
                                    <button type="button" onClick={() => removeFile(i)}>&times;</button>
                                </div>
                            ))}
                        </div>
                    )}

                    <label>Linked ArcGIS Services (optional):</label>
                    <button
                        type="button"
                        className="location_button"
                        onClick={() => setIsArcgisPickerOpen(true)}
                    >
                        + Link ArcGIS Service / Layer
                    </button>
                    {pendingArcgisItems.length > 0 && (
                        <div className="form-modal-file-list" style={{marginTop:'6px'}}>
                            {pendingArcgisItems.map((item, i) => (
                                <div key={i} className="form-modal-file-item">
                                    <span>{item.display_name}</span>
                                    <button
                                        type="button"
                                        onClick={() => setPendingArcgisItems(prev => prev.filter((_, j) => j !== i))}
                                    >&times;</button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }} data-onboarding-target="create-card-submit-actions">
                        <button type="submit">Submit</button>
                        <button type="button" className="cancel_button" onClick={handleCloseModal}>Cancel</button>
                    </div>
                </form>
                </div>
            </Modal>

            <CreateCardModalOnboarding
                isOpen={isCreateCardOnboardingOpen}
                onClose={() => setIsCreateCardOnboardingOpen(false)}
            />

            {isArcgisPickerOpen && ReactDOM.createPortal(
                <ArcGISPickerModal
                    onAdd={(items) => {
                        setPendingArcgisItems(prev => {
                            const existingKeys = new Set(prev.map(i => `${i.service_key}__${i.layer_id ?? ''}__${i.sublayer_index ?? ''}`));
                            const newItems = items.filter(i => !existingKeys.has(`${i.service_key}__${i.layer_id ?? ''}__${i.sublayer_index ?? ''}`));
                            return [...prev, ...newItems];
                        });
                        setIsArcgisPickerOpen(false);
                    }}
                    onClose={() => setIsArcgisPickerOpen(false)}
                />,
                document.body
            )}
        </div>
    );
};

export default FormModal;
