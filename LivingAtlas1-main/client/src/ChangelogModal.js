import React, { useState } from 'react';
import Modal from 'react-modal';

function ChangelogModal({ isOpen, onClose }) {
    const [activeTab, setActiveTab] = useState('latest');

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            className="changelog-modal"
            overlayClassName="changelog-modal-overlay"
        >
            <div className="changelog-modal-header">
                <h2>What's New</h2>
                <button className="changelog-modal-close" onClick={onClose} aria-label="Close">x</button>
            </div>
            
            <div className="changelog-modal-tabs">
                <button 
                    className={`changelog-tab ${activeTab === 'latest' ? 'active' : ''}`}
                    onClick={() => setActiveTab('latest')}
                >
                    Latest Update
                </button>
                <button 
                    className={`changelog-tab ${activeTab === 'future' ? 'active' : ''}`}
                    onClick={() => setActiveTab('future')}
                >
                    Future Works
                </button>
            </div>

            <div className="changelog-modal-body">
                {activeTab === 'latest' && (
                    <>
                        <h3>Update Date: 6/12/2026</h3>
                        <ul className="changelog-list">
                          <li>Added card visibility settings (public or uploader-only) in both the Add Card modal and the Learn More modal.</li>
                          <li>Added a user feedback input box on the Contact page.</li>
                          <li>Added support for multiple polygons to represent a single card.</li>
                          <li>Configured Resend API and custom domain for wsu.cereoaltas25@gmail.com; updated corresponding Render environment variables.</li>
                          <li>Fixed backend startup failure caused by database query errors.</li>
                          <li>Fixed missing database column; added rollback for /allCards API failures.</li>
                        </ul>

                        <h3>Update Date: 6/6/2026</h3>
                        <ul className="changelog-list">
                          <li>Made the RWC Living Atlas Helper chatbot floating widget freely draggable; snapping to the left or right screen edge collapses it.</li>
                          <li>Overhauled the Add Card from Map – Image workflow: clicking Image now opens the placement modal directly; the sidebar lists each uploaded image with individual remove buttons and an Add Image button to browse local files; a single card can be represented by multiple images.</li>
                          <li>Hidden the center-point marker during image overlay placement and editing; all center-point–dependent operations (move, rotate, resize) are unaffected.</li>
                          <li>Added an opacity slider for image overlays in the placement modal, matching the existing polygon opacity control.</li>
                          <li>Added login prompts for the Polygon and Image options in Add Card from Map, consistent with the existing Coordinate prompt.</li>
                        </ul>

                        <ul className="changelog-list">
                          <li>Migrated backend database connection credentials to Render environment variables; removed all hardcoded secrets from source code.</li>
                          <li>Improved database connection handling, configuration validation, and endpoint error messaging.</li>
                          <li>Updated backend dependencies to resolve compatibility issues.</li>
                          <li>[Notice] The RWC Living Atlas database is currently out of service. Cards and user data are temporarily unavailable and will be restored as soon as possible.</li>
                        </ul>

                                                <h3>Update Date: 5/29/2026</h3>
                                                <ul className="changelog-list">
                                                    <li>Improved the visual appearance of the chatbot floating window for a more consistent and polished look.</li>
                                                    <li>Refined the Learn More modal image display area by locking image frame dimensions, so uploaded image aspect ratios no longer affect the container size.</li>
                                                    <li>Enhanced the avatar menu by adding user avatar, username, and email display.</li>
                                                    <li>Refactored profile page layout and added an account deletion button with a dedicated confirmation modal flow.</li>
                                                </ul>

                        <h3>Update Date: 5/25/2026</h3>
                        <ul className="changelog-list">
                          <li>Started integrating Pinecone Nexus as the next-generation RAG backend for the Living Atlas Helper Chatbot, replacing the previous local-embedding pipeline. (In progress)</li>
                          <li>Implemented fullscreen map mode with hover-reveal top navbar and left sidebar — hovering near the top or left edge slides the corresponding UI element into view, with full panel support.</li>
                          <li>Redesigned the chatbot floating widget and sidebar panel to match the visual style of other panels (Upload Panel, Custom Layers, Basemap) — consistent background, header, buttons, and color scheme.</li>
                        </ul>

                        <h3>Update Date: 5/16/2026</h3>
                        <ul className="changelog-list">
                          <li>Enhanced Service/Layer Info Modal with improved display of child layers, legends, positioning, and active state indicators.</li>
                          <li>Added field-based filtering for ArcGIS layers within the Layer Info Modal.</li>
                          <li>Aligned rendering z-index for clickable vectors with raster image overlays.</li>
                          <li>Improved map zoom control with draggable pointer for real-time z-value adjustment.</li>
                          <li>Refined UI appearance of Upload Panel, Custom Layers Panel, and Learn More Modal.</li>
                          <li>Implemented responsive sizing for Top Navigation Bar and Left Sidebar based on screen dimensions.</li>
                          <li>Updated User Manual, onboarding workflows, and organized User Manual tabs.</li>
                          <li>Enhanced Basemap Panel with additional options, functionality improvements, and visual refinements.</li>
                          <li>Extended image overlay support from PNG-only to include JPEG format in Add Card from Map workflow.</li>
                          <li>Updated User Manual, onboarding tutorials, and chatbot knowledge base for all new features and changes.</li>
                        </ul>
                    </>
                )}

                {activeTab === 'future' && (
                    <>
                        <h3>Future Works</h3>
                        <h4>Chatbot (Production Release)</h4>
                        <ul className="changelog-list">
                          <li>Integrate ArcGIS knowledge base: Query ArcGIS services database to retrieve REST endpoint information and provide answers to ArcGIS-related questions.</li>
                          <li>Integrate card knowledge base: Access card data in the database to extract and share relevant information in chatbot responses.</li>
                          <li>Conversation history: Enable users to view, manage, and delete past conversations. Each session maintains independent context.</li>
                          <li>Agent capabilities: Enhance chatbot to assist users with specific tasks, such as locating and adding layers to the map.</li>
                          <li>Performance improvements: Reduce response latency and improve answer accuracy.</li>
                        </ul>

                        <h4>ArcGIS Upload Panel</h4>
                        <ul className="changelog-list">
                          <li>Support for additional ArcGIS database content and services.</li>
                        </ul>

                        <h4>Custom Layer Panel</h4>
                        <ul className="changelog-list">
                          <li>Add more user-customization options for modifying panel content and behavior.</li>
                        </ul>

                        <h4>Left Sidebar</h4>
                        <ul className="changelog-list">
                          <li>Expand app settings with global configuration options (e.g., theme style preferences).</li>
                        </ul>

                                                <h4>Map Controls</h4>
                                                <ul className="changelog-list">
                                                    <li>Continue expanding fullscreen mode with additional accessibility and panel interaction improvements.</li>
                                                </ul>
                    </>
                )}
            </div>

            <div className="changelog-modal-footer">
                <button className="changelog-modal-dismiss" onClick={onClose}>Got it</button>
            </div>
        </Modal>
    );
}

export default ChangelogModal;
