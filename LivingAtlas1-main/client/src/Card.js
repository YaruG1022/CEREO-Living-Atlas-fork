import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import Modal from 'react-modal';
import mapboxgl from 'mapbox-gl';
import api from './api.js';
import { fetchArcgisLegend } from './arcgisDataUtils';
import './Card.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeart as solidHeart, faMagnifyingGlass, faPenToSquare, faTrashCan, faDownload } from '@fortawesome/free-solid-svg-icons';
import { jsPDF } from 'jspdf';
import { faHeart as regularHeart, faQuestionCircle, faCirclePlay } from '@fortawesome/free-regular-svg-icons';
import PolygonDrawingModal from './PolygonDrawingModal';
import ArcGISPickerModal from './ArcGISPickerModal';
import LearnMoreOnboarding, { LEARN_MORE_EDIT_MODE_STEP } from './OnboardingLearnMore';
import WA_ARCGIS_SERVICES from './arcgis_services_wa.json';
import ID_ARCGIS_SERVICES from './arcgis_services_id.json';
import OR_ARCGIS_SERVICES from './arcgis_services_or.json';

const CARD_CATEGORIES = ['River', 'Watershed', 'Places', 'Other'];

const ARCGIS_STATE_FULL_NAMES = {
    WA: 'Washington State ArcGIS Services',
    ID: 'Idaho ArcGIS Services',
    OR: 'Oregon ArcGIS Services',
};

// Build a lookup map from service_key -> service label for breadcrumb display
const _allArcgisServices = [
    ...(WA_ARCGIS_SERVICES || []),
    ...(ID_ARCGIS_SERVICES || []),
    ...(OR_ARCGIS_SERVICES || []),
];
const ARCGIS_SERVICE_LABEL_BY_KEY = {};
const ARCGIS_SERVICE_URL_BY_KEY = {};
_allArcgisServices.forEach(s => {
    ARCGIS_SERVICE_LABEL_BY_KEY[s.key] = s.label || s.key;
    ARCGIS_SERVICE_URL_BY_KEY[s.key] = s.url || null;
});

function parseLinks(link, linkText) {
    if (!link) return [{ url: '', text: '' }];
    try {
        const parsed = JSON.parse(link);
        if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : [{ url: '', text: '' }];
    } catch {}
    return [{ url: link, text: linkText || '' }];
}

function serializeLinks(links) {
    const filtered = links.filter(l => l.url.trim() !== '');
    if (filtered.length === 0) return '';
    return JSON.stringify(filtered);
}

