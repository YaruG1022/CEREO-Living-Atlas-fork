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

