import React, { useState, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTimes } from '@fortawesome/free-solid-svg-icons';
import { fetchCustomLayers } from './arcgisServicesDb';
import './ArcGISPickerModal.css';

/**
 * Picker modal for uploaded custom layers (GeoJSON/KML/Shapefile).
 * Mimics ArcGISPickerModal style/structure.
 *
 * Props:
 *   onAdd(items)  — called with array of selected items
 *   onClose()     — close without adding
 */
function CustomLayerPickerModal({ onAdd, onClose }) {
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(new Map()); // key → layer meta
    const [layers, setLayers] = useState([]);

    useEffect(() => {
        let active = true;
        const userEmail = localStorage.getItem('email') || '';
        if (!userEmail) return;
        fetchCustomLayers(userEmail)
            .then(all => { if (active) setLayers(all.filter(s => s.type === 'uploaded')); })
            .catch(err => console.warn('[CustomLayerPickerModal] Failed to load custom layers:', err));
        return () => { active = false; };
    }, []);

    const filtered = useMemo(() => {
        if (!search.trim()) return layers;
        const q = search.trim().toLowerCase();
        return layers.filter(l =>
            l.label.toLowerCase().includes(q) ||
            (l.folder || 'Root').toLowerCase().includes(q)
        );
    }, [layers, search]);

    const toggle = (layer) => {
        setSelected(prev => {
            const next = new Map(prev);
            if (next.has(layer.key)) next.delete(layer.key);
            else next.set(layer.key, layer);
            return next;
        });
    };

    const handleAdd = () => {
        const items = Array.from(selected.values()).map(layer => ({
            service_key: layer.key,
            layer_id: null,
            sublayer_index: null,
            display_name: layer.label,
            item_type: 'uploaded_custom',
            state_code: '',
            folder_name: layer.folder || 'Root',
        }));
        onAdd(items);
    };

    return ReactDOM.createPortal(
        <div className="arcgis-picker-overlay" onClick={onClose}>
            <div className="arcgis-picker-modal" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="arcgis-picker-header">
                    <div className="arcgis-picker-search-row">
                        <input
                            type="text"
                            className="arcgis-picker-search-input"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search custom layers…"
                            autoFocus
                        />
                        <button
                            type="button"
                            className="arcgis-picker-search-btn"
                            title="Search"
                            onClick={() => {}}
                        >
                            <FontAwesomeIcon icon={faSearch} />
                        </button>
                        <button
                            type="button"
                            className="arcgis-picker-clear-btn"
                            title="Clear"
                            onClick={() => setSearch('')}
                        >
                            <FontAwesomeIcon icon={faTimes} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="arcgis-picker-modal-body">
                    {layers.length === 0 ? (
                        <p style={{ padding: '16px', color: '#888', fontSize: '13px' }}>
                            No uploaded custom layers found.<br />
                            Upload layers via the Custom Layers Panel first.
                        </p>
                    ) : filtered.length === 0 ? (
                        <p style={{ padding: '16px', color: '#888', fontSize: '13px' }}>
                            No layers match your search.
                        </p>
                    ) : (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {filtered.map(layer => {
                                const isSelected = selected.has(layer.key);
                                return (
                                    <li
                                        key={layer.key}
                                        className={`arcgis-picker-layer-row${isSelected ? ' selected' : ''}`}
                                        onClick={() => toggle(layer)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <input
                                            type="checkbox"
                                            className="arcgis-picker-layer-cb"
                                            checked={isSelected}
                                            onChange={() => toggle(layer)}
                                            onClick={e => e.stopPropagation()}
                                        />
                                        <span className="arcgis-picker-layer-name">{layer.label}</span>
                                        <span style={{ color: '#999', fontSize: '11px', marginLeft: 'auto', flexShrink: 0 }}>
                                            {layer.folder || 'Root'}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Footer */}
                <div className="arcgis-picker-footer">
                    <span className="arcgis-picker-count">
                        {selected.size} item{selected.size !== 1 ? 's' : ''} selected
                    </span>
                    <div className="arcgis-picker-footer-btns">
                        <button type="button" className="arcgis-picker-cancel-btn" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="arcgis-picker-add-btn"
                            onClick={handleAdd}
                            disabled={selected.size === 0}
                        >
                            Add
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

export default CustomLayerPickerModal;