function Card(props) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLearnMoreOnboardingOpen, setIsLearnMoreOnboardingOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
    const [isLearnMoreEditMode, setIsLearnMoreEditMode] = useState(false);
    const [isAllImagesView, setIsAllImagesView] = useState(false);
    const [selectedAllImageIDs, setSelectedAllImageIDs] = useState([]);
    const [pendingDeletedImageIDs, setPendingDeletedImageIDs] = useState([]);
    const [learnMoreBackup, setLearnMoreBackup] = useState(null);
    const [isImageMutationLoading, setIsImageMutationLoading] = useState(false);
    const [pendingImageSlotIndex, setPendingImageSlotIndex] = useState(null);
    const [sessionUploadedImageIDs, setSessionUploadedImageIDs] = useState([]);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [isSelectingLocation, setIsSelectingLocation] = useState(false);
    const [isEditingPolygon, setIsEditingPolygon] = useState(false);
    const [isConvertingToPolygon, setIsConvertingToPolygon] = useState(false);
    const isEditingRef = useRef(false); // Track editing state across renders
    const learnMoreImageInputRef = useRef(null);
    const selectLocationMarker = useRef(null);
    const [formData, setFormData] = useState({
        ...props.formData,
        files: props.formData?.files || [],      // <-- ensure files array always exists
        filesToUpload: [],                       // <-- temp storage for new uploads
        is_public: props.formData?.is_public !== false  // default true
    });
    const [loading, setLoading] = useState(false);
    const [isFavorited, setIsFavorited] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [linkedArcgisItems, setLinkedArcgisItems] = useState([]);
    const [arcgisLegends, setArcgisLegends] = useState({}); // { serviceKey: legendData }
    const [isArcgisPickerOpen, setIsArcgisPickerOpen] = useState(false);
    // Track which linked items have their layer shown on the map (keyed by item.id)
    const [linkedArcgisChecked, setLinkedArcgisChecked] = useState({});
    const linkedItemsLoadedRef = useRef(null); // tracks which cardID was last loaded
    const linkedArcgisItemsBackupRef = useRef(null); // backup of linkedArcgisItems when edit mode starts
    const [learnMoreLinks, setLearnMoreLinks] = useState([{ url: '', text: '' }]);
    const [editFormLinks, setEditFormLinks] = useState([{ url: '', text: '' }]);
    const [thumbnail, setThumbnail] = useState(null);
    const [preview, setPreview] = useState(
        formData.thumbnail_link && formData.thumbnail_link.trim() !== ""
            ? formData.thumbnail_link
            : "/CEREO-logo.png"
    );

    useEffect(() => {
        // Completely ignore prop updates while editing
        if (!isEditingRef.current) {
            setFormData((prev) => {
                const incomingCardID = props.formData?.cardID;
                const isSameCard = prev?.cardID === incomingCardID;
                const incomingHasImages = Array.isArray(props.formData?.images) && props.formData.images.length > 0;
                const prevHasImages = Array.isArray(prev?.images) && prev.images.length > 0;

                const mergedImages = (isSameCard && !incomingHasImages && prevHasImages)
                    ? prev.images
                    : (props.formData?.images || []);

                return {
                    ...props.formData,
                    images: mergedImages,
                    files: props.formData?.files || [],
                    filesToUpload: [],
                    is_public: props.formData?.is_public !== false
                };
            });
            setPreview(
                props.formData?.thumbnail_link && props.formData.thumbnail_link.trim() !== ""
                    ? props.formData.thumbnail_link
                    : "/CEREO-logo.png"
            );
        }
    }, [props.formData]);

    useEffect(() => {
        setIsFavorited(props.isFavorited);
    }, [props.isFavorited]);

    useEffect(() => {
        if (props.forceOpenLearnMoreSignal) {
            setIsModalOpen(true);
            const cardId = formData.cardID;
            if (cardId) {
                refreshCardImages().catch(() => {});
                if (linkedItemsLoadedRef.current !== cardId) {
                    linkedItemsLoadedRef.current = cardId;
                    api.get(`/cardArcGISLinks?card_id=${cardId}`)
                        .then(res => setLinkedArcgisItems(res.data.data || []))
                        .catch(() => {});
                }
            }
        }
    }, [props.forceOpenLearnMoreSignal]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch ArcGIS legend data for all service keys in linkedArcgisItems
    useEffect(() => {
        if (linkedArcgisItems.length === 0) return;
        const uniqueKeys = [...new Set(linkedArcgisItems.map(i => i.service_key))];
        uniqueKeys.forEach(key => {
            if (arcgisLegends[key] !== undefined) return;
            const serviceUrl = ARCGIS_SERVICE_URL_BY_KEY[key];
            if (!serviceUrl) return;
            fetchArcgisLegend(serviceUrl)
                .then(legend => setArcgisLegends(prev => ({ ...prev, [key]: legend || {} })))
                .catch(() => setArcgisLegends(prev => ({ ...prev, [key]: {} })));
        });
    }, [linkedArcgisItems]); // eslint-disable-line react-hooks/exhaustive-deps

    // Ensure username and name always have safe defaults
    // Now handled by handleEdit
    /* useEffect(() => {
        if (props.formData) {
            setFormData({
                ...props.formData,
                username: props.formData.username || '',
                name: props.formData.name || '',
                files: props.formData.files || [],
                filesToUpload: []
            });
        }
    }, [props.formData]); */

    const handleLearnMore = (e) => {
        e.stopPropagation();
        setIsLearnMoreEditMode(false);
        setIsAllImagesView(false);
        setIsModalOpen(true);
        if (props.onLearnMore) props.onLearnMore();
        const cardId = formData.cardID;
        if (cardId) {
            refreshCardImages().catch(() => {});
            if (linkedItemsLoadedRef.current !== cardId) {
                linkedItemsLoadedRef.current = cardId;
                api.get(`/cardArcGISLinks?card_id=${cardId}`)
                    .then(res => setLinkedArcgisItems(res.data.data || []))
                    .catch(() => {});
            }
        }
    };

    const isLearnMoreModalVisible = isModalOpen && !isSelectingLocation && !isEditingPolygon;

    useEffect(() => {
        if (!isLearnMoreModalVisible && isLearnMoreOnboardingOpen) {
            setIsLearnMoreOnboardingOpen(false);
        }
    }, [isLearnMoreModalVisible, isLearnMoreOnboardingOpen]);

    const [learnMoreOnboardingStep, setLearnMoreOnboardingStep] = useState(0);

    // Enter edit mode at step 5 (index 4+), exit when onboarding closes
    useEffect(() => {
        if (!isLearnMoreOnboardingOpen || !isLearnMoreModalVisible) {
            // Exit edit mode when onboarding closes
            if (isLearnMoreEditMode) {
                setIsLearnMoreEditMode(false);
                isEditingRef.current = false;
            }
            return;
        }
        const shouldBeInEditMode = learnMoreOnboardingStep >= LEARN_MORE_EDIT_MODE_STEP;
        if (shouldBeInEditMode && !isLearnMoreEditMode) {
            isEditingRef.current = true;
            setEditFormLinks(parseLinks(formData.link, formData.link_text));
            setFormData((prev) => ({
                ...prev,
                original_username: prev.username,
                original_email: prev.email,
                original_title: prev.title,
            }));
            setIsLearnMoreEditMode(true);
        } else if (!shouldBeInEditMode && isLearnMoreEditMode) {
            setIsLearnMoreEditMode(false);
            isEditingRef.current = false;
        }
    }, [isLearnMoreOnboardingOpen, isLearnMoreModalVisible, learnMoreOnboardingStep]);

    const handleZoom = (e) => {
        e.stopPropagation();
        props.onZoom?.();
    };

    const handleOpenImagePreview = (e) => {
        e.stopPropagation();
        setIsImagePreviewOpen(true);
    };
  
    const handleEdit = (e) => {
        e.stopPropagation();
        isEditingRef.current = true; // Lock editing state
        setEditFormLinks(parseLinks(props.formData.link, props.formData.link_text));
        setFormData({
            ...props.formData,
            original_username: props.formData.username,
            original_email: props.formData.email,
            original_title: props.formData.title,
        });
        /*
        setFormData(prev => ({ 
            ...prev, 
            original_username: prev.username, 
            original_email: prev.email,
            filesToUpload: [] // reset upload buffer when editing
        }));
        */
        setIsEditModalOpen(true);
    };

    const handleDelete = (e) => {
        e.stopPropagation();

        if (!props.isLoggedIn && !isLearnMoreOnboardingOpen) {
            setShowLoginPrompt(true);
            return;
        }

        if (!formData.username || !formData.title) {
            alert("Missing username or title — cannot delete card.");
            return;
        }

        const viewerEmail = localStorage.getItem('email') || '';
        const cardOwnerEmail = formData.email || '';
        const isAdmin = (() => { try { return JSON.parse(localStorage.getItem('isAdmin')); } catch { return false; } })();
        if (!isAdmin && viewerEmail && cardOwnerEmail && viewerEmail !== cardOwnerEmail) {
            alert("You don't have permission to delete this card. Only the card's creator or an admin can delete it.");
            return;
        }

        if (!window.confirm("Are you sure you want to delete this card?")) return;

        api.delete(`/deleteCard`, {
            params: {
                username: formData.username,
                title: formData.title,
                requester_email: viewerEmail,
            }
        })
        .then(() => {
            alert("Card deleted successfully.");
            if (typeof props.onCardDelete === "function") {
                props.onCardDelete(true);
            } else {
                window.location.reload();
            }
        })
        .catch((error) => {
            console.error("Delete failed:", error);
            alert("Failed to delete the card.");
        });
    };

    const handleDownloadPdf = async () => {
        if (!props.isLoggedIn && !isLearnMoreOnboardingOpen) {
            setShowLoginPrompt(true);
            return;
        }
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const margin = 40;
        const maxW = pageW - margin * 2;
        let y = margin;

        const addText = (text, opts = {}) => {
            const { fontSize = 12, bold = false, color = [33, 33, 33], wrap = true } = opts;
            doc.setFontSize(fontSize);
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.setTextColor(...color);
            if (wrap) {
                const lines = doc.splitTextToSize(String(text || ''), maxW);
                lines.forEach(line => {
                    if (y > doc.internal.pageSize.getHeight() - margin) {
                        doc.addPage();
                        y = margin;
                    }
                    doc.text(line, margin, y);
                    y += fontSize * 1.4;
                });
            } else {
                if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
                doc.text(String(text || ''), margin, y);
                y += fontSize * 1.4;
            }
        };

        const addField = (label, value) => {
            if (!value && value !== 0) return;
            const str = String(value).trim();
            if (!str) return;
            addText(`${label}: ${str}`, { fontSize: 11 });
        };

        const addDivider = () => {
            if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
            doc.setDrawColor(200, 200, 200);
            doc.line(margin, y, pageW - margin, y);
            y += 10;
        };

        // Title
        addText(formData.title || 'Untitled', { fontSize: 20, bold: true });
        y += 6;
        addDivider();

        // Meta fields
        addField('Uploaded by', formData.username);
        addField('Category', formData.category);
        addField('Organization', formData.org);
        addField('Funding', formData.funding);
        addField('Tags', formData.tags);
        if (formData.created_date) addField('Created', new Date(formData.created_date).toLocaleDateString());

        // Location
        const exportLocationType = formData.location_type;
        if (exportLocationType === 'polygon') {
            addField('Location type', 'Polygon area');
        } else if (exportLocationType === 'image') {
            addField('Location type', 'Image overlay');
        } else if (formData.lat !== undefined && formData.lat !== null && formData.lon !== undefined && formData.lon !== null) {
            addField('Latitude', formData.lat);
            addField('Longitude', formData.lon);
        }

        // Description
        if (formData.description) {
            y += 6;
            addDivider();
            addText('Description', { fontSize: 13, bold: true });
            addText(formData.description, { fontSize: 11 });
        }

        // Links
        const links = parseLinks(formData.link, formData.link_text).filter(l => l.url && l.url.trim());
        if (links.length > 0) {
            y += 6;
            addDivider();
            addText('Links', { fontSize: 13, bold: true });
            links.forEach(l => {
                const label = l.text ? `${l.text} — ${l.url}` : l.url;
                addText(label, { fontSize: 11, color: [37, 99, 235] });
            });
        }

        // Attached files
        if (formData.files && formData.files.length > 0) {
            y += 6;
            addDivider();
            addText('Attached Files', { fontSize: 13, bold: true });
            formData.files.forEach(f => addText(`• ${f.filename || 'File'}`, { fontSize: 11 }));
        }

        // Helper: load an image URL through the backend URL proxy (avoids GCS CORS)
        const loadImageViaUrlProxy = async (url) => {
            const response = await api.get('/imageUrlProxy', {
                params: { url },
                responseType: 'arraybuffer'
            });
            const bytes = new Uint8Array(response.data);
            let binary = '';
            bytes.forEach(b => { binary += String.fromCharCode(b); });
            const base64Str = btoa(binary);
            const contentType = (response.headers['content-type'] || 'image/jpeg').split(';')[0];
            const dataUrl = `data:${contentType};base64,${base64Str}`;
            const imgProps = doc.getImageProperties(dataUrl);
            return {
                dataUrl,
                format: contentType.includes('png') ? 'PNG' : 'JPEG',
                width: imgProps.width,
                height: imgProps.height
            };
        };
        // Helper: embed one image (dataUrl) into the PDF at current y position
        const embedImageInPdf = (dataUrl, format, width, height) => {
            const imgAspect = width / height;
            const imgW = Math.min(maxW, 400);
            const imgH = imgW / imgAspect;
            if (y + imgH > doc.internal.pageSize.getHeight() - margin) {
                doc.addPage();
                y = margin;
            }
            doc.addImage(dataUrl, format, margin, y, imgW, imgH);
            y += imgH + 14;
        };

        // Images — try backend proxy first (avoids CORS), fall back to canvas
        const imageRecords = (formData.images && Array.isArray(formData.images) && formData.images.length > 0)
            ? formData.images.filter(img => img.imageID != null)
            : [];

        // For cards with no CardImages entries, fall back to thumbnail_link
        const thumbnailFallbackUrl = (imageRecords.length === 0 && formData.thumbnail_link
            && formData.thumbnail_link.trim() !== ''
            && !formData.thumbnail_link.includes('CEREO-logo'))
            ? formData.thumbnail_link.trim()
            : null;

        if (imageRecords.length > 0 || thumbnailFallbackUrl) {
            y += 6;
            addDivider();
            addText('Images', { fontSize: 13, bold: true });
            y += 4;

            for (const imgRecord of imageRecords) {
                let embedded = false;
                // 1. Try backend proxy (returns raw bytes, bypasses GCS CORS)
                try {
                    const response = await api.get(`/cardImageProxy/${imgRecord.imageID}`, { responseType: 'arraybuffer' });
                    const bytes = new Uint8Array(response.data);
                    let binary = '';
                    bytes.forEach(b => { binary += String.fromCharCode(b); });
                    const base64Str = btoa(binary);
                    const contentType = (response.headers['content-type'] || 'image/jpeg').split(';')[0];
                    const dataUrl = `data:${contentType};base64,${base64Str}`;
                    const imgProps = doc.getImageProperties(dataUrl);
                    const fmt = contentType.includes('png') ? 'PNG' : 'JPEG';
                    embedImageInPdf(dataUrl, fmt, imgProps.width, imgProps.height);
                    embedded = true;
                } catch (_proxyErr) { /* fall through to canvas */ }

                // 2. Fall back to URL proxy (image ID proxy may have failed; try fetching image URL via backend)
                if (!embedded) {
                    try {
                        const normalized = normalizeImageRecord(imgRecord);
                        const { dataUrl, format, width, height } = await loadImageViaUrlProxy(normalized.url);
                        embedImageInPdf(dataUrl, format, width, height);
                        embedded = true;
                    } catch (_urlProxyErr) { /* fall through */ }
                }

                if (!embedded) {
                    addText('[Image could not be embedded]', { fontSize: 10, color: [150, 150, 150] });
                }
            }

            // Thumbnail fallback for cards without CardImages entries
            if (thumbnailFallbackUrl) {
                try {
                    const { dataUrl, format, width, height } = await loadImageViaUrlProxy(thumbnailFallbackUrl);
                    embedImageInPdf(dataUrl, format, width, height);
                } catch (_err) {
                    addText('[Image could not be embedded]', { fontSize: 10, color: [150, 150, 150] });
                }
            }
        }

        const safeName = (formData.title || 'card').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        doc.save(`${safeName}.pdf`);
    };

    const handleFavoriteClick = async (e) => {
        e.stopPropagation();

        if (!props.isLoggedIn) {
            setShowLoginPrompt(true);
            return;
        }

        const cardID = formData.cardID || props.cardID;
        const username = formData.viewerUsername || formData.username || props.username;

        console.log("cardID being sent:", cardID);
        console.log("username being sent:", username);

        if (!cardID) {
            console.error("Missing cardID");
            alert("Error: Cannot favorite this card — missing card ID.");
            return;
        }

        if (!username) {
            console.error("Missing username");
            alert("Error: Cannot favorite this card — missing username.");
            return;
        }

        try {
            const endpoint = !isFavorited ? '/bookmarkCard' : '/unbookmarkCard';
            const formData = new FormData();
            formData.append('username', username);
            formData.append('cardID', cardID);

            await api.post(endpoint, formData);

            setIsFavorited(prev => !prev);

            if (props.fetchBookmarks) props.fetchBookmarks();
            if (props.onBookmarkChange) props.onBookmarkChange();

        } catch (error) {
            console.error('Error toggling bookmark:', error);
        }
    };

    const isPolygonCard = formData.location_type === 'polygon';
    const isImageCard = formData.location_type === 'image';
    const isOverlayCard = isPolygonCard || isImageCard;

    const getRepresentativeImageUrl = useCallback((data = formData) => {
        if (data.location_type === 'image') {
            return resolveImageUrl(data.thumbnail_link || preview || '/CEREO-logo.png');
        }
        const imageRecords = Array.isArray(data.images) ? data.images : [];
        const firstImage = imageRecords[0];
        if (typeof firstImage === 'string') return resolveImageUrl(firstImage);
        if (firstImage?.url || firstImage?.imageURL) {
            return resolveImageUrl(firstImage.url || firstImage.imageURL);
        }
        return resolveImageUrl(data.thumbnail_link || preview || '/CEREO-logo.png');
    }, [formData, preview]);

    const validateForm = () => {
        const requiredFields = isOverlayCard
            ? ['username', 'name', 'email', 'title', 'category']
            : ['username', 'name', 'email', 'title', 'category', 'latitude', 'longitude'];
        for (const field of requiredFields) {
            const value = formData[field];
            if (value === undefined || value === null || value.toString().trim() === '') {
                alert(`Please fill out the ${field} field.`);
                return false;
            }
            if (field === 'latitude' && (Number(value) < -90 || Number(value) > 90)) {
                alert('Latitude must be between -90 and 90.');
                return false;
            }
            if (field === 'longitude' && (Number(value) < -180 || Number(value) > 180)) {
                alert('Longitude must be between -180 and 180.');
                return false;
            }
        }
        if (isPolygonCard && (!Array.isArray(formData.polygon_vertices) || formData.polygon_vertices.length < 3)) {
            alert('Polygon cards must keep at least 3 points.');
            return false;
        }
        if (isImageCard && (!Array.isArray(formData.polygon_vertices) || formData.polygon_vertices.length < 4)) {
            alert('Image cards must keep 4 corner points.');
            return false;
        }
        return true;
    };

    const saveEdits = async (options = {}) => {
     const { skipReload = false, closeEditModal = true, linkOverride } = options;
    if (!validateForm()) return;

    // Extra guard for username and name
    if (!formData.username?.trim() || !formData.name?.trim()) {
        alert("Both Username and name are required.");
        return;
    }

    // Validate username exists if it was changed
    if (formData.original_username && formData.username !== formData.original_username) {
        try {
            await api.get(`/profileAccount?username=${encodeURIComponent(formData.username)}`);
        } catch (error) {
            if (error.response?.status === 404) {
                alert(`Card Creator "${formData.username}" does not exist. Please use a valid username.`);
                return;
            }
        }
    }

    let effectiveThumbnailLink = formData.thumbnail_link || '';
    if (!isImageCard && !thumbnail && Array.isArray(formData.images) && formData.images.length > 0) {
        const firstImage = formData.images[0];
        const firstImageUrl = typeof firstImage === 'string'
            ? firstImage
            : (firstImage?.url || firstImage?.imageURL || '');

        if (firstImageUrl) {
            effectiveThumbnailLink = firstImageUrl;
        }
    }

    const formDataToSend = new FormData();
    Object.keys(formData).forEach((key) => {
        if (
            key !== "files" &&
            key !== "filesToUpload" &&
            key !== "images" &&
            key !== "thumbnail_link" &&
            key !== "polygon_vertices" &&
            key !== "category" &&
            formData[key] !== undefined && formData[key] !== null
        ) {
            if (linkOverride && (key === 'link' || key === 'link_text')) return;
            formDataToSend.append(key, formData[key]);
        }
    });
    if (linkOverride) {
        formDataToSend.append('link', linkOverride.link ?? '');
        formDataToSend.append('link_text', linkOverride.link_text ?? '');
    }
    formDataToSend.append('category', formData.category || 'None');

    // Send polygon vertices as JSON string if polygon card
    if (isOverlayCard && Array.isArray(formData.polygon_vertices) && formData.polygon_vertices.length >= (isImageCard ? 4 : 3)) {
        formDataToSend.append('polygon_coordinates', JSON.stringify({
            vertices: formData.polygon_vertices,
            fillColor: formData.polygon_fill_color,
            lineStyle: formData.polygon_line_style
        }));
    }

    //Only true if editing an existing card
    formDataToSend.append("update", !!formData.cardID);

    // Always include originals, fallback to current for new cards
    formDataToSend.append(
        "original_username",
        formData.original_username || formData.username
    );
    formDataToSend.append(
        "original_email",
        formData.original_email || formData.email
    );
    formDataToSend.append(
        "original_title",
        formData.original_title || formData.title
    );

    // NEW: If no new thumbnail selected, keep the existing one
    if (effectiveThumbnailLink && !thumbnail) {
        formDataToSend.append("thumbnail_link", effectiveThumbnailLink);
    }

    // If user uploaded a new thumbnail, append it as usual
    if (thumbnail) {
        formDataToSend.append("thumbnail", thumbnail);
    }

    // Append multiple files safely
    if (formData.filesToUpload && formData.filesToUpload.length > 0) {
        formData.filesToUpload.forEach((file) => {
            formDataToSend.append("files", file);
        });
    }

    const requesterEmail = localStorage.getItem('email') || '';
    if (requesterEmail) {
        formDataToSend.append('requester_email', requesterEmail);
    }

    setLoading(true);
    try {
        await api.post("/uploadForm", formDataToSend);
        alert("Card Information Saved.");
        isEditingRef.current = false; // Unlock editing state
        if (closeEditModal) {
            setIsEditModalOpen(false);
        }

        if (typeof props.onCardUpdate === "function") {
            props.onCardUpdate();
        } else if (!skipReload) {
            window.location.reload();
        }
        return true;
    } catch (error) {
        console.error("Failed to save the card:", error);
        
        // Extract detailed error message from backend response
        let errorMessage = "Failed to save the card. Please try again.";
        const detail = error.response?.data?.detail;
        const detailText = typeof detail === "string" ? detail : "";

        if (detailText.includes("Card Creator username does not exist")) {
            errorMessage = "Card Creator does not exist. Please enter an existing username.";
        } else if (detailText.includes("Card not found for update")) {
            errorMessage = "Could not save because the original card was not found. If you changed the Title, close and reopen Edit, then try again.";
        } else if (detailText) {
            errorMessage = `Error: ${detailText}`;
        } else if (error.response?.data?.message) {
            errorMessage = `Error: ${error.response.data.message}`;
        } else if (error.response?.status === 404) {
            errorMessage = "Unable to save: card or card creator was not found.";
        } else if (error.message) {
            errorMessage = `Error: ${error.message}`;
        }
        
        console.error("Error details:", {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
        });
        
        alert(errorMessage);
        return false;
    } finally {
        setLoading(false);
    }
};

    const handleSelectLocation = () => {
        const map = window.atlasMapInstance;
        if (!map) { console.error('Map not found'); return; }

        setIsSelectingLocation(true);
        map.getCanvas().style.cursor = 'crosshair';

        const onMapClick = (e) => {
            const { lat, lng } = e.lngLat;
            if (selectLocationMarker.current && selectLocationMarker.current.remove) {
                selectLocationMarker.current.remove();
            }

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
                closeButton: false, closeOnClick: false, offset: 25,
                className: 'location-select-mapbox-popup',
            }).setDOMContent(popupContainer);

            const marker = new mapboxgl.Marker({ color: 'red' })
                .setLngLat([lng, lat]).setPopup(popup).addTo(map);
            marker.togglePopup();
            selectLocationMarker.current = marker;

            popupContainer.querySelector('.location-select-confirm').addEventListener('click', () => {
                setFormData((prev) => ({ ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
                marker.remove();
                selectLocationMarker.current = null;
                setIsSelectingLocation(false);
                map.getCanvas().style.cursor = '';
                map.off('click', onMapClick);
            });

            popupContainer.querySelector('.location-select-cancel').addEventListener('click', () => {
                marker.remove();
                selectLocationMarker.current = null;
            });
        };

        map.on('click', onMapClick);
        selectLocationMarker.current = { _onMapClick: onMapClick, remove: () => {} };
    };

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
    };

    // Change marker card to polygon: hide modal → open PolygonDrawingModal
    const handleChangeToPolygon = useCallback(() => {
        const map = window.atlasMapInstance;
        if (!map) { console.error('Map not found'); return; }

        // Switch location_type but preserve existing lat/lng
        setFormData(prev => ({ ...prev, location_type: 'polygon' }));
        setIsConvertingToPolygon(true);
        setIsEditingPolygon(true);

        // Fly to the current marker location
        const lat = parseFloat(formData.latitude);
        const lng = parseFloat(formData.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            map.flyTo({ center: [lng, lat], zoom: 14 });
        }
    }, [formData.latitude, formData.longitude]);

    // Edit polygon: hide modal → fly to polygon → open PolygonDrawingModal
    const handleEditPolygon = useCallback(() => {
        const map = window.atlasMapInstance;
        const verts = formData.polygon_vertices;
        const minimumVertices = formData.location_type === 'image' ? 4 : 3;
        if (!map || !Array.isArray(verts) || verts.length < minimumVertices) return;

        // Close any open Mapbox popups on the map
        document.querySelectorAll('.mapboxgl-popup').forEach(el => {
            const closeBtn = el.querySelector('.mapboxgl-popup-close-button');
            if (closeBtn) closeBtn.click();
            else el.remove();
        });

        // Hide the existing card polygon layers so they don't show underneath the editor
        const cardID = formData.cardID || props.cardID;
        if (cardID) {
            if (formData.location_type === 'image') {
                const imageLayerId = `card-image-layer-${cardID}`;
                const outlineLayerId = `card-image-outline-${cardID}`;
                if (map.getLayer(imageLayerId)) map.setLayoutProperty(imageLayerId, 'visibility', 'none');
                if (map.getLayer(outlineLayerId)) map.setLayoutProperty(outlineLayerId, 'visibility', 'none');
            } else {
                const fillLayerId = `card-polygon-fill-${cardID}`;
                const lineLayerId = `card-polygon-line-${cardID}`;
                if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', 'none');
                if (map.getLayer(lineLayerId)) map.setLayoutProperty(lineLayerId, 'visibility', 'none');
            }
        }

        setIsEditingPolygon(true);

        // Fly to polygon bounds
        const lats = verts.map(v => v.lat);
        const lngs = verts.map(v => v.lng);
        const bounds = [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)]
        ];
        map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
    }, [formData.polygon_vertices, formData.cardID, formData.location_type, props.cardID]);

    // Restore card polygon layer visibility
    const restoreCardPolygonLayers = useCallback(() => {
        const map = window.atlasMapInstance;
        const cardID = formData.cardID || props.cardID;
        if (!map || !cardID) return;
        if (formData.location_type === 'image') {
            const imageLayerId = `card-image-layer-${cardID}`;
            const outlineLayerId = `card-image-outline-${cardID}`;
            if (map.getLayer(imageLayerId)) map.setLayoutProperty(imageLayerId, 'visibility', 'visible');
            if (map.getLayer(outlineLayerId)) map.setLayoutProperty(outlineLayerId, 'visibility', 'visible');
            return;
        }

        const fillLayerId = `card-polygon-fill-${cardID}`;
        const lineLayerId = `card-polygon-line-${cardID}`;
        if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', 'visible');
        if (map.getLayer(lineLayerId)) map.setLayoutProperty(lineLayerId, 'visibility', 'visible');
    }, [formData.cardID, formData.location_type, props.cardID]);

    // After polygon edit save: update formData and return to learn-more modal (edit mode)
    const handlePolygonEditSave = useCallback((vertices, centroid, style) => {
        setFormData(prev => ({
            ...prev,
            polygon_vertices: vertices,
            latitude: centroid.lat.toFixed(6),
            longitude: centroid.lng.toFixed(6),
            polygon_fill_color: style?.fillColor || prev.polygon_fill_color,
            polygon_line_style: style?.lineStyle || prev.polygon_line_style,
            polygon_fill_opacity: style?.fillOpacity ?? prev.polygon_fill_opacity,
        }));
        setIsEditingPolygon(false);
        setIsConvertingToPolygon(false);
        // Ensure learn-more modal stays in edit mode
        setIsLearnMoreEditMode(true);

        // Restore card polygon layer visibility
        restoreCardPolygonLayers();

        // Update the polygon on the main map immediately
        const map = window.atlasMapInstance;
        const cardID = formData.cardID || props.cardID;
        if (map && cardID && vertices.length >= (formData.location_type === 'image' ? 4 : 3)) {
            const fillColor = style?.fillColor || formData.polygon_fill_color || '#0077c0';
            if (formData.location_type === 'image') {
                const imageSourceId = `card-image-${cardID}`;
                const outlineSourceId = `card-image-outline-source-${cardID}`;
                const outlineLayerId = `card-image-outline-${cardID}`;
                const imageCoords = vertices.slice(0, 4).map(v => [parseFloat(v.lng), parseFloat(v.lat)]);
                const outlineCoords = [...imageCoords, imageCoords[0]];
                const imageSource = map.getSource(imageSourceId);
                const outlineSource = map.getSource(outlineSourceId);
                if (imageSource) {
                    const imageUrl = thumbnail ? preview : getRepresentativeImageUrl();
                    if (typeof imageSource.updateImage === 'function') {
                        imageSource.updateImage({ url: imageUrl, coordinates: imageCoords });
                    } else if (typeof imageSource.setCoordinates === 'function') {
                        imageSource.setCoordinates(imageCoords);
                    }
                }
                if (outlineSource) {
                    outlineSource.setData({
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [outlineCoords] }
                    });
                }
                if (map.getLayer(outlineLayerId)) {
                    map.setPaintProperty(outlineLayerId, 'line-color', fillColor);
                }
            } else {
                const sourceId = `card-polygon-${cardID}`;
                const fillLayerId = `card-polygon-fill-${cardID}`;
                const lineLayerId = `card-polygon-line-${cardID}`;
                const coords = vertices.map(v => [parseFloat(v.lng), parseFloat(v.lat)]);
                coords.push(coords[0]);

                const source = map.getSource(sourceId);
                if (source) {
                    source.setData({
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [coords] }
                    });
                }

                const fillOpacity = style?.fillOpacity ?? 0.2;
                if (map.getLayer(fillLayerId)) {
                    map.setPaintProperty(fillLayerId, 'fill-color', fillColor);
                    map.setPaintProperty(fillLayerId, 'fill-opacity', fillOpacity);
                }
                if (map.getLayer(lineLayerId)) {
                    map.setPaintProperty(lineLayerId, 'line-color', fillColor);
                }
            }
        }
    }, [formData.cardID, formData.location_type, formData.polygon_fill_color, getRepresentativeImageUrl, preview, props.cardID, restoreCardPolygonLayers, thumbnail]);

    const handlePolygonEditCancel = useCallback(() => {
        // If was converting from marker to polygon, revert location_type
        if (isConvertingToPolygon) {
            setFormData(prev => ({ ...prev, location_type: 'point' }));
            setIsConvertingToPolygon(false);
        }
        setIsEditingPolygon(false);
        restoreCardPolygonLayers();
    }, [restoreCardPolygonLayers, isConvertingToPolygon]);

    const handleLearnMoreEditStart = (e) => {
        e.stopPropagation();

        if (!props.isLoggedIn && !isLearnMoreOnboardingOpen) {
            setShowLoginPrompt(true);
            return;
        }

        const _viewerEmail = localStorage.getItem('email') || '';
        const _cardOwnerEmail = formData.email || '';
        const _isAdmin = (() => { try { return JSON.parse(localStorage.getItem('isAdmin')); } catch { return false; } })();
        if (!_isAdmin && _viewerEmail && _cardOwnerEmail && _viewerEmail !== _cardOwnerEmail) {
            alert("You don't have permission to edit this card. Only the card's creator or an admin can edit it.");
            return;
        }
        setLearnMoreBackup({ ...formData });
        setLearnMoreLinks(parseLinks(formData.link, formData.link_text));
        linkedArcgisItemsBackupRef.current = linkedArcgisItems.map(i => ({ ...i }));
        setSessionUploadedImageIDs([]);
        setSelectedAllImageIDs([]);
        setPendingDeletedImageIDs([]);
        setFormData((prev) => ({
            ...prev,
            original_username: prev.original_username || prev.username,
            original_email: prev.original_email || prev.email,
            original_title: prev.original_title || prev.title,
        }));
        isEditingRef.current = true;
        setIsLearnMoreEditMode(true);

        if (formData.cardID || props.cardID) {
            refreshCardImages().catch((error) => {
                console.error('Failed to refresh card images:', error);
            });
        }
    };

    const rollbackSessionUploads = async () => {
        if (sessionUploadedImageIDs.length === 0) return;

        for (const imageID of sessionUploadedImageIDs) {
            try {
                await api.delete(`/deleteCardImage/${imageID}`);
            } catch (error) {
                console.error('Failed to rollback uploaded image:', imageID, error);
            }
        }

        setSessionUploadedImageIDs([]);
    };

    const handleLearnMoreEditCancel = async (e) => {
        if (e?.stopPropagation) e.stopPropagation();
        if (isImageMutationLoading) return;

        // Clean up any active location selection
        cancelSelectLocation();

        setIsImageMutationLoading(true);
        await rollbackSessionUploads();

        if (learnMoreBackup) {
            setFormData(learnMoreBackup);
        }
        if (linkedArcgisItemsBackupRef.current !== null) {
            setLinkedArcgisItems(linkedArcgisItemsBackupRef.current);
            linkedArcgisItemsBackupRef.current = null;
        }

        isEditingRef.current = false;
        setIsLearnMoreEditMode(false);
        setPendingImageSlotIndex(null);
        setSelectedAllImageIDs([]);
        setPendingDeletedImageIDs([]);
        setIsImageMutationLoading(false);
    };

    const applyPendingImageDeletes = async () => {
        if (!pendingDeletedImageIDs.length) return;

        const uniqueIDs = [...new Set(pendingDeletedImageIDs)].filter((id) => Number.isInteger(id) && id > 0);
        if (!uniqueIDs.length) return;

        for (const imageID of uniqueIDs) {
            await api.delete(`/deleteCardImage/${imageID}`);
        }

        setSessionUploadedImageIDs((prev) => prev.filter((id) => !uniqueIDs.includes(id)));
        setPendingDeletedImageIDs([]);
        setSelectedAllImageIDs([]);
    };

    const applyImageReordering = async () => {
        const cardID = formData.cardID || props.cardID;
        const images = formData.images || [];
        
        if (!images.length || !cardID) return;

        // Extract imageIDs in current order, filtering out temporary records
        const imageOrder = images
            .map((img) => resolveImageServerID(img))
            .filter((id) => id !== null);

        if (!imageOrder.length) return;

        try {
            const response = await api.put(`/reorderCardImages?cardID=${cardID}`, imageOrder);
            console.log('Image reordering successful:', response.data);
        } catch (error) {
            const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
            console.error('Failed to reorder images:', errorMsg);
            alert(`Failed to save image order: ${errorMsg}`);
        }
    };

    const handleLearnMoreEditSave = async (e) => {
        e.stopPropagation();
        const serializedLink = serializeLinks(learnMoreLinks);
        const success = await saveEdits({
            skipReload: true,
            closeEditModal: false,
            linkOverride: { link: serializedLink, link_text: '' },
        });
        if (success) {
            try {
                await applyPendingImageDeletes();
            } catch (error) {
                console.error('Failed to apply pending image deletions:', error);
                alert('Some selected images could not be deleted. Please try saving again.');
            }
            try {
                await applyImageReordering();
            } catch (error) {
                console.error('Failed to apply image reordering:', error);
                alert('Warning: Image reordering may not have been saved.');
            }
            await refreshCardRecord();
            await refreshCardImages();
            setIsLearnMoreEditMode(false);
            setLearnMoreBackup(null);
            setSessionUploadedImageIDs([]);
            setSelectedAllImageIDs([]);
            setPendingDeletedImageIDs([]);
        }
    };

    // Compute whether there are unsaved changes in edit mode
    const hasUnsavedChanges = useMemo(() => {
        if (!isLearnMoreEditMode || !learnMoreBackup) return false;

        // Compare tracked formData fields
        const trackedFields = [
            'title', 'description', 'category', 'username', 'name',
            'latitude', 'longitude', 'location_type',
            'polygon_vertices', 'polygon_fill_color', 'polygon_line_style', 'polygon_fill_opacity',
            'website_link', 'thumbnail_link', 'files',
        ];
        for (const field of trackedFields) {
            if (JSON.stringify(formData[field]) !== JSON.stringify(learnMoreBackup[field])) return true;
        }

        // Compare images (order + identity)
        if (JSON.stringify((formData.images || []).map(i => i.imageID ?? i.id)) !==
            JSON.stringify((learnMoreBackup.images || []).map(i => i.imageID ?? i.id))) return true;

        // Compare links
        const backupLinks = parseLinks(learnMoreBackup.link, learnMoreBackup.link_text);
        if (JSON.stringify(learnMoreLinks) !== JSON.stringify(backupLinks)) return true;

        // Compare linked ArcGIS items
        const backup = linkedArcgisItemsBackupRef.current;
        if (backup !== null) {
            const currentIds = linkedArcgisItems.map(i => i.id).sort().join(',');
            const backupIds = backup.map(i => i.id).sort().join(',');
            if (currentIds !== backupIds) return true;
        }

        return false;
    }, [isLearnMoreEditMode, learnMoreBackup, formData, linkedArcgisItems, learnMoreLinks]);

    const handleLearnMoreClose = async (e) => {
        if (e?.stopPropagation) e.stopPropagation();

        if (isLearnMoreEditMode && hasUnsavedChanges) {
            const confirmed = window.confirm('You have unsaved changes. Discard them and close?');
            if (!confirmed) return;
        }

        if (isLearnMoreEditMode) {
            await handleLearnMoreEditCancel(e);
        }

        setIsAllImagesView(false);
        setIsModalOpen(false);
    };


    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setThumbnail(file);
            setPreview(URL.createObjectURL(file));
        }
    };

    const resolveImageUrl = (url) => {
        if (!url) return "/CEREO-logo.png";
        if (/^https?:\/\//i.test(url)) return url;

        const baseURL = (api.defaults.baseURL || "").replace(/\/$/, "");
        if (!baseURL) return url;

        return url.startsWith('/') ? `${baseURL}${url}` : `${baseURL}/${url}`;
    };

    const normalizeImageRecord = (image, fallbackId = 0) => {
        if (typeof image === 'string') {
            return {
                id: fallbackId,
                imageID: null,
                url: resolveImageUrl(image),
                alt: ''
            };
        }

        if (!image || typeof image !== 'object') {
            return {
                id: fallbackId,
                imageID: null,
                url: '/CEREO-logo.png',
                alt: ''
            };
        }

        return {
            ...image,
            id: image.id ?? image.imageID ?? image.imageId ?? fallbackId,
            imageID: image.imageID ?? image.imageId ?? image.id ?? null,
            url: resolveImageUrl(image.url || image.imageURL || image.thumbnail_link || ''),
            alt: image.alt || image.altText || ''
        };
    };

    const refreshCardImages = async (preferredIndex = null) => {
        const rawCardID = formData.cardID || props.cardID;
        const cardID = Number(rawCardID);
        if (!Number.isInteger(cardID) || cardID <= 0) return;

        const response = await api.get(`/cardImages/${cardID}`);
        const freshImages = (response.data?.images || []).map((img, idx) => normalizeImageRecord(img, idx));

        setFormData((prev) => ({
            ...prev,
            images: freshImages
        }));

        setCurrentImageIndex((prev) => {
            if (freshImages.length === 0) return 0;
            if (typeof preferredIndex === 'number') {
                return Math.max(0, Math.min(preferredIndex, freshImages.length - 1));
            }
            return Math.min(prev, freshImages.length - 1);
        });
    };

    const refreshCardRecord = async () => {
        const rawCardID = formData.cardID || props.cardID;
        const cardID = Number(rawCardID);
        if (!Number.isInteger(cardID) || cardID <= 0) return;

        try {
            const response = await api.get('/allCards');
            const cards = response?.data?.data || [];
            const latestCard = cards.find((card) => Number(card.cardID) === cardID);

            if (!latestCard) return;

            setFormData((prev) => ({
                ...prev,
                ...latestCard,
                files: latestCard.files || [],
                images: latestCard.images || prev.images || [],
                filesToUpload: []
            }));
        } catch (error) {
            console.error('Failed to refresh card data:', error);
        }
    };

    const handleLearnMoreGalleryTileClick = (e, image, slotIndex) => {
        e.stopPropagation();

        if (image) {
            openImagePreviewAtIndex(e, slotIndex);
            return;
        }

        if (!isLearnMoreEditMode || isImageMutationLoading) return;

        setPendingImageSlotIndex(slotIndex);
        if (learnMoreImageInputRef.current) {
            learnMoreImageInputRef.current.click();
        }
    };

    const handleLearnMoreImageUpload = async (e) => {
        e.stopPropagation();
        const file = e.target.files?.[0];
        e.target.value = '';

        if (!file) return;

        const cardID = formData.cardID || props.cardID;
        if (!cardID) {
            alert('Unable to add images because card ID is missing.');
            return;
        }

        setIsImageMutationLoading(true);
        try {
            const uploadFormData = new FormData();
            uploadFormData.append('cardID', cardID);
            uploadFormData.append('altText', file.name || `Card image ${(pendingImageSlotIndex ?? 0) + 1}`);
            uploadFormData.append('image', file);
            const uploadResponse = await api.post('/uploadCardImage', uploadFormData);
            const uploadedImageID = uploadResponse?.data?.imageID;

            if (uploadedImageID) {
                setSessionUploadedImageIDs((prev) => [...prev, uploadedImageID]);
            }

            await refreshCardImages(pendingImageSlotIndex);
        } catch (error) {
            console.error('Failed to upload card images:', error);
            alert('Failed to upload image.');
        } finally {
            setIsImageMutationLoading(false);
            setPendingImageSlotIndex(null);
        }
    };

    const handleLearnMoreImageDelete = async (e, image) => {
        e.stopPropagation();

        if (isImageMutationLoading) return;

        if (!image?.imageID) {
            alert('This image cannot be deleted because no image ID was found.');
            return;
        }

        if (!window.confirm('Delete this image?')) return;

        setIsImageMutationLoading(true);
        try {
            await api.delete(`/deleteCardImage/${image.imageID}`);
            setSessionUploadedImageIDs((prev) => prev.filter((id) => id !== image.imageID));
            await refreshCardImages();
        } catch (error) {
            console.error('Failed to delete card image:', error);
            alert('Failed to delete image.');
        } finally {
            setIsImageMutationLoading(false);
        }
    };

    const displayCardData = isLearnMoreEditMode && learnMoreBackup ? learnMoreBackup : formData;

    const cardThumbnailSrc =
        displayCardData.thumbnail_link && displayCardData.thumbnail_link.trim() !== ""
            ? resolveImageUrl(displayCardData.thumbnail_link)
            : "/CEREO-logo.png";

    const cardImageList = isImageCard
        ? [{ url: cardThumbnailSrc, id: 'card-representation', imageID: null, alt: 'Card representation' }]
        : displayCardData.images && Array.isArray(displayCardData.images) && displayCardData.images.length > 0
        ? displayCardData.images.map((img, idx) => normalizeImageRecord(img, idx))
        : [{ url: cardThumbnailSrc, id: 0 }];

    // Multi-image support: use images array if available, otherwise fall back to single thumbnail
    const imageList = isImageCard
        ? (formData.images && Array.isArray(formData.images) && formData.images.length > 0
            ? formData.images.map((img, idx) => normalizeImageRecord(img, idx))
            : [])
        : formData.images && Array.isArray(formData.images) && formData.images.length > 0
        ? formData.images.map((img, idx) => normalizeImageRecord(img, idx))
        : [{ url: cardThumbnailSrc, id: 0 }];

    const allImagesList = imageList;

    const resolveImageServerID = (image) => {
        const imageID = Number(image?.imageID ?? image?.imageId ?? null);
        return Number.isInteger(imageID) && imageID > 0 ? imageID : null;
    };

    const toggleAllImageSelection = (e, image) => {
        e.stopPropagation();
        const imageID = resolveImageServerID(image);
        if (!imageID) return;

        setSelectedAllImageIDs((prev) =>
            prev.includes(imageID) ? prev.filter((id) => id !== imageID) : [...prev, imageID]
        );
    };

    const handleMoveImageUp = (e, index) => {
        e.stopPropagation();
        if (index <= 0) return;

        setFormData((prev) => {
            const newImages = [...(prev.images || [])];
            [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
            return {
                ...prev,
                images: newImages
            };
        });
    };

    const handleMoveImageDown = (e, index) => {
        e.stopPropagation();
        const images = formData.images || [];
        if (index >= images.length - 1) return;

        setFormData((prev) => {
            const newImages = [...(prev.images || [])];
            [newImages[index], newImages[index + 1]] = [newImages[index + 1], newImages[index]];
            return {
                ...prev,
                images: newImages
            };
        });
    };

    const handleDeleteSelectedAllImages = (e) => {
        e.stopPropagation();

        if (!selectedAllImageIDs.length) {
            alert('Please select image(s) first.');
            return;
        }

        if (!window.confirm(`Delete ${selectedAllImageIDs.length} selected image(s)?`)) return;

        const selectedSet = new Set(selectedAllImageIDs);
        const isSelectedImage = (img) => {
            const imageID = resolveImageServerID(img);
            return imageID ? selectedSet.has(imageID) : false;
        };

        setPendingDeletedImageIDs((prev) => [...new Set([...prev, ...selectedAllImageIDs])]);

        setFormData((prev) => ({
            ...prev,
            images: (prev.images || []).filter((img) => !isSelectedImage(normalizeImageRecord(img)))
        }));

        setSelectedAllImageIDs([]);
    };

    const currentImage = imageList[currentImageIndex] || imageList[0] || { url: cardThumbnailSrc, id: 'fallback-preview', alt: 'Card preview' };
    const cardCurrentImage = cardImageList[currentImageIndex] || cardImageList[0] || { url: cardThumbnailSrc, id: 'fallback-card', alt: 'Card thumbnail' };
    const hasMultipleImages = cardImageList.length > 1;
    const isCardCurrentImageDefault = (() => {
        const url = cardCurrentImage?.url;
        if (!url || typeof url !== 'string') return true;
        if (url === '/CEREO-logo.png' || url.endsWith('/CEREO-logo.png')) return true;
        if (url.includes('default_cereo_thumbnail')) return true;
        return false;
    })();
    const totalIndicatorCount = cardImageList.length;
    const visibleIndicatorCount = Math.min(5, totalIndicatorCount);
    const indicatorWindowStart = Math.max(
        0,
        Math.min(currentImageIndex - 2, totalIndicatorCount - visibleIndicatorCount)
    );
    const visibleIndicatorIndexes = Array.from(
        { length: visibleIndicatorCount },
        (_, idx) => indicatorWindowStart + idx
    );
    const nonActiveVisibleIndexes = visibleIndicatorIndexes.filter((idx) => idx !== currentImageIndex);
    const normalNeighborIndexes = new Set(
        nonActiveVisibleIndexes
            .slice()
            .sort((a, b) => {
                const distanceDiff = Math.abs(a - currentImageIndex) - Math.abs(b - currentImageIndex);
                if (distanceDiff !== 0) return distanceDiff;
                return a - b;
            })
            .slice(0, 2)
    );
    const learnMoreGalleryImages = (Array.isArray(formData.images) && formData.images.length > 0)
        ? formData.images.map((img, idx) => normalizeImageRecord(img, idx)).slice(0, 5)
        : (!isImageCard && displayCardData.thumbnail_link && displayCardData.thumbnail_link.trim() !== ""
            ? [{ url: cardThumbnailSrc, id: 0, imageID: null }]
            : []);
    const learnMoreGallerySlots = Array.from({ length: 5 }, (_, index) => learnMoreGalleryImages[index] || null);

    const goToPrevImage = (e) => {
        e.stopPropagation();
        setCurrentImageIndex((prev) => (prev === 0 ? cardImageList.length - 1 : prev - 1));
    };

    const goToNextImage = (e) => {
        e.stopPropagation();
        setCurrentImageIndex((prev) => (prev === cardImageList.length - 1 ? 0 : prev + 1));
    };

    const goToImageByIndex = (e, index) => {
        e.stopPropagation();
        setCurrentImageIndex(index);
    };

    const openImagePreviewAtIndex = (e, index) => {
        e.stopPropagation();
        setCurrentImageIndex(index);
        setIsImagePreviewOpen(true);
    };

    return (
        <div
            className={`card ${props.isSelectedFromMap ? 'card--map-selected' : ''}`}
            data-onboarding-target={props.onboardingTargetPrefix ? props.onboardingTargetPrefix : undefined}
            onClick={handleLearnMore}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLearnMore(e); }}
        >
            {/* Favorite Heart Icon */}
            <span
                className={`favorite-icon ${isFavorited ? 'filled' : ''}`}
                data-onboarding-target={props.onboardingTargetPrefix ? `${props.onboardingTargetPrefix}-actions` : undefined}
                onClick={handleFavoriteClick}
                title={isFavorited ? "Remove from favorites" : "Add to favorites"}
            >
                <FontAwesomeIcon icon={isFavorited ? solidHeart : regularHeart} />
            </span>

            <div className="card-thumbnail-container">
                <img
                    src={cardCurrentImage.url}
                    alt={cardCurrentImage.alt || "Card Thumbnail"}
                    className={`card-thumbnail${isCardCurrentImageDefault ? '' : ' card-thumbnail--cover'}`}
                    onClick={handleOpenImagePreview}
                    onError={(e) => { e.target.onerror = null; e.target.src = '/CEREO-logo.png'; }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpenImagePreview(e); }}
                    role="button"
                    tabIndex={0}
                />
                
                {/* Navigation arrows (only show if multiple images) */}
                {hasMultipleImages && (
                    <>
                        <button
                            className="card-image-nav card-image-nav-prev"
                            onClick={goToPrevImage}
                            title="Previous image"
                            aria-label="Previous image"
                        >
                            ❮
                        </button>
                        <button
                            className="card-image-nav card-image-nav-next"
                            onClick={goToNextImage}
                            title="Next image"
                            aria-label="Next image"
                        >
                            ❯
                        </button>
                    </>
                )}
                
                {/* Image indicator dots (only show if multiple images) */}
                {hasMultipleImages && (
                    <div className="card-image-indicators">
                        {visibleIndicatorIndexes.map((imageIndex) => (
                            <span
                                key={`dot-${imageIndex}`}
                                className={`card-image-dot ${imageIndex === currentImageIndex ? 'active' : ''} ${imageIndex !== currentImageIndex && !normalNeighborIndexes.has(imageIndex) ? 'small' : ''}`}
                                aria-hidden="true"
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="card-title-row">
                <h2 className="card-title">{displayCardData.title}</h2>
            </div>
            <div className="card-meta-row">
                <p className="card-meta">{displayCardData.category || "Uncategorized"}</p>
                <button
                    className="card-meta-zoom-btn"
                    data-onboarding-target={props.onboardingTargetPrefix ? `${props.onboardingTargetPrefix}-actions` : undefined}
                    onClick={handleZoom}
                    title="Locate on map"
                    aria-label="Locate on map"
                >
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                </button>
            </div>

            {/* Floating hint when selecting location from learn-more */}
            {isSelectingLocation && ReactDOM.createPortal(
                <div className="location-select-hint">
                    <span>Click on the map to select a location</span>
                    <button type="button" onClick={cancelSelectLocation}>Cancel</button>
                </div>,
                document.body
            )}

            {/* Learn More Modal */}
            <Modal
                isOpen={isLearnMoreModalVisible}
                onRequestClose={handleLearnMoreClose}
                shouldCloseOnOverlayClick={!isLearnMoreOnboardingOpen}
                className="Modal Modal--learn-more"
                overlayClassName="ModalOverlay ModalOverlay--learn-more"
            >
                <div
                    className={`learn-more-modal-shell${isLearnMoreOnboardingOpen ? ' onboarding-locked' : ''}`}
                    data-onboarding-target="learn-more-modal-shell"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyUp={(e) => e.stopPropagation()}
                >
                <div className="learn-more-modal-toolbar" data-onboarding-target="learn-more-toolbar">
                    <div className="learn-more-modal-toolbar-left">
                        {isLearnMoreEditMode ? (
                            <div className="learn-more-modal-toolbar-actions">
                                <button
                                    className="learn-more-modal-toolbar-btn save"
                                    onClick={handleLearnMoreEditSave}
                                    disabled={loading || isImageMutationLoading}
                                >
                                    {loading ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                    className="learn-more-modal-toolbar-btn cancel"
                                    onClick={async (e) => {
                                        if (hasUnsavedChanges) {
                                            const confirmed = window.confirm('You have unsaved changes. Discard them?');
                                            if (!confirmed) return;
                                        }
                                        await handleLearnMoreEditCancel(e);
                                    }}
                                    disabled={loading || isImageMutationLoading}
                                >
                                    Cancel
                                </button>
                                {hasUnsavedChanges && (
                                    <span className="learn-more-unsaved-badge">You have unsaved changes</span>
                                )}
                            </div>
                        ) : (
                            <button
                                className="learn-more-modal-edit-btn"
                                onClick={handleLearnMoreEditStart}
                                aria-label="Edit card in Learn More modal"
                                title="Edit"
                            >
                                <FontAwesomeIcon icon={faPenToSquare} />
                            </button>
                        )}

                        <button
                            className="learn-more-modal-download-btn"
                            onClick={handleDownloadPdf}
                            aria-label="Download card as PDF"
                            title="Download as PDF"
                        >
                            <FontAwesomeIcon icon={faDownload} />
                        </button>

                        <button
                            className="learn-more-modal-delete-btn"
                            onClick={handleDelete}
                            aria-label="Delete card"
                            title="Delete card"
                        >
                            <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                    </div>

                    <div className="learn-more-modal-toolbar-right">
                        <button
                            className="learn-more-modal-help-btn"
                            onClick={() => window.open('/user-manual?section=detail-view', '_blank')}
                            aria-label="Open card detail help"
                            title="Help"
                        >
                            <FontAwesomeIcon icon={faQuestionCircle} />
                        </button>
                        <button
                            className="learn-more-modal-onboarding-btn"
                            onClick={() => setIsLearnMoreOnboardingOpen(true)}
                            aria-label="Start detail view onboarding"
                            title="Onboarding"
                        >
                            <FontAwesomeIcon icon={faCirclePlay} />
                        </button>
                        <button
                            className="learn-more-modal-close"
                            onClick={handleLearnMoreClose}
                            aria-label="Close learn more modal"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="learn-more-modal-body" data-onboarding-target="learn-more-modal-content">
                    <input
                        ref={learnMoreImageInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLearnMoreImageUpload}
                        style={{ display: 'none' }}
                    />

                    {isAllImagesView ? (
                        <div className="learn-more-all-images-view">
                            <div className="learn-more-all-images-header">
                                <button
                                    type="button"
                                    className="learn-more-all-images-back-link"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsAllImagesView(false);
                                    }}
                                >
                                    ← Back to Learn More
                                </button>
                                <p className="learn-more-all-images-count">
                                    {`Showing ${allImagesList.length} image${allImagesList.length === 1 ? '' : 's'}`}
                                </p>
                            </div>

                            <div className="learn-more-all-images-list">
                                {allImagesList.map((image, index) => (
                                    <div className="learn-more-all-image-item" key={`all-image-${image.imageID || image.id || index}`}>
                                        {isLearnMoreEditMode && (
                                            <div className="learn-more-all-image-sort-controls">
                                                <button
                                                    type="button"
                                                    className="learn-more-all-image-sort-btn learn-more-all-image-sort-up"
                                                    onClick={(e) => handleMoveImageUp(e, index)}
                                                    disabled={index === 0}
                                                    title="Move image up"
                                                    aria-label="Move image up"
                                                >
                                                    ▲
                                                </button>
                                                <button
                                                    type="button"
                                                    className="learn-more-all-image-sort-btn learn-more-all-image-sort-down"
                                                    onClick={(e) => handleMoveImageDown(e, index)}
                                                    disabled={index === allImagesList.length - 1}
                                                    title="Move image down"
                                                    aria-label="Move image down"
                                                >
                                                    ▼
                                                </button>
                                            </div>
                                        )}

                                        <button
                                            type="button"
                                            className="learn-more-all-image-btn"
                                            onClick={(e) => openImagePreviewAtIndex(e, index)}
                                            title={`Open image ${index + 1}`}
                                        >
                                            <img
                                                className="learn-more-all-image"
                                                src={image.url}
                                                alt={image.alt || `Card image ${index + 1}`}
                                            />
                                        </button>

                                        {isLearnMoreEditMode && resolveImageServerID(image) && (
                                            <button
                                                type="button"
                                                className={`learn-more-all-image-select ${selectedAllImageIDs.includes(resolveImageServerID(image)) ? 'is-selected' : ''}`}
                                                onClick={(e) => toggleAllImageSelection(e, image)}
                                                title={selectedAllImageIDs.includes(resolveImageServerID(image)) ? 'Unselect image' : 'Select image'}
                                                aria-label={selectedAllImageIDs.includes(resolveImageServerID(image)) ? 'Unselect image' : 'Select image'}
                                                aria-pressed={selectedAllImageIDs.includes(resolveImageServerID(image)) ? 'true' : 'false'}
                                            >
                                                <span className="learn-more-all-image-select-mark" aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {isLearnMoreEditMode && (
                                <div className="learn-more-all-images-actions">
                                    <button
                                        type="button"
                                        className="learn-more-all-images-delete-selected-btn"
                                        onClick={handleDeleteSelectedAllImages}
                                        disabled={isImageMutationLoading || selectedAllImageIDs.length === 0}
                                    >
                                        {`Delete Selected (${selectedAllImageIDs.length})`}
                                    </button>
                                    <button
                                        type="button"
                                        className="learn-more-modal-toolbar-btn save"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setPendingImageSlotIndex(null);
                                            learnMoreImageInputRef.current?.click();
                                        }}
                                        disabled={isImageMutationLoading}
                                    >
                                        {isImageMutationLoading ? 'Uploading...' : 'Add New Image'}
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>

                    <div data-onboarding-target="learn-more-image-area">

                    <div className="learn-more-gallery">
                        <button
                            type="button"
                            className={`learn-more-gallery-tile learn-more-gallery-tile--primary${!learnMoreGallerySlots[0] ? ` learn-more-gallery-tile--placeholder${isLearnMoreEditMode ? ' learn-more-gallery-tile--placeholder-editable' : ''}` : ''}`}
                            onClick={(e) => handleLearnMoreGalleryTileClick(e, learnMoreGallerySlots[0], 0)}
                            title={learnMoreGallerySlots[0] ? 'Open image preview' : (isLearnMoreEditMode ? 'Click to add image' : 'No image available')}
                        >
                            {learnMoreGallerySlots[0] ? (
                                <img
                                    className="learn-more-gallery-image"
                                    src={learnMoreGallerySlots[0].url}
                                    alt={learnMoreGallerySlots[0].alt || 'Card image 1'}
                                />
                            ) : (
                                <span className="learn-more-gallery-placeholder">No Image</span>
                            )}
                            {isLearnMoreEditMode && learnMoreGallerySlots[0]?.imageID && (
                                <span
                                    className="learn-more-gallery-delete-btn"
                                    onClick={(e) => handleLearnMoreImageDelete(e, learnMoreGallerySlots[0])}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            handleLearnMoreImageDelete(e, learnMoreGallerySlots[0]);
                                        }
                                    }}
                                    title="Delete image"
                                    aria-label="Delete image"
                                    role="button"
                                    tabIndex={0}
                                >
                                    ×
                                </span>
                            )}
                        </button>

                        <div className="learn-more-gallery-side-grid">
                            {learnMoreGallerySlots.slice(1).map((image, index) => (
                                <button
                                    key={`learn-more-gallery-slot-${index + 1}`}
                                    type="button"
                                    className={`learn-more-gallery-tile ${image ? '' : `learn-more-gallery-tile--placeholder${isLearnMoreEditMode ? ' learn-more-gallery-tile--placeholder-editable' : ''}`}`}
                                    onClick={(e) => handleLearnMoreGalleryTileClick(e, image, index + 1)}
                                    title={image ? `Open image ${index + 2}` : (isLearnMoreEditMode ? `Click to add image ${index + 2}` : 'No image available')}
                                >
                                    {image ? (
                                        <img
                                            className="learn-more-gallery-image"
                                            src={image.url}
                                            alt={image.alt || `Card image ${index + 2}`}
                                        />
                                    ) : (
                                        <span className="learn-more-gallery-placeholder">No Image</span>
                                    )}
                                    {isLearnMoreEditMode && image?.imageID && (
                                        <span
                                            className="learn-more-gallery-delete-btn"
                                            onClick={(e) => handleLearnMoreImageDelete(e, image)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    handleLearnMoreImageDelete(e, image);
                                                }
                                            }}
                                            title="Delete image"
                                            aria-label="Delete image"
                                            role="button"
                                            tabIndex={0}
                                        >
                                            ×
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        className="learn-more-see-all-images-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsAllImagesView(true);
                        }}
                    >
                        {`See all ${allImagesList.length} image${allImagesList.length === 1 ? '' : 's'}`}
                    </button>
                    </div>

                    <div data-onboarding-target="learn-more-text-area">

                    <div className="learn-more-modal-title-section">
                        {isLearnMoreEditMode ? (
                            <>
                                <input
                                    className="learn-more-inline-input learn-more-inline-title"
                                    type="text"
                                    name="title"
                                    value={formData.title || ''}
                                    onChange={handleInputChange}
                                />
                                <select
                                    className="learn-more-inline-input"
                                    name="category"
                                    value={formData.category || ''}
                                    onChange={handleInputChange}
                                >
                                    <option value="">Select a Category</option>
                                    {CARD_CATEGORIES.map((categoryOption) => (
                                        <option key={categoryOption} value={categoryOption}>
                                            {categoryOption}
                                        </option>
                                    ))}
                                </select>
                            </>
                        ) : (
                            <>
                                <h2>{formData.title}</h2>
                                <p className="learn-more-modal-subtitle">{formData.category || "Uncategorized"}</p>
                            </>
                        )}
                    </div>

                    {isLearnMoreEditMode ? (
                        <>
                            <div className="learn-more-fields-grid">
                                <div className="learn-more-field-cell">
                                    <p><strong>Author:</strong></p>
                                    <input className="learn-more-inline-input" type="text" name="name" value={formData.name || ''} onChange={handleInputChange} />
                                </div>
                                <div className="learn-more-field-cell">
                                    <p><strong>Card Creator:</strong></p>
                                    <input className="learn-more-inline-input learn-more-inline-readonly" type="text" name="username" value={formData.username || ''} readOnly disabled title="Card Creator cannot be edited" />
                                </div>
                                <div className="learn-more-field-cell">
                                    <p><strong>Email:</strong></p>
                                    <input className="learn-more-inline-input" type="email" name="email" value={formData.email || ''} onChange={handleInputChange} />
                                </div>
                                <div className="learn-more-field-cell">
                                    <p><strong>Funding:</strong></p>
                                    <input className="learn-more-inline-input" type="text" name="funding" value={formData.funding || ''} onChange={handleInputChange} />
                                </div>
                                <div className="learn-more-field-cell">
                                    <p><strong>Organization:</strong></p>
                                    <input className="learn-more-inline-input" type="text" name="org" value={formData.org || ''} onChange={handleInputChange} />
                                </div>
                                {!isOverlayCard && (
                                    <div className="learn-more-field-cell learn-more-coordinate-cell">
                                        <p><strong>Coordinates:</strong></p>
                                        <div className="learn-more-coordinate-row">
                                            <div className="learn-more-coordinate-item">
                                                <span className="learn-more-coordinate-label">Latitude</span>
                                                <input className="learn-more-inline-input" type="number" step="any" name="latitude" value={formData.latitude || ''} onChange={handleInputChange} />
                                            </div>
                                            <div className="learn-more-coordinate-item">
                                                <span className="learn-more-coordinate-label">Longitude</span>
                                                <input className="learn-more-inline-input" type="number" step="any" name="longitude" value={formData.longitude || ''} onChange={handleInputChange} />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <p><strong>Links:</strong></p>
                            {learnMoreLinks.map((linkItem, idx) => (
                                <div key={idx} className="learn-more-link-row">
                                    <input
                                        className="learn-more-inline-input"
                                        type="text"
                                        placeholder="URL"
                                        value={linkItem.url}
                                        onChange={e => setLearnMoreLinks(learnMoreLinks.map((l, i) => i === idx ? { ...l, url: e.target.value } : l))}
                                    />
                                    <input
                                        className="learn-more-inline-input learn-more-link-text-input"
                                        type="text"
                                        placeholder="Display text (optional)"
                                        value={linkItem.text}
                                        onChange={e => setLearnMoreLinks(learnMoreLinks.map((l, i) => i === idx ? { ...l, text: e.target.value } : l))}
                                    />
                                    {learnMoreLinks.length > 1 && (
                                        <button
                                            type="button"
                                            className="learn-more-link-remove-btn"
                                            onClick={() => setLearnMoreLinks(learnMoreLinks.filter((_, i) => i !== idx))}
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                className="learn-more-modal-toolbar-btn cancel learn-more-add-link-btn"
                                onClick={() => setLearnMoreLinks([...learnMoreLinks, { url: '', text: '' }])}
                            >
                                + Add More Links
                            </button>

                            <p><strong>Description:</strong></p>
                            <textarea className="learn-more-inline-textarea" name="description" value={formData.description || ''} onChange={handleInputChange} />

                            <p><strong>Tags:</strong></p>
                            <input className="learn-more-inline-input" type="text" name="tags" value={formData.tags || ''} onChange={handleInputChange} />

                            <p><strong>Visibility:</strong></p>
                            <select
                                className="learn-more-inline-input"
                                value={formData.is_public !== false ? "true" : "false"}
                                onChange={(e) => setFormData(prev => ({ ...prev, is_public: e.target.value !== "false" }))}
                            >
                                <option value="true">Public (visible to everyone)</option>
                                <option value="false">Private (only visible to me)</option>
                            </select>

                            <div data-onboarding-target="learn-more-coordinates-polygon">
                                {isOverlayCard ? (
                                    <button type="button" className="learn-more-select-location-btn" onClick={handleEditPolygon}>
                                        {isImageCard ? 'Edit Image' : 'Edit Polygon'}
                                    </button>
                                ) : (
                                    <div className="learn-more-location-btn-group">
                                        <button type="button" className="learn-more-select-location-btn" onClick={handleSelectLocation}>
                                            Select Location
                                        </button>
                                        <button type="button" className="learn-more-select-location-btn learn-more-change-to-polygon-btn" onClick={handleChangeToPolygon}>
                                            Change to Polygon
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="learn-more-fields-grid">
                                <p><strong>Author:</strong> {formData.name}</p>
                                <p><strong>Card Creator:</strong> {formData.username}</p>
                                <p><strong>Email:</strong> {formData.email}</p>
                                <p><strong>Funding:</strong> {formData.funding || 'N/A'}</p>
                                <p><strong>Organization:</strong> {formData.org || 'N/A'}</p>
                                {!isOverlayCard && (
                                    <p className="learn-more-coordinate-readonly">
                                        <strong>Latitude:</strong> {formData.latitude}
                                        <span className="learn-more-coordinate-separator"> | </span>
                                        <strong>Longitude:</strong> {formData.longitude}
                                    </p>
                                )}
                            </div>
                            <div className="learn-more-links-view">
                                <strong>Links:</strong>
                                {(() => {
                                    const links = parseLinks(formData.link, formData.link_text).filter(l => l.url.trim() !== '');
                                    if (links.length === 0) return <span> N/A</span>;
                                    return (
                                        <ul className="learn-more-links-list">
                                            {links.map((l, i) => (
                                                <li key={i}>
                                                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                                                        {l.text || l.url}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    );
                                })()}
                            </div>
                            <p className="learn-more-modal-description"><strong>Description:</strong> {formData.description}</p>
                            <p><strong>Tags:</strong> {formData.tags}</p>
                            <p><strong>Visibility:</strong> {formData.is_public !== false ? 'Public' : 'Private (only visible to you)'}</p>
                        </>
                    )}

                    {/* Files Section */}
                    {isLearnMoreEditMode ? (
                        <div className="learn-more-files-edit-section">
                            <p><strong>Attached Files:</strong></p>
                            {formData.files && formData.files.length > 0 ? (
                                <ul className="learn-more-files-edit-list">
                                    {formData.files.map((file, idx) => (
                                        <li key={file.fileid || idx} className="learn-more-file-edit-item">
                                            <span className="learn-more-file-edit-name">
                                                {file.filename || `File ${idx + 1}`}
                                            </span>
                                            <button
                                                type="button"
                                                className="learn-more-file-edit-delete-btn"
                                                onClick={async () => {
                                                    if (!window.confirm(`Delete file "${file.filename}"?`)) return;
                                                    try {
                                                        await api.delete(`/deleteFile?fileID=${file.fileid}`);
                                                        const filterOut = (f) => f.fileid !== file.fileid;
                                                        setFormData((prev) => ({ ...prev, files: prev.files.filter(filterOut) }));
                                                        setLearnMoreBackup((prev) => prev ? { ...prev, files: (prev.files || []).filter(filterOut) } : prev);
                                                    } catch (err) {
                                                        console.error('Error deleting file:', err);
                                                        alert('Failed to delete file.');
                                                    }
                                                }}
                                            >
                                                ×
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="learn-more-no-files">No files attached.</p>
                            )}
                            <label className="learn-more-add-files-label">
                                Add Files:
                                <input
                                    type="file"
                                    multiple
                                    onChange={(e) => {
                                        const selectedFiles = Array.from(e.target.files);
                                        setFormData((prev) => ({ ...prev, filesToUpload: selectedFiles }));
                                    }}
                                />
                            </label>
                            {formData.filesToUpload && formData.filesToUpload.length > 0 && (
                                <p className="learn-more-staged-files">
                                    {formData.filesToUpload.length} file(s) staged for upload
                                </p>
                            )}
                        </div>
                    ) : (
                        formData.files && formData.files.length > 0 && (
                            <div className="file-list learn-more-file-list">
                                <h3>Downloadable Files:</h3>
                                <ul>
                                    {formData.files.map((file, idx) => (
                                        <li key={file.fileid || idx}>
                                            <a
                                                href={file.file_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {file.filename || `Download ${file.fileextension}`}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )
                    )}

                    {/* Linked ArcGIS Services/Layers Section */}
                    {(isLearnMoreEditMode || linkedArcgisItems.length > 0) && (
                    <div className="learn-more-arcgis-links-section" data-onboarding-target="learn-more-arcgis-section">
                        <p><strong>Linked ArcGIS Services/Layers:</strong></p>
                        {linkedArcgisItems.length === 0 ? (
                            <p className="learn-more-no-arcgis-links">No linked ArcGIS items.</p>
                        ) : (
                            <ul className="learn-more-arcgis-links-list">
                                {linkedArcgisItems.map(item => {
                                    const stateLabel = ARCGIS_STATE_FULL_NAMES[item.state_code] || item.state_code;
                                    const isServiceLevel = item.item_type === 'service';
                                    const serviceLabel = ARCGIS_SERVICE_LABEL_BY_KEY[item.service_key] || item.service_key;
                                    const isLayerChecked = !!linkedArcgisChecked[item.id];

                                    // Resolve legend image for this item
                                    const legendImg = (() => {
                                        if (item.layer_id == null) return null;
                                        const legend = arcgisLegends[item.service_key];
                                        if (!legend?.layers) return null;
                                        const legendLayer = legend.layers.find(l => l.layerId === item.layer_id);
                                        if (!legendLayer?.legend?.length) return null;
                                        const entries = legendLayer.legend;
                                        let entry;
                                        if (item.sublayer_index != null && entries[item.sublayer_index]) {
                                            entry = entries[item.sublayer_index];
                                        } else if (entries.length === 1) {
                                            entry = entries[0];
                                        } else {
                                            return null;
                                        }
                                        if (!entry.imageData || !entry.contentType) return null;
                                        return `data:${entry.contentType};base64,${entry.imageData}`;
                                    })();

                                    return (
                                        <li key={item.id} className="learn-more-arcgis-link-item">
                                            <label className="learn-more-arcgis-layer-toggle-label" title="Show/hide this layer on the map">
                                                <input
                                                    type="checkbox"
                                                    className="learn-more-arcgis-layer-toggle-cb"
                                                    checked={isLayerChecked}
                                                    onChange={() => {
                                                        const nowChecked = !isLayerChecked;
                                                        setLinkedArcgisChecked(prev => ({ ...prev, [item.id]: nowChecked }));
                                                        window.dispatchEvent(new CustomEvent('arcgis-layer-toggle', {
                                                            detail: {
                                                                serviceKey: item.service_key,
                                                                layerId: item.layer_id,
                                                                checked: nowChecked,
                                                            }
                                                        }));
                                                    }}
                                                />
                                            </label>
                                            <span className="learn-more-arcgis-link-row">
                                                <span className="learn-more-arcgis-row-text">{stateLabel}</span>
                                                <span className="learn-more-arcgis-row-sep"> › </span>
                                                <span className="learn-more-arcgis-row-text">{item.folder_name}</span>
                                                {!isServiceLevel && (
                                                    <>
                                                        <span className="learn-more-arcgis-row-sep"> › </span>
                                                        <span className="learn-more-arcgis-row-text">{serviceLabel}</span>
                                                    </>
                                                )}
                                                <span className="learn-more-arcgis-row-sep"> › </span>
                                                {legendImg && (
                                                    <img
                                                        src={legendImg}
                                                        alt=""
                                                        className="learn-more-arcgis-legend-img"
                                                    />
                                                )}
                                                <span className="learn-more-arcgis-row-text learn-more-arcgis-row-name">{item.display_name}</span>
                                            </span>
                                            <button
                                                type="button"
                                                className="learn-more-arcgis-goto-btn"
                                                onClick={() => {
                                                    window.dispatchEvent(new CustomEvent('open-arcgis-panel', {
                                                        detail: {
                                                            serviceKey: item.service_key,
                                                            layerId: item.layer_id,
                                                            stateCode: item.state_code,
                                                            folderName: item.folder_name,
                                                        }
                                                    }));
                                                }}
                                                title="Open in ArcGIS Upload Panel"
                                            >
                                                ›
                                            </button>
                                            {isLearnMoreEditMode && (
                                                <button
                                                    type="button"
                                                    className="learn-more-arcgis-link-delete-btn"
                                                    title="Remove link"
                                                    onClick={async () => {
                                                        try {
                                                            await api.delete(`/cardArcGISLinks/${item.id}`);
                                                            setLinkedArcgisItems(prev => prev.filter(i => i.id !== item.id));
                                                        } catch (err) {
                                                            console.error('Failed to remove ArcGIS link:', err);
                                                        }
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {isLearnMoreEditMode && (
                            <button
                                type="button"
                                className="learn-more-add-arcgis-btn"
                                onClick={() => setIsArcgisPickerOpen(true)}
                            >
                                + Add ArcGIS Item
                            </button>
                        )}
                    </div>
                    )}

                    {/* ArcGIS Picker Modal */}
                    {isArcgisPickerOpen && (
                        <ArcGISPickerModal
                            onAdd={async (links) => {
                                const cardId = formData.cardID;
                                if (!cardId) return;
                                const newItems = [];
                                for (const link of links) {
                                    try {
                                        const res = await api.post('/cardArcGISLinks', { card_id: cardId, ...link });
                                        newItems.push({ id: res.data.id, card_id: cardId, ...link });
                                    } catch (err) {
                                        console.error('Failed to add ArcGIS link:', err);
                                    }
                                }
                                if (newItems.length > 0) {
                                    setLinkedArcgisItems(prev => [...prev, ...newItems]);
                                }
                                setIsArcgisPickerOpen(false);
                            }}
                            onClose={() => setIsArcgisPickerOpen(false)}
                        />
                    )}
                    </div>
                        </>
                    )}

                    <p className="learn-more-modal-created-date" style={{ marginTop: '1.5rem', color: '#888', fontSize: '0.9rem', textAlign: 'right' }}>
                        <strong>Created:</strong> {formData.date ? new Date(formData.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
                    </p>
                </div>

                </div>
            </Modal>

            <LearnMoreOnboarding
                isOpen={isLearnMoreOnboardingOpen}
                onClose={() => setIsLearnMoreOnboardingOpen(false)}
                isModalOpen={isLearnMoreModalVisible}
                onStepChange={setLearnMoreOnboardingStep}
            />

            <Modal
                isOpen={isImagePreviewOpen}
                onRequestClose={() => setIsImagePreviewOpen(false)}
                shouldCloseOnOverlayClick={false}
                className="Modal Modal--image-preview"
                overlayClassName="ModalOverlay ModalOverlay--image-preview"
            >
              <div
                className="image-preview-shell"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                    className="image-preview-close"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsImagePreviewOpen(false);
                    }}
                    aria-label="Close image preview"
                >
                    ×
                </button>
                {hasMultipleImages && (
                    <button className="image-preview-nav image-preview-nav-prev" onClick={goToPrevImage} aria-label="Previous image">&#8249;</button>
                )}
                <img src={currentImage.url} alt="Card enlarged preview" className="image-preview-content" onError={(e) => { e.target.onerror = null; e.target.src = '/CEREO-logo.png'; }} />
                {hasMultipleImages && (
                    <button className="image-preview-nav image-preview-nav-next" onClick={goToNextImage} aria-label="Next image">&#8250;</button>
                )}
                {hasMultipleImages && (
                    <div className="image-preview-indicators">
                        {cardImageList.map((img, idx) => (
                            <button
                                key={img.id ?? idx}
                                className={`image-preview-bar${idx === currentImageIndex ? ' active' : ''}`}
                                onClick={(e) => goToImageByIndex(e, idx)}
                                aria-label={`Go to image ${idx + 1}`}
                            />
                        ))}
                    </div>
                )}
              </div>
            </Modal>

            {/* Edit/Create Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onRequestClose={() => {}}
                shouldCloseOnOverlayClick={false}
                shouldCloseOnEsc={false}
                className="Modal"
            >
                <h2>{formData.cardID ? "Edit Card" : "Create Card"}</h2>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const serializedLink = serializeLinks(editFormLinks);
                    saveEdits({ linkOverride: { link: serializedLink, link_text: '' } });
                }}>
                    <label>Card Creator:
                        <input type="text" name="username" value={formData.username || ''} readOnly required title="Card Creator cannot be edited" />
                    </label>
                    <label>Author:
                        <input type="text" name="name" value={formData.name || ''} onChange={handleInputChange} required />
                    </label>
                    <label>
                        Full Name:
                        <input
                            type="text"
                            name="name"
                            value={formData.name || ""}
                            onChange={handleInputChange}
                            required
                        />
                    </label>
                    <label>
                        Email:
                        <input
                            type="email"
                            name="email"
                            value={formData.email || ""}
                            onChange={handleInputChange}
                            required
                        />
                    </label>
                    <label>
                        Title:
                        <input
                            type="text"
                            name="title"
                            value={formData.title || ""}
                            onChange={handleInputChange}
                            required
                        />
                    </label>
                    <label>
                        Description:
                        <textarea
                            name="description"
                            value={formData.description || ""}
                            onChange={handleInputChange}
                        />
                    </label>
                    <label>
                        Organization:
                        <input
                            type="text"
                            name="org"
                            value={formData.org || ""}
                            onChange={handleInputChange}
                        />
                    </label>
                    <label>
                        Funding:
                        <input
                            type="text"
                            name="funding"
                            value={formData.funding || ""}
                            onChange={handleInputChange}
                        />
                    </label>
                    <div className="edit-form-links-section">
                        <label className="edit-form-links-label">Links:</label>
                        {editFormLinks.map((linkItem, idx) => (
                            <div key={idx} className="learn-more-link-row">
                                <input
                                    type="text"
                                    className="edit-form-link-input"
                                    placeholder="URL"
                                    value={linkItem.url}
                                    onChange={e => setEditFormLinks(editFormLinks.map((l, i) => i === idx ? { ...l, url: e.target.value } : l))}
                                />
                                <input
                                    type="text"
                                    className="edit-form-link-input learn-more-link-text-input"
                                    placeholder="Display text (optional)"
                                    value={linkItem.text}
                                    onChange={e => setEditFormLinks(editFormLinks.map((l, i) => i === idx ? { ...l, text: e.target.value } : l))}
                                />
                                {editFormLinks.length > 1 && (
                                    <button
                                        type="button"
                                        className="learn-more-link-remove-btn"
                                        onClick={() => setEditFormLinks(editFormLinks.filter((_, i) => i !== idx))}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        <button
                            type="button"
                            className="learn-more-modal-toolbar-btn cancel learn-more-add-link-btn"
                            onClick={() => setEditFormLinks([...editFormLinks, { url: '', text: '' }])}
                        >
                            + Add More Links
                        </button>
                    </div>
                    <label>
                        Category:
                        <select
                            name="category"
                            value={formData.category || ""}
                            onChange={handleInputChange}
                        >
                            <option value="">Select a Category</option>
                            {CARD_CATEGORIES.map((categoryOption) => (
                                <option key={categoryOption} value={categoryOption}>
                                    {categoryOption}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Tags:
                        <input
                            type="text"
                            name="tags"
                            value={formData.tags || ""}
                            onChange={handleInputChange}
                        />
                    </label>
                    <label>
                        Visibility:
                        <select
                            name="is_public"
                            value={formData.is_public !== false ? "true" : "false"}
                            onChange={(e) => setFormData(prev => ({ ...prev, is_public: e.target.value !== "false" }))}
                        >
                            <option value="true">Public (visible to everyone)</option>
                            <option value="false">Private (only visible to me)</option>
                        </select>
                    </label>
                    <label>
                        Latitude:
                        <input
                            type="number"
                            step="any"
                            name="latitude"
                            value={formData.latitude || ""}
                            onChange={handleInputChange}
                        />
                    </label>
                    <label>
                        Longitude:
                        <input
                            type="number"
                            step="any"
                            name="longitude"
                            value={formData.longitude || ""}
                            onChange={handleInputChange}
                        />
                    </label>

                    {/* Thumbnail Management */}
                    <div className="thumbnail-section">
                        <label>Thumbnail:</label>
                        {preview && (
                            <div className="thumbnail-preview">
                                <img
                                    src={preview}
                                    alt="Thumbnail Preview"
                                    width="120"
                                    onError={(e) => { e.target.onerror = null; e.target.src = '/CEREO-logo.png'; }}
                                    style={{
                                        marginBottom: "10px",
                                        borderRadius: "6px",
                                    }}
                                />
                                <div className="thumbnail-buttons">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            document
                                                .getElementById(
                                                    `thumbnailInput-${formData.cardID || "new"}`
                                                )
                                                .click()
                                        }
                                    >
                                        Change
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setThumbnail(null);
                                            setPreview("/CEREO-logo.png");
                                            setFormData((prev) => ({
                                                ...prev,
                                                thumbnail_link: "",
                                            }));
                                        }}
                                    >
                                        Delete / Reset to Default
                                    </button>
                                </div>
                            </div>
                        )}
                        <input
                            id={`thumbnailInput-${formData.cardID || "new"}`}
                            type="file"
                            accept="image/png, image/jpeg, image/gif"
                            onChange={handleImageChange}
                            style={{ display: "none" }}
                        />
                    </div>

                    {/* Existing Attached Files */}
                    {formData.files && formData.files.length > 0 && (
                        <div className="attached-files">
                            <h4>Attached Files:</h4>
                            <ul>
                                {formData.files.map((file, idx) => (
                                    <li key={file.fileid || idx}>
                                        <a
                                            href={file.file_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {file.filename}
                                        </a>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (
                                                    window.confirm(
                                                        `Delete file "${file.filename}"?`
                                                    )
                                                ) {
                                                    try {
                                                        await api.delete(
                                                            `/deleteFile?fileID=${file.fileid}`
                                                        );
                                                        alert(`Deleted ${file.filename}`);
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            files: prev.files.filter(
                                                                (f) =>
                                                                    f.fileid !== file.fileid
                                                            ),
                                                        }));
                                                    } catch (err) {
                                                        console.error(
                                                            "Error deleting file:",
                                                            err
                                                        );
                                                        alert("Failed to delete file.");
                                                    }
                                                }
                                            }}
                                            style={{ marginLeft: "10px" }}
                                        >
                                            Delete
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Upload New Files */}
                    <label>
                        Add New Files:
                        <input
                            type="file"
                            name="files"
                            multiple
                            onChange={(e) => {
                                const selectedFiles = Array.from(e.target.files);
                                setFormData((prev) => ({
                                    ...prev,
                                    filesToUpload: selectedFiles,
                                }));
                            }}
                        />
                    </label>

                    {/* Hidden original fields */}
                    <input
                        type="hidden"
                        name="original_username"
                        value={formData.original_username || ""}
                    />
                    <input
                        type="hidden"
                        name="original_email"
                        value={formData.original_email || ""}
                    />

                    <button type="submit" disabled={loading}>
                        {loading ? "Saving..." : "Save"}
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            isEditingRef.current = false; // Unlock editing state
                            setIsEditModalOpen(false);
                        }}
                    >
                        Close
                    </button>
                </form>
            </Modal>

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

            {/* Polygon Editing Modal (from learn-more edit) */}
            {/* Wrap in a click-stopper so portal events don't bubble to the card's onClick */}
            <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {isEditingPolygon && (
                <PolygonDrawingModal
                    mode={isImageCard ? 'image' : 'polygon'}
                    title={isImageCard ? 'Edit Image' : 'Draw Polygon'}
                    initialVertices={isConvertingToPolygon ? [] : formData.polygon_vertices}
                    initialLineStyle={isConvertingToPolygon ? undefined : formData.polygon_line_style}
                    initialFillColor={isConvertingToPolygon ? undefined : formData.polygon_fill_color}
                    initialImageUrl={isImageCard ? getRepresentativeImageUrl() : undefined}
                    onSave={handlePolygonEditSave}
                    onCancel={handlePolygonEditCancel}
                />
            )}
            </div>
        </div>
    );
}

export default Card;
