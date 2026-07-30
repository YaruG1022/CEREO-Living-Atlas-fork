import mapboxgl from 'mapbox-gl';

// Track all active ArcGIS popups for stacking offset
const activePopups = [];

/**
 * Show a popup for a feature from any ArcGIS service.
 * @param {Object} e - Mapbox event
 * @param {Object} layer - Layer object (should include .id and .serviceUrl)
 */
export async function showArcgisPopup(e, layer) {
    const feature = e.features[0];
    let layerMeta = {};
    const serviceUrl = layer.serviceUrl; // must be passed in layer object

    // Uploaded file layers have no service to describe them; they pass their own name instead.
    if (serviceUrl) {
        try {
            const resp = await fetch(`${serviceUrl}/${layer.id}?f=json`);
            layerMeta = await resp.json();
        } catch (err) {
            layerMeta = {};
        }
    }
    const layerName = layerMeta.name || layer.name || "Layer";
    const rawDescription = layerMeta.description || "";
    // Strip HTML tags to prevent breaking popup DOM when expanding
    const layerDescription = rawDescription.replace(/<[^>]*>/g, '').trim();

    // Collapse logic for long descriptions
    const descShort = layerDescription.length > 120 ? layerDescription.slice(0, 120) + "..." : layerDescription;
    const hasLongDesc = layerDescription.length > 120;
    const descId = `desc-${layer.id}-${feature.properties.OBJECTID || Math.floor(Math.random()*100000)}`;

    const propertyEntries = Object.entries(feature.properties || {});

    let html = `
  <div class="arcgis-popup-wrapper">
    <div class="arcgis-popup-header">
      <h3 style="margin:0;font-size:1.1em;">${layerName}</h3>
    </div>
    <div class="arcgis-popup-body">
    ${layerDescription ? `
      <div style="font-size:0.95em;color:#444;margin-bottom:6px;">
        <div id="${descId}-container" style="display:inline;">
          <span id="${descId}">${descShort}</span>
        </div>
        ${hasLongDesc ? `<a href="#" id="${descId}-toggle" style="margin-left:8px;font-size:0.95em;">Show more</a>` : ""}
      </div>
    ` : ""}
    <table>
      <tbody>
        ${propertyEntries.length === 0
          ? `<tr><td style="color:#777;">No attributes for this feature.</td></tr>`
          : propertyEntries.map(([key, value]) =>
          `<tr>
            <td style="font-weight:bold;padding-right:6px;vertical-align:top;">${key}</td>
            <td style="word-break:break-word;overflow-wrap:anywhere;">${String(value)}</td>
          </tr>`
        ).join('')}
      </tbody>
    </table>
    </div>
  </div>
`;

    // Calculate stacking offset: each successive popup shifts upper-right
    const stackIndex = activePopups.length;
    const stackOffset = 10; // px per popup
    const offsetX = 20 - stackIndex * stackOffset;
    const offsetY = 20 + stackIndex * stackOffset;

    const popup = new mapboxgl.Popup({ offset: [offsetX, offsetY], closeButton: true, anchor: 'bottom' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(e.target._map || e.target);

    // Track this popup and set z-index for stacking order
    activePopups.push(popup);
    const popupEl = popup.getElement();
    if (popupEl) {
        popupEl.style.zIndex = 1000 + stackIndex;
        popupEl.classList.add('arcgis-stacked-popup');
    }

    popup.on('close', () => {
        const idx = activePopups.indexOf(popup);
        if (idx !== -1) activePopups.splice(idx, 1);
    });

    // Add collapse/expand logic after popup is added to DOM
    if (hasLongDesc) {
        setTimeout(() => {
            const descSpan = document.getElementById(descId);
            const toggleLink = document.getElementById(`${descId}-toggle`);
            let expanded = false;
            function updateDesc() {
                if (descSpan) {
                    descSpan.textContent = expanded ? layerDescription : descShort;
                }
                if (toggleLink) toggleLink.textContent = expanded ? "Show less" : "Show more";
            }
            if (toggleLink) {
                toggleLink.onclick = function(ev) {
                    ev.preventDefault();
                    expanded = !expanded;
                    updateDesc();
                };
            }
        }, 100);
    }

    return popup;
}