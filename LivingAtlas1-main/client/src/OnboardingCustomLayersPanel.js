import React, { useEffect, useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './OnboardingCustomLayersPanel.css';

const ONBOARDING_STEPS = [
    {
        selector: '.custom-layers-panel',
        title: 'Custom Layers Panel',
        description: 'This panel lets you organize saved ArcGIS layers and uploaded files (GeoJSON, KML, Shapefile) into folders, browse services, and manage layer settings.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-new-folder-button"]',
        title: 'New Folder',
        description: 'Use this action-row button to create a new folder for your saved custom layers.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-folder-area"]',
        title: 'Folders',
        description: 'Browse the folder list here. Each folder groups saved services by topic or workflow.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-service-row"]',
        title: 'Services',
        description: 'Open a folder to see its saved services. Click a service row to expand its layers.',
        placement: 'right',
    },
    {
        selector: '[data-onboarding-target="custom-layers-search-area"]',
        title: 'Search',
        description: 'Search by folder, service, or layer name within the current scope.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-service-info-button"]',
        title: 'Service Information',
        description: 'Click the (...) button to open detailed service information.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-layer-tree"]',
        title: 'Layer Management',
        description: 'Expanded services show their layers and sublayers here, where you can manage individual selections.',
        placement: 'right',
    },
    {
        selector: '[data-onboarding-target="custom-layers-opacity-slider"]',
        title: 'Display Controls',
        description: 'Use the opacity slider to change how all saved layers appear on the map.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-panel-actions"]',
        title: 'Panel Actions',
        description: 'This action row groups New Folder, Upload File, Show Added Only, and Clear All. Upload File imports a GeoJSON, KML, or Shapefile (.zip) as a new layer; Show Added Only focuses on items already loaded on the map.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-service-info-modal"]',
        title: 'Service Info Modal',
        description: 'The tutorial opens the first saved service info modal automatically so you can review metadata, modal layout, and close controls in context.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-service-info-actions"]',
        title: 'Save Service and Open Source Page',
        description: 'Service info includes a Save button and a direct ArcGIS service page link, making it easy to preserve the service again or verify the original source.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-layer-info-modal"]',
        title: 'Layer Info Modal',
        description: 'Layer info shows layer metadata, legend content, and parent or child layer links when the ArcGIS service exposes them.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-layer-info-filter"]',
        title: 'Field Filter Builder',
        description: 'Choose a field, operator, and value to build a layer filter, apply it to the map, or clear it when you are finished.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="custom-layers-layer-info-actions"]',
        title: 'Save Layer and Inspect REST Page',
        description: 'The action area at the bottom of Layer Info lets you save the current layer and open the ArcGIS layer page for direct source inspection.',
        placement: 'left',
    },
];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getTooltipLayout(targetRect, preferredPlacement = 'left') {
    const width = 320;
    const height = 190;
    const gap = 16;
    const edge = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!targetRect) {
        return {
            top: Math.round(vh / 2 - height / 2),
            left: Math.round(vw / 2 - width / 2),
            placement: 'top',
        };
    }

    const centerX = targetRect.left + targetRect.width / 2;
    const centerY = targetRect.top + targetRect.height / 2;
    const placements = [preferredPlacement, 'left', 'bottom', 'top', 'right'];

    for (const placement of placements) {
        if (placement === 'left') {
            const left = targetRect.left - width - gap;
            const top = clamp(centerY - height / 2, edge, vh - height - edge);
            if (left >= edge) return { top, left, placement };
        }
        if (placement === 'right') {
            const left = targetRect.right + gap;
            const top = clamp(centerY - height / 2, edge, vh - height - edge);
            if (left + width <= vw - edge) return { top, left, placement };
        }
        if (placement === 'top') {
            const top = targetRect.top - height - gap;
            const left = clamp(centerX - width / 2, edge, vw - width - edge);
            if (top >= edge) return { top, left, placement };
        }
        if (placement === 'bottom') {
            const top = targetRect.bottom + gap;
            const left = clamp(centerX - width / 2, edge, vw - width - edge);
            if (top + height <= vh - edge) return { top, left, placement };
        }
    }

    return {
        top: clamp(centerY - height / 2, edge, vh - height - edge),
        left: clamp(centerX - width / 2, edge, vw - width - edge),
        placement: 'top',
    };
}

function CustomLayersPanelOnboarding({
    isOpen,
    onClose,
    isPanelCollapsed,
    onStepChange,
}) {
    const [stepIndex, setStepIndex] = useState(0);
    const [targetRect, setTargetRect] = useState(null);

    const activeStep = useMemo(() => ONBOARDING_STEPS[stepIndex] || ONBOARDING_STEPS[0], [stepIndex]);

    const updateTargetRect = useCallback(() => {
        if (!isOpen) return;
        const target = document.querySelector(activeStep.selector);
        if (!target) {
            setTargetRect(null);
            return;
        }
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        setTargetRect(target.getBoundingClientRect());
    }, [isOpen, activeStep]);

    const goPrev = useCallback(() => setStepIndex((prev) => Math.max(0, prev - 1)), []);
    const goNext = useCallback(() => {
        if (stepIndex >= ONBOARDING_STEPS.length - 1) {
            onClose?.();
            return;
        }
        setStepIndex((prev) => Math.min(ONBOARDING_STEPS.length - 1, prev + 1));
    }, [stepIndex, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        setStepIndex(0);
        setTargetRect(null);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        onStepChange?.(stepIndex);
    }, [isOpen, stepIndex, onStepChange]);

    useEffect(() => {
        if (!isOpen) return;
        if (isPanelCollapsed) onClose?.();
    }, [isOpen, isPanelCollapsed, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        updateTargetRect();
        const timer = window.setTimeout(updateTargetRect, 350);
        window.addEventListener('resize', updateTargetRect);
        window.addEventListener('scroll', updateTargetRect, true);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('resize', updateTargetRect);
            window.removeEventListener('scroll', updateTargetRect, true);
        };
    }, [isOpen, stepIndex, updateTargetRect]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                goPrev();
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                goNext();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, stepIndex, goPrev, goNext, onClose]);

    if (!isOpen) return null;

    const tooltipLayout = getTooltipLayout(targetRect, activeStep.placement);

    return ReactDOM.createPortal(
        <div className="custom-layers-onboarding-overlay" role="dialog" aria-modal="true">
            <div className="custom-layers-onboarding-dim" />

            {targetRect && (
                <div
                    className="custom-layers-onboarding-highlight"
                    style={{
                        top: targetRect.top - 6,
                        left: targetRect.left - 6,
                        width: targetRect.width + 12,
                        height: targetRect.height + 12,
                    }}
                />
            )}

            <div
                className={`custom-layers-onboarding-tooltip placement-${tooltipLayout.placement}`}
                style={{ top: tooltipLayout.top, left: tooltipLayout.left }}
            >
                <div className="custom-layers-onboarding-progress">
                    Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
                </div>
                <h4>{activeStep.title}</h4>
                <p>{activeStep.description}</p>
                <div className="custom-layers-onboarding-actions">
                    <button type="button" onClick={goPrev} disabled={stepIndex === 0}>
                        Previous
                    </button>
                    <button type="button" onClick={onClose}>Close</button>
                    <button type="button" className="primary" onClick={goNext}>
                        {stepIndex === ONBOARDING_STEPS.length - 1 ? 'Finish' : 'Next'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

export default CustomLayersPanelOnboarding;