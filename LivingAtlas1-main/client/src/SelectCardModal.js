import React, { useState, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTimes } from '@fortawesome/free-solid-svg-icons';
import api from './api';
import './ArcGISPickerModal.css';

/**
 * Select Card Modal — lists all cards (list format) with checkboxes so the
 * user can link an uploaded custom layer/service to one or more cards.
 * Styled like the ArcGIS / Custom Layer picker modals.
 *
 * Props:
 *   onAdd(selectedCards) — called with the array of selected card objects
 *   onClose()            — close without linking
 */
function SelectCardModal({ onAdd, onClose }) {
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(new Set()); // cardID -> cardID
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const viewerEmail = localStorage.getItem('email') || '';
        const params = viewerEmail ? { viewer_email: viewerEmail } : {};
        api.get('/allCards', { params })
            .then(res => {
                if (!active) return;
                const raw = res?.data?.data || res?.data || [];
                // Deduplicate by cardID, keep stable order
                const seen = new Set();
                const unique = (Array.isArray(raw) ? raw : []).filter(c => {
                    if (c.cardID == null || seen.has(c.cardID)) return false;
                    seen.add(c.cardID);
                    return true;
                });
                setCards(unique);
            })
            .catch(err => console.warn('[SelectCardModal] Failed to load cards:', err))
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const filtered = useMemo(() => {
        if (!search.trim()) return cards;
        const q = search.trim().toLowerCase();
        return cards.filter(c =>
            String(c.title || '').toLowerCase().includes(q) ||
            String(c.category || '').toLowerCase().includes(q)
        );
    }, [cards, search]);

    const toggle = (cardID) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(cardID)) next.delete(cardID);
            else next.add(cardID);
            return next;
        });
    };

    const handleAdd = () => {
        const items = cards.filter(c => selected.has(c.cardID));
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
                            placeholder="Search cards…"
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
                <div className="arcgis-picker-body">
                    {loading ? (
                        <p style={{ padding: '16px', color: '#888', fontSize: '13px' }}>
                            Loading cards…
                        </p>
                    ) : cards.length === 0 ? (
                        <p style={{ padding: '16px', color: '#888', fontSize: '13px' }}>
                            No cards found.
                        </p>
                    ) : filtered.length === 0 ? (
                        <p style={{ padding: '16px', color: '#888', fontSize: '13px' }}>
                            No cards match your search.
                        </p>
                    ) : (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {filtered.map(card => {
                                const isSelected = selected.has(card.cardID);
                                return (
                                    <li
                                        key={card.cardID}
                                        className={`arcgis-picker-layer-row${isSelected ? ' selected' : ''}`}
                                        onClick={() => toggle(card.cardID)}
                                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
                                    >
                                        <input
                                            type="checkbox"
                                            className="arcgis-picker-layer-cb"
                                            checked={isSelected}
                                            onChange={() => toggle(card.cardID)}
                                            onClick={e => e.stopPropagation()}
                                        />
                                        <span className="arcgis-picker-layer-name">{card.title || `Card #${card.cardID}`}</span>
                                        <span style={{ color: '#999', fontSize: '11px', marginLeft: 'auto', flexShrink: 0 }}>
                                            {card.category || ''}
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
                        {selected.size} card{selected.size !== 1 ? 's' : ''} selected
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
                            Link
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

export default SelectCardModal;
