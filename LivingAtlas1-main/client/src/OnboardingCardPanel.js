import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './OnboardingCardPanel.css';

const ONBOARDING_STEPS = [
    {
        selector: '#content-2',
        title: 'Card Container Panel',
        description: 'This is the main card container panel for browsing cards, filtering, searching, and switching views.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="card-help-button"]',
        title: 'Help Button',
        description: 'Click here to open the Card Container section in the user manual.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="card-toolbar"]',
        title: 'Toolbar',
        description: 'Use this toolbar to add cards, show or hide markers, sort, filter, manage favorites, switch views, and move panel docking side.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="card-searchbar"]',
        title: 'Search Area',
        description: 'Enter keywords to search cards. The buttons on the right run search or clear the input.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="card-list-area"]',
        title: 'Card Results Area',
        description: 'Current results are shown here. You can view cards in list or grid mode and use card actions to locate items on the map quickly.',
        placement: 'left',
    },
    {
        selector: '[data-onboarding-target="onboarding-single-card"]',
        title: 'Single Card',
        description: 'Each card includes a preview image, title, and its tags to quickly understand what the card is about.',
        placement: 'left',
        requiresCard: true,
    },
    {
        selector: '[data-onboarding-target="onboarding-single-card-actions"]',
        title: 'Card Buttons and Actions',
        description: 'Card-level actions include quick controls such as favorite and locate-on-map buttons (and pin controls in the container view).',
        placement: 'left',
        requiresCard: true,
    },
    {
        selector: '[data-onboarding-target="onboarding-single-card"]',
        title: 'Learn More Modal',
        description: 'Clicking the card text area will open the Learn More modal with detailed information and management options.',
        placement: 'left',
        requiresCard: true,
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

function CardPanelOnboarding({
    isOpen,
    onClose,
    isPanelCollapsed,
    firstCardId,
}) {
    const [stepIndex, setStepIndex] = useState(0);
    const [targetRect, setTargetRect] = useState(null);

    const activeStep = useMemo(() => {
        const step = ONBOARDING_STEPS[stepIndex] || ONBOARDING_STEPS[0];
        if (step.requiresCard && !firstCardId) {
            return {
                ...step,
                description: 'No visible cards are available right now. Clear filters or search to show cards, then run onboarding again for this step.',
            };
        }
        return step;
    }, [stepIndex, firstCardId]);

    const updateTargetRect = useCallback(() => {
        if (!isOpen) return;
        const target = document.querySelector(activeStep.selector);
        if (!target) {
            setTargetRect(null);
            return;
        }
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
        if (isPanelCollapsed) onClose?.();
    }, [isOpen, isPanelCollapsed, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        updateTargetRect();
        window.addEventListener('resize', updateTargetRect);
        window.addEventListener('scroll', updateTargetRect, true);
        return () => {
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
        <div className="card-onboarding-overlay" role="dialog" aria-modal="true">
            <div className="card-onboarding-dim" />

            {targetRect && (
                <div
                    className="card-onboarding-highlight"
                    style={{
                        top: targetRect.top - 6,
                        left: targetRect.left - 6,
                        width: targetRect.width + 12,
                        height: targetRect.height + 12,
                    }}
                />
            )}

            <div
                className={`card-onboarding-tooltip placement-${tooltipLayout.placement}`}
                style={{ top: tooltipLayout.top, left: tooltipLayout.left }}
            >
                <div className="card-onboarding-progress">
                    Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
                </div>
                <h4>{activeStep.title}</h4>
                <p>{activeStep.description}</p>
                <div className="card-onboarding-actions">
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

export default CardPanelOnboarding;
