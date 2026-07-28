import React, { useState } from 'react';
import './ChangelogHistory.css';

function ChangelogHistory() {
    const [activeTab, setActiveTab] = useState('latest');

    return (
        <div className="changelog-history-page">
            <h1>Update History</h1>
            
            <div className="changelog-history-tabs">
                <button 
                    className={`changelog-history-tab ${activeTab === 'latest' ? 'active' : ''}`}
                    onClick={() => setActiveTab('latest')}
                >
                    Latest Update
                </button>
                <button 
                    className={`changelog-history-tab ${activeTab === 'future' ? 'active' : ''}`}
                    onClick={() => setActiveTab('future')}
                >
                    Future Works
                </button>
            </div>

            <div className="changelog-history-body">
                {activeTab === 'latest' && (
                    <>
                        <h3>Update Date: 7/1 - 7/15/2026</h3>

                        <h4>Onboarding & What's New</h4>
                        <p>The Welcome to Living Atlas onboarding modal now opens automatically when you visit the homepage, and now includes an introduction to the app and an overview of its major features.</p>
                        <p>The What's New changelog modal no longer opens automatically on page visit; instead, a notification dot now appears on the bell icon when new updates are available, and clears once the changelog has been viewed.</p>

                        <h4>Map Interactions</h4>
                        <p>Added a hover effect to user-added polygons and image overlays on the map, styled after the card marker hover shadow; the effect stays on while a shape's embedded popup is open.</p>

                        <h4>Add Points & Draw Polygon Panels</h4>
                        <p>Added an editing toolbar to the Add Points panel, styled after the Draw Polygon modal, with tools for adding new points, marker color, opacity, move, rotate, scale, undo/redo, and Clear All.</p>
                        <p>Moved the Draw Polygon modal's Add New Polygon action from the bottom button row to the first position in the editing toolbar.</p>

                        <h4>Chatbot Agent Skill Upgrade</h4>
                        <p>Added a modular chatbot agent skill framework to the backend chat pipeline, enabling tool-style live data retrieval before response generation.</p>
                        <p>Added an ArcGIS live catalog skill that queries <code>https://gis.ecology.wa.gov/serverext/rest/services</code> and supports folder-level drill-down queries (for example, AQ/WQ/WR).</p>
                        <p>Enhanced explainability by appending structured source snippets in chatbot answers (e.g., <code>[ArcGIS live catalog]</code> entries in a Sources section).</p>
                        <p>Improved reliability for ArcGIS live fetches with 403 mitigation logic, including request-header profiles, endpoint fallback attempts, and clearer diagnostics.</p>

                        <h4>Chatbot Navigation Links</h4>
                        <p>Chatbot answers can now include quick navigation links that take you straight to the matching item in the GIS Services panel — clicking a link opens the panel and highlights the referenced folder, service, or layer.</p>

                        <h4>Add Points Panel</h4>
                        <p>Expanded the marker icon menu with 30 additional Font Awesome options covering nature, wildlife, weather, activity, and monitoring themes.</p>

                        <h4>Card Learn More – Pinned ArcGIS Layers</h4>
                        <p>Added a pin button to the Linked ArcGIS Services/Layers section: pinned services/layers always stay open on the map, and pin choices are saved to your account so they load automatically on future visits.</p>

                        <h4>Service & Layer Info Modals</h4>
                        <p>Added a Layer Opacity slider to the Layer Info modal (same control as the Service Info modal) that adjusts only the selected layer.</p>
                        <p>Added a Download Image button to the Layer Info modal that saves the layer's raster image for the current map view as a PNG.</p>
                        <p>Added a dual-handle Zoom Range slider to the Layer Info modal, with two draggable points controlling the minimum and maximum zoom levels at which the layer is displayed.</p>
                        <p>Improved the Filter by Field feature: filters now also apply to the raster tiles server-side, so non-matching areas are removed from the raster image instead of only from the clickable vector overlay.</p>
                        <p>Unified the Service Info and Layer Info modals of the GIS Services panel and the Custom Layers panel into one shared implementation, bringing the Custom Layers panel up to date with all recent additions (Historical View time filter, layer opacity, zoom range, image download, and raster-aware filtering).</p>

                        <h4>Bug Fixes</h4>
                        <p>Fixed the misaligned update notification dot that appeared at the top of the left sidebar instead of on the corner of the bell icon.</p>
                        <p>Fixed an issue in the Draw Polygon modal where clicking Clear All or Delete This Polygon could not clear the polygon borders from the map.</p>
                        <p>Fixed an issue in the Draw Polygon modal where polygons were not displayed correctly after clicking Clear All and then Undo; all polygons are now fully restored.</p>
                        <p>Fixed an issue where clicking Save in the Draw Polygon modal returned to the Learn More modal with edit mode exited prematurely; also improved the unsaved-changes indicator so it only appears when actual changes were made.</p>
                        <p>Fixed an issue where, immediately after saving changes to a card with multiple polygons, the map rendered all polygons with the same color and opacity until the page was refreshed.</p>
                        <hr />

                        <h3>Update Date: 6/16 - 6/30/2026</h3>

                        <h4>Chatbot Knowledge Base Expansion</h4>
                        <p>Added knowledge about the Living Atlas application itself to the chatbot.</p>
                        <p>Added knowledge base content covering the Washington State ArcGIS, Idaho ArcGIS, and Oregon ArcGIS data sources (sourced from the state Department of Ecology and related agencies), as well as the map's built-in layers.</p>
                        <p>Added knowledge base content for all cards currently in the database, letting the chatbot query card data — while keeping sensitive information (such as usernames and passwords) out of its responses.</p>

                        <h4>Search Panel Improvements</h4>
                        <p>Raised the Search panel (the first button in the left sidebar) above the other panels in stacking order.</p>
                        <p>Added placeholder hint text in the results area when no results are shown (e.g. "Search features by keywords").</p>
                        <p>Added a Recently Used section below the results area that lists options the user has searched and used; each option can be removed from the list or pinned to the top.</p>

                        <h4>Add Card from Map – Coordinates</h4>
                        <p>Streamlined the point-adding workflow with a new Add Points panel for the Coordinates option.</p>
                        <p>Points can now be repositioned by typing X/Y coordinate values while adding, and each coordinate point can use a different icon shape.</p>
                        <p>Added support for multiple points to represent a single card, shown together in the panel's point display area.</p>

                        <h4>Bug Fixes</h4>
                        <p>Fixed the Add Points panel position offset, and fixed the mismatch between the shapes shown on the map and the preview after adding a card with multiple points.</p>
                        <p>Changed the default appearance of the coordinate preview in the Add Points panel, and added the original three default markers to the icon menu.</p>
                        <p>Fixed an issue where clicking any shape of a multi-polygon card failed to open its embedded map popup.</p>
                        <p>Fixed an issue where polygon borders were invisible at certain zoom levels when multiple polygons represent a single card.</p>
                        <p>Fixed multi-polygon rendering: vertices from separate polygon rings were previously cross-connected into one tangled shape; each polygon now renders independently.</p>
                        <p>Fixed per-polygon style isolation in the Draw Polygon modal: color, opacity, and line style changes now apply only to the selected polygon, not all polygons.</p>
                        <p>Fixed duplicate vertex list display in the Draw Polygon modal: clicking a polygon to edit it no longer shows its points a second time below the polygon list.</p>
                        <p>Fixed polygon color display: a card represented by multiple polygons with different colors now keeps each polygon's own color after saving, instead of all polygons collapsing to a single color.</p>

                        <h4>Other Improvements</h4>
                        <p>Removed the zoom-to-location behavior when selecting a polygon while editing; the selected polygon now shows a soft drop-shadow highlight instead.</p>
                        <p>Added an RGB color picker to the color options in the Draw Polygon modal, letting users pick custom colors in addition to the preset quick-select swatches.</p>
                        <p>Added a Public / Private visibility option to the Add Card modal, matching the existing setting in the Learn More edit modal.</p>
                        <hr />

                        <h3>Update Date: 6/12/2026</h3>
                        <p>Added card visibility settings (public or uploader-only) in both the Add Card modal and the Learn More modal.</p>
                        <p>Added a user feedback input box on the Contact page.</p>
                        <p>Added support for multiple polygons to represent a single card.</p>
                        <p>Configured Resend API and custom domain for wsu.cereoaltas25@gmail.com; updated corresponding Render environment variables.</p>
                        <p>Fixed backend startup failure caused by database query errors.</p>
                        <p>Fixed missing database column; added rollback for /allCards API failures.</p>
                        <hr />

                        <h3>Update Date: 6/6/2026</h3>
                        <p>Made the RWC Living Atlas Helper chatbot floating widget freely draggable; snapping to the left or right screen edge collapses it.</p>
                        <p>Overhauled the Add Card from Map – Image workflow: clicking Image now opens the placement modal directly; the sidebar lists each uploaded image with individual remove buttons and an Add Image button to browse local files; a single card can be represented by multiple images.</p>
                        <p>Hidden the center-point marker during image overlay placement and editing; all center-point–dependent operations (move, rotate, resize) are unaffected.</p>
                        <p>Added an opacity slider for image overlays in the placement modal, matching the existing polygon opacity control.</p>
                        <p>Added login prompts for the Polygon and Image options in Add Card from Map, consistent with the existing Coordinate prompt.</p>
                        <hr />

                        <h3>Update Date: 5/31/2026</h3>
                        <p>Migrated backend database connection credentials to Render environment variables; removed all hardcoded secrets from source code.</p>
                        <p>Improved database connection handling, configuration validation, and endpoint error messaging.</p>
                        <p>Updated backend dependencies to resolve compatibility issues.</p>
                        <p>[Notice] The RWC Living Atlas database is currently out of service. Cards and user data are temporarily unavailable and will be restored as soon as possible.</p>
                        <hr />

                        <h3>Update Date: 5/29/2026</h3>
                        <p>Improved the visual appearance of the chatbot floating window for a more consistent and polished look.</p>
                        <p>Refined the Learn More modal image display area by locking image frame dimensions, so uploaded image aspect ratios no longer affect the container size.</p>
                        <p>Enhanced the avatar menu by adding user avatar, username, and email display.</p>
                        <p>Refactored profile page layout and added an account deletion button with a dedicated confirmation modal flow.</p>
                        <hr />

                        <h3>Update Date: 5/25/2026</h3>
                        <p>Started integrating Pinecone Nexus as the next-generation RAG backend for the Living Atlas Helper Chatbot, replacing the previous local-embedding pipeline. (In progress)</p>
                        <p>Implemented fullscreen map mode with hover-reveal top navbar and left sidebar — hovering near the top or left edge slides the corresponding UI element into view, with full panel support.</p>
                        <p>Redesigned the chatbot floating widget and sidebar panel to match the visual style of other panels (Upload Panel, Custom Layers, Basemap) — consistent background, header, buttons, and color scheme.</p>
                        <hr />

                        <h3>Update Date: 5/16/2026</h3>
                        <p>Enhanced Service/Layer Info Modal with improved display of child layers, legends, positioning, and active state indicators.</p>
                        <p>Added field-based filtering for ArcGIS layers within the Layer Info Modal.</p>
                        <p>Aligned rendering z-index for clickable vectors with raster image overlays.</p>
                        <p>Improved map zoom control with draggable pointer for real-time z-value adjustment.</p>
                        <p>Refined UI appearance of Upload Panel, Custom Layers Panel, and Learn More Modal.</p>
                        <p>Implemented responsive sizing for Top Navigation Bar and Left Sidebar based on screen dimensions.</p>
                        <p>Updated User Manual, onboarding workflows, and organized User Manual tabs.</p>
                        <p>Enhanced Basemap Panel with additional options, functionality improvements, and visual refinements.</p>
                        <p>Extended image overlay support from PNG-only to include JPEG format in Add Card from Map workflow.</p>
                        <p>Updated User Manual, onboarding tutorials, and chatbot knowledge base for all new features and changes.</p>
                        <hr />

                        <h3>Update Date: 5/15/2026</h3>
                        <p>Improved chatbot response formatting and style, making answers cleaner, more structured, and easier to read.</p>
                        <p>Refactored the left sidebar Search Panel to support searching across homepage features and jumping directly to trigger matching functions.</p>
                        <p>Fixed an issue where user preferences could reset after backend restart; preferences are now persisted in the database reliably.</p>
                        <hr />

                        <h3>Update Date: 5/14/2026</h3>
                        <p>Fixed the Living Atlas Helper Chatbot API issues so the chatbot is now operational.</p>
                        <p>Improved the chatbot knowledge base content to provide better user-facing answers.</p>
                        <p>Added a chatbot display mode switch between floating widget and left sidebar panel.</p>
                        <hr />

                        <h3>Update Date: 5/13/2026</h3>
                        <p>Completed a full RAG pipeline for the Living Atlas Helper Chatbot, using a local embedding model and DeepSeek as the generation model. Due to an ongoing AI service connection issue, the chatbot is temporarily unavailable.</p>
                        <p>Added a map zoom level (Z) axis control to the Mapbox native control group, displaying the user's current zoom level in real time.</p>
                        <hr />

                        <h3>Update Date: 5/11/2026</h3>
                        <p>Added the AI chatbot hidden floating UI window and backend wiring. Full features (RAG and conversation memory) are still under development and currently unavailable.</p>
                        <p>Added a new onboarding button under the left sidebar changelog button for general app onboarding, with a brief walkthrough of each panel and guidance that each panel has its own onboarding.</p>
                        <p>Expanded the User Manual with detailed Service/Layer Info modal documentation.</p>
                        <p>Added a new Mapbox toolbar feature to place PNG images on the map. PNG overlays can now serve as card representations and support move, rotate, and resize transformations.</p>
                        <p>Integrated the Add Single Point trigger into the Mapbox toolbar, and consolidated Add Single Point, Polygon Tools, and Add PNG into the Add Cards from Map (+) modal.</p>
                        <p>Added top-right Help and Onboarding buttons to the Create Card modal, matching the Card Container style, with Help redirecting to the relevant User Manual section.</p>
                        <hr />

                        <h3>Update Date: 5/10/2026</h3>
                        <p>Added onboarding tours for the ArcGIS Upload Panel, Custom Layers Panel, and Basemap Panel.</p>
                        <p>Cards and card titles now adapt to different screen sizes automatically.</p>
                        <p>Updated the Custom Layers Panel search and navigate-to-result functionality to match the behavior of the Upload Panel.</p>
                        <p>Improved service row appearance; the service Learn More modal now includes an opacity control, links to open its layers directly, and a historical layer timeline view.</p>
                        <hr />
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
                    </>
                )}
            </div>
        </div>
    );
}

export default ChangelogHistory;

