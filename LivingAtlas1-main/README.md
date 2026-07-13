# LivingAtlas1


## To use 
- Make sure you have these installed
    - Python3
    - Node.js
    - npm
- Create a virtual environment
    - `python -m venv myenv`
    - On Windows `myenv/Scripts/activate`
    - On macOS and Linux `source myenv/bin/activate`
- Managing the virtual environment
    - When you want to leave use `deactivate`
    - Make sure to upgrade pip `python -m pip install --upgrade pip`
- Install packages from requirements.txt before running the Living Atlas
    - `pip install -r requirements.txt`


### To Run the Living Atlas
- In 1st terminal navigate to the /LivingAtlas1/client folder 
    - Use `npm start`
- In 2nd terminal navigate to the /LivingAtlas1/backend folder
    - Use `uvicorn main:app --reload`

### Chatbot Agent Skill (ArcGIS Live Catalog)
- The `/chat/ask` endpoint now includes a lightweight agent layer with skills.
- The first enabled skill fetches live ArcGIS service catalog data from:
    - `https://gis.ecology.wa.gov/serverext/rest/services`
- Optional env var to override source URL:
    - `ARCGIS_REST_SERVICES_URL`
- Optional env var for fallback base URLs (comma-separated):
    - `ARCGIS_REST_SERVICES_FALLBACK_URLS`
    - Example: `https://gis.ecology.wa.gov/server/rest/services`
- The skill is triggered automatically for ArcGIS/service/layer/folder-related questions and injects live catalog context into chatbot answers.


---
**Developed by Students at WSU**