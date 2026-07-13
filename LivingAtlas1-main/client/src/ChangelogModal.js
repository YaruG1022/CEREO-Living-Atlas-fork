import React from 'react';
import Modal from 'react-modal';

function ChangelogModal({ isOpen, onClose }) {
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

            <div className="changelog-modal-body">
                <>
                        <h3>Update Date: 7/1 - 7/15/2026</h3>

                        <h4>Onboarding & What's New</h4>
                        <ul className="changelog-list">
                          <li>The Welcome to Living Atlas onboarding modal now opens automatically when you visit the homepage, and now includes an introduction to the app and an overview of its major features.</li>
                          <li>The What's New changelog modal no longer opens automatically on page visit; instead, a notification dot now appears on the bell icon when new updates are available, and clears once the changelog has been viewed.</li>
                        </ul>

                        <h4>Map Interactions</h4>
                        <ul className="changelog-list">
                          <li>Added a hover effect to user-added polygons and image overlays on the map, styled after the card marker hover shadow; the effect stays on while a shape's embedded popup is open.</li>
                        </ul>

                        <h4>Add Points & Draw Polygon Panels</h4>
                        <ul className="changelog-list">
                          <li>Added an editing toolbar to the Add Points panel, styled after the Draw Polygon modal, with tools for adding new points, marker color, opacity, move, rotate, scale, undo/redo, and Clear All.</li>
                          <li>Moved the Draw Polygon modal's Add New Polygon action from the bottom button row to the first position in the editing toolbar.</li>
                        </ul>

                        <h4>Chatbot Agent Skill Upgrade</h4>
                        <ul className="changelog-list">
                          <li>Added a modular chatbot agent skill framework to the backend chat pipeline, enabling tool-style live data retrieval before response generation.</li>
                          <li>Added an ArcGIS live catalog skill that queries <code>https://gis.ecology.wa.gov/serverext/rest/services</code> and supports folder-level drill-down queries (for example, AQ/WQ/WR).</li>
                          <li>Enhanced explainability by appending structured source snippets in chatbot answers (e.g., <code>[ArcGIS live catalog]</code> entries in a Sources section).</li>
                          <li>Improved reliability for ArcGIS live fetches with 403 mitigation logic, including request-header profiles, endpoint fallback attempts, and clearer diagnostics.</li>
                        </ul>

                        <h4>Bug Fixes</h4>
                        <ul className="changelog-list">
                          <li>Fixed the misaligned update notification dot that appeared at the top of the left sidebar instead of on the corner of the bell icon.</li>
                          <li>Fixed an issue in the Draw Polygon modal where clicking Clear All or Delete This Polygon could not clear the polygon borders from the map.</li>
                          <li>Fixed an issue in the Draw Polygon modal where polygons were not displayed correctly after clicking Clear All and then Undo; all polygons are now fully restored.</li>
                          <li>Fixed an issue where clicking Save in the Draw Polygon modal returned to the Learn More modal with edit mode exited prematurely; also improved the unsaved-changes indicator so it only appears when actual changes were made.</li>
                          <li>Fixed an issue where, immediately after saving changes to a card with multiple polygons, the map rendered all polygons with the same color and opacity until the page was refreshed.</li>
                        </ul>

                        <h3>Update Date: 6/16 - 6/30/2026</h3>

                        <h4>Chatbot Knowledge Base Expansion</h4>
                        <ul className="changelog-list">
                          <li>Added knowledge about the Living Atlas application itself to the chatbot.</li>
                          <li>Added knowledge base content covering the Washington State ArcGIS, Idaho ArcGIS, and Oregon ArcGIS data sources (sourced from the state Department of Ecology and related agencies), as well as the map's built-in layers.</li>
                          <li>Added knowledge base content for all cards currently in the database, letting the chatbot query card data — while keeping sensitive information (such as usernames and passwords) out of its responses.</li>
                        </ul>

                        <h4>Search Panel Improvements</h4>
                        <ul className="changelog-list">
                          <li>Raised the Search panel (the first button in the left sidebar) above the other panels in stacking order.</li>
                          <li>Added placeholder hint text in the results area when no results are shown (e.g. "Search features by keywords").</li>
                          <li>Added a Recently Used section below the results area that lists options the user has searched and used; each option can be removed from the list or pinned to the top.</li>
                        </ul>

                        <h4>Add Card from Map – Coordinates</h4>
                        <ul className="changelog-list">
                          <li>Streamlined the point-adding workflow with a new Add Points panel for the Coordinates option.</li>
                          <li>Points can now be repositioned by typing X/Y coordinate values while adding, and each coordinate point can use a different icon shape.</li>
                          <li>Added support for multiple points to represent a single card, shown together in the panel's point display area.</li>
                        </ul>

                        <h4>Bug Fixes</h4>
                        <ul className="changelog-list">
                          <li>Fixed the Add Points panel position offset, and fixed the mismatch between the shapes shown on the map and the preview after adding a card with multiple points.</li>
                          <li>Changed the default appearance of the coordinate preview in the Add Points panel, and added the original three default markers to the icon menu.</li>
                          <li>Fixed an issue where clicking any shape of a multi-polygon card failed to open its embedded map popup.</li>
                          <li>Fixed an issue where polygon borders were invisible at certain zoom levels when multiple polygons represent a single card.</li>
                          <li>Fixed multi-polygon rendering: vertices from separate polygon rings were previously cross-connected into one tangled shape; each polygon now renders independently.</li>
                          <li>Fixed per-polygon style isolation in the Draw Polygon modal: color, opacity, and line style changes now apply only to the selected polygon, not all polygons.</li>
                          <li>Fixed duplicate vertex list display in the Draw Polygon modal: clicking a polygon to edit it no longer shows its points a second time below the polygon list.</li>
                          <li>Fixed polygon color display: a card represented by multiple polygons with different colors now keeps each polygon's own color after saving, instead of all polygons collapsing to a single color.</li>
                        </ul>

                        <h4>Other Improvements</h4>
                        <ul className="changelog-list">
                          <li>Removed the zoom-to-location behavior when selecting a polygon while editing; the selected polygon now shows a soft drop-shadow highlight instead.</li>
                          <li>Added an RGB color picker to the color options in the Draw Polygon modal, letting users pick custom colors in addition to the preset quick-select swatches.</li>
                          <li>Added a Public / Private visibility option to the Add Card modal, matching the existing setting in the Learn More edit modal.</li>
                        </ul>

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
            </div>

            <div className="changelog-modal-footer">
                <button className="changelog-modal-dismiss" onClick={onClose}>Got it</button>
            </div>
        </Modal>
    );
}

export default ChangelogModal;
