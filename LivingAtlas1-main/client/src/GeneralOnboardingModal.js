import React from 'react';
import Modal from 'react-modal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay } from '@fortawesome/free-solid-svg-icons';

function GeneralOnboardingModal({ isOpen, onClose, onPlay }) {
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            className="onboarding-modal"
            overlayClassName="onboarding-modal-overlay"
        >
            <div className="onboarding-modal-header">
                <h2>Welcome to Living Atlas</h2>
                <button className="onboarding-modal-close" onClick={onClose} aria-label="Close">x</button>
            </div>
            <div className="onboarding-modal-body">
                <h3>What is the Living Atlas?</h3>
                <p>The CEREO Living Atlas is a web-based, map-focused platform for gathering, viewing, and sharing environmental data about the Pacific Northwest, with a focus on water quality in the Columbia River Basin. Built with the <strong>Center for Environmental Research, Education, and Outreach (CEREO)</strong> at Washington State University, it brings fragmented environmental datasets together into one interactive, public-facing map.</p>

                <h3>What Can You Do Here?</h3>
                <ul>
                    <li><strong>Explore the interactive map</strong> — pan, zoom, and click markers, polygons, and image overlays to discover environmental resources.</li>
                    <li><strong>Browse data cards</strong> — each card is a geographically located resource (e.g., a monitoring station or dataset) with descriptions, images, files, and links. Search, sort, and filter cards by category, tag, or keyword.</li>
                    <li><strong>Load GIS layers</strong> — add ArcGIS map services from Washington, Idaho, and Oregon state sources onto the map, and filter time-aware layers.</li>
                    <li><strong>Add custom layers</strong> — organize and render your own layers with folders, pinning, and ordering.</li>
                    <li><strong>Switch basemaps</strong> — choose the background map style that best suits your needs.</li>
                    <li><strong>Sign in for more</strong> — bookmark (favorite) cards, and if authorized, create and manage your own cards.</li>
                    <li><strong>Ask the AI chatbot</strong> — get help finding data and using the app via the floating chat widget.</li>
                </ul>

                <h3>How to Start Onboarding in Each Panel</h3>
                <p><strong>Cards Panel</strong>: Click the <strong>Cards</strong> button in the left sidebar, then click <strong>Start onboarding</strong> (play button) in the card panel top bar.</p>
                <p><strong>GIS Services Panel</strong>: Click the <strong>GIS Services</strong> button in the left sidebar, then click <strong>Tutorial</strong> (play button) in the panel header.</p>
                <p><strong>Custom Layers Panel</strong>: Click the <strong>Custom Layers</strong> button in the left sidebar, then click <strong>Tutorial</strong> (play button) in the panel header.</p>
                <p><strong>Basemap Panel</strong>: Click the <strong>Basemap</strong> button in the left sidebar, then click <strong>Tutorial</strong> (play button) in the panel header.</p>

                <h3>Quick Help Tip</h3>
                <p>In these panels, the <strong>question mark</strong> button opens the detailed user manual, and the <strong>play</strong> button starts the guided onboarding tour.</p>

                <h3>General Onboarding Replay</h3>
                <p>To replay this general onboarding flow anytime: click the left sidebar <strong>Onboarding</strong> button, then click <strong>Play General Onboarding</strong> in this modal.</p>
            </div>
            <div className="onboarding-modal-footer">
                <button className="onboarding-modal-play" onClick={onPlay}>
                    <FontAwesomeIcon icon={faPlay} />
                    <span>Play General Onboarding</span>
                </button>
                <button className="onboarding-modal-dismiss" onClick={onClose}>Got it</button>
            </div>
        </Modal>
    );
}

export default GeneralOnboardingModal;