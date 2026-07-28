from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from database import cur, conn
import json

arcgis_router = APIRouter(prefix="/arcgis", tags=["ArcGIS"])

_STATE_MAP = {
    "wa": "washington",
    "washington": "washington",
    "id": "idaho",
    "idaho": "idaho",
    "or": "oregon",
    "oregon": "oregon",
}

def _normalize_state(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    key = s.strip().lower()
    return _STATE_MAP.get(key, key)

class RemoveServiceRequest(BaseModel):
    service_key: str
    removed_by: Optional[str] = None
    layers_removed: Optional[List[str]] = None

class RenameFolderRequest(BaseModel):
    old_folder_name: str
    new_folder_name: str
    state: Optional[str] = None

class RenameServiceRequest(BaseModel):
    service_key: str
    new_label: str

@arcgis_router.get("/services")
def get_services(
    state: Optional[str] = Query(None, description="WA|ID|OR or full state name"),
    type: Optional[str] = Query("MapServer", description="ArcGIS service type or 'all'"),
):
    if cur is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    clauses: List[str] = []
    params: List[str] = []

    norm_state = _normalize_state(state)
    if norm_state:
        clauses.append("LOWER(state) = %s")
        params.append(norm_state)

    if type and type.lower() != "all":
        clauses.append("type = %s")
        params.append(type)

    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"""
        SELECT
            service_key AS key,
            label,
            url,
            COALESCE(folder, 'Root') AS folder,
            type,
            state
        FROM arcgis_services
        {where_sql}
        ORDER BY folder, label
    """.strip()

    try:
        cur.execute(sql, params)
        rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")

    columns = ["key", "label", "url", "folder", "type", "state"]
    data = [dict(zip(columns, row)) for row in rows]
    return data

@arcgis_router.post("/services/remove")
def remove_service(request: RemoveServiceRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Start transaction
        conn.autocommit = False
        
        # Ensure removed_arcgis_services table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS removed_arcgis_services (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(255) NOT NULL,
                label VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                folder VARCHAR(255) DEFAULT 'Root',
                type VARCHAR(50) NOT NULL,
                state VARCHAR(50) NOT NULL,
                removed_by VARCHAR(255),
                layers_removed TEXT[],
                removed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_removed_service_per_state UNIQUE (service_key, state, type)
            )
        """)
        
        # First, get the service details from the main table
        cur.execute("""
            SELECT service_key, label, url, folder, type, state 
            FROM arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        service_row = cur.fetchone()
        if not service_row:
            conn.rollback()
            conn.autocommit = True
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_key, label, url, folder, type_val, state = service_row
        
        # Check if service with same key already exists in removed services table
        cur.execute("""
            SELECT label FROM removed_arcgis_services 
            WHERE service_key = %s
        """, (service_key,))
        
        existing_removed_service = cur.fetchone()
        if existing_removed_service:
            conn.rollback()
            conn.autocommit = True
            existing_removed_label = existing_removed_service[0]
            raise HTTPException(
                status_code=409, 
                detail=f"Duplicate service detected: A service with the same key '{service_key}' already exists in the removed services panel as '{existing_removed_label}'. To remove the current service '{label}', please first permanently delete the existing removed service using the delete button in the removed services panel, then try removing again."
            )
        
        # Insert into removed_arcgis_services table
        cur.execute("""
            INSERT INTO removed_arcgis_services 
            (service_key, label, url, folder, type, state, removed_by, layers_removed)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            service_key,
            label, 
            url,
            folder,
            type_val,
            state,
            request.removed_by,
            request.layers_removed or []
        ))
        
        # Remove from main arcgis_services table
        cur.execute("""
            DELETE FROM arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        # Commit transaction
        conn.commit()
        conn.autocommit = True
        
        return {
            "success": True,
            "message": f"Service '{label}' moved to removed services",
            "service_key": service_key
        }
        
    except Exception as e:
        conn.rollback()
        conn.autocommit = True
        raise HTTPException(status_code=500, detail=f"Failed to remove service: {str(e)}")

@arcgis_router.get("/services/removed")
def get_removed_services(
    state: Optional[str] = Query(None, description="WA|ID|OR or full state name"),
    type: Optional[str] = Query("MapServer", description="ArcGIS service type or 'all'"),
):
    if cur is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Ensure removed_arcgis_services table exists
        print("[DEBUG] Creating removed_arcgis_services table if not exists...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS removed_arcgis_services (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(255) NOT NULL,
                label VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                folder VARCHAR(255) DEFAULT 'Root',
                type VARCHAR(50) NOT NULL,
                state VARCHAR(50) NOT NULL,
                removed_by VARCHAR(255),
                layers_removed TEXT[],
                removed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_removed_service_per_state UNIQUE (service_key, state, type)
            )
        """)
        conn.commit()
        print("[DEBUG] Table created/verified successfully")
    except Exception as e:
        # If table creation fails, continue anyway as it might already exist
        print(f"[WARNING] Table creation failed, continuing: {e}")
        try:
            conn.rollback()
        except:
            pass

    clauses: List[str] = []
    params: List[str] = []

    norm_state = _normalize_state(state)
    if norm_state:
        clauses.append("LOWER(state) = %s")
        params.append(norm_state)

    if type and type.lower() != "all":
        clauses.append("type = %s")
        params.append(type)

    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"""
        SELECT
            service_key AS key,
            label,
            url,
            COALESCE(folder, 'Root') AS folder,
            type,
            state,
            removed_date,
            removed_by,
            layers_removed
        FROM removed_arcgis_services
        {where_sql}
        ORDER BY removed_date DESC
    """.strip()

    try:
        print(f"[DEBUG] Executing query: {sql}")
        print(f"[DEBUG] With params: {params}")
        cur.execute(sql, params)
        rows = cur.fetchall()
        print(f"[DEBUG] Query returned {len(rows)} rows")
    except Exception as e:
        print(f"[ERROR] Database query failed: {e}")
        print(f"[ERROR] SQL: {sql}")
        print(f"[ERROR] Params: {params}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")

    columns = ["key", "label", "url", "folder", "type", "state", "removed_date", "removed_by", "layers_removed"]
    data = [dict(zip(columns, row)) for row in rows]
    print(f"[DEBUG] Returning {len(data)} removed services")
    return data

@arcgis_router.put("/services/rename-folder")
def rename_folder(request: RenameFolderRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    
    # Validate input
    if not request.new_folder_name.strip():
        raise HTTPException(status_code=400, detail="New folder name cannot be empty")
    
    if len(request.new_folder_name.strip()) > 255:
        raise HTTPException(status_code=400, detail="Folder name cannot exceed 255 characters")
    
    if request.old_folder_name.strip() == request.new_folder_name.strip():
        raise HTTPException(status_code=400, detail="New folder name must be different from current name")

    try:
        # Start transaction
        conn.autocommit = False
        
        # Build WHERE clause
        where_clauses = ["COALESCE(folder, 'Root') = %s"]
        params = [request.old_folder_name or 'Root']
        
        if request.state:
            norm_state = _normalize_state(request.state)
            if norm_state:
                where_clauses.append("LOWER(state) = %s")
                params.append(norm_state)
        
        # Check if any services exist with the old folder name
        check_sql = f"""
            SELECT COUNT(*) FROM arcgis_services 
            WHERE {' AND '.join(where_clauses)}
        """
        
        cur.execute(check_sql, params)
        count = cur.fetchone()[0]
        
        if count == 0:
            conn.rollback()
            conn.autocommit = True
            raise HTTPException(status_code=404, detail="No services found with the specified folder name")
        
        # Update folder name for all matching services
        update_sql = f"""
            UPDATE arcgis_services 
            SET folder = %s 
            WHERE {' AND '.join(where_clauses)}
        """
        
        update_params = [request.new_folder_name.strip()] + params
        cur.execute(update_sql, update_params)
        
        updated_count = cur.rowcount
        
        # Commit transaction
        conn.commit()
        conn.autocommit = True
        
        return {
            "success": True,
            "message": f"Successfully renamed folder '{request.old_folder_name}' to '{request.new_folder_name}'",
            "services_updated": updated_count
        }
        
    except Exception as e:
        conn.rollback()
        conn.autocommit = True
        raise HTTPException(status_code=500, detail=f"Failed to rename folder: {str(e)}")

@arcgis_router.put("/services/rename")
def rename_service(request: RenameServiceRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    
    # Validate input
    if not request.new_label.strip():
        raise HTTPException(status_code=400, detail="New service label cannot be empty")
    
    if len(request.new_label.strip()) > 255:
        raise HTTPException(status_code=400, detail="Service label cannot exceed 255 characters")

    try:
        # Start transaction
        conn.autocommit = False
        
        # Check if service exists
        cur.execute("""
            SELECT label FROM arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        result = cur.fetchone()
        if not result:
            conn.rollback()
            conn.autocommit = True
            raise HTTPException(status_code=404, detail="Service not found")
        
        old_label = result[0]
        
        if old_label == request.new_label.strip():
            conn.rollback()
            conn.autocommit = True
            raise HTTPException(status_code=400, detail="New service label must be different from current label")
        
        # Update service label
        cur.execute("""
            UPDATE arcgis_services 
            SET label = %s 
            WHERE service_key = %s
        """, (request.new_label.strip(), request.service_key))
        
        # Commit transaction
        conn.commit()
        conn.autocommit = True
        
        return {
            "success": True,
            "message": f"Successfully renamed service from '{old_label}' to '{request.new_label}'",
            "service_key": request.service_key,
            "old_label": old_label,
            "new_label": request.new_label.strip()
        }
        
    except Exception as e:
        conn.rollback()
        conn.autocommit = True
        raise HTTPException(status_code=500, detail=f"Failed to rename service: {str(e)}")

class RestoreServiceRequest(BaseModel):
    service_key: str

class DeleteRemovedServiceRequest(BaseModel):
    service_key: str

class BulkAddServicesRequest(BaseModel):
    services: List[dict]

@arcgis_router.post("/services/restore")
def restore_service(request: RestoreServiceRequest):
    """Restore a service from removed_arcgis_services back to arcgis_services"""
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Start transaction
        conn.autocommit = False
        
        # Ensure removed_arcgis_services table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS removed_arcgis_services (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(255) NOT NULL,
                label VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                folder VARCHAR(255) DEFAULT 'Root',
                type VARCHAR(50) NOT NULL,
                state VARCHAR(50) NOT NULL,
                removed_by VARCHAR(255),
                layers_removed TEXT[],
                removed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_removed_service_per_state UNIQUE (service_key, state, type)
            )
        """)
        
        # First, get the service details from the removed table
        cur.execute("""
            SELECT service_key, label, url, folder, type, state 
            FROM removed_arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        service_row = cur.fetchone()
        if not service_row:
            conn.rollback()
            conn.autocommit = True
            raise HTTPException(status_code=404, detail="Removed service not found")
        
        service_key, label, url, folder, type_val, state = service_row
        
        # Check if service already exists in main table (to avoid duplicates)
        cur.execute("""
            SELECT label FROM arcgis_services 
            WHERE service_key = %s
        """, (service_key,))
        
        existing_service = cur.fetchone()
        if existing_service:
            conn.rollback()
            conn.autocommit = True
            existing_label = existing_service[0]
            raise HTTPException(
                status_code=409, 
                detail=f"Duplicate service detected: A service with the same key '{service_key}' already exists in the upload panel. To restore '{label}', please permanently delete this service from the removed services panel first using the delete button (trash icon), then try restoring the new one from the upload panel."
            )
        
        # Insert back into main arcgis_services table
        cur.execute("""
            INSERT INTO arcgis_services 
            (service_key, label, url, folder, type, state)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            service_key,
            label, 
            url,
            folder,
            type_val,
            state
        ))
        
        # Remove from removed_arcgis_services table
        cur.execute("""
            DELETE FROM removed_arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        # Commit transaction
        conn.commit()
        conn.autocommit = True
        
        return {
            "success": True,
            "message": f"Service '{label}' restored to active services",
            "service_key": service_key
        }
        
    except Exception as e:
        conn.rollback()
        conn.autocommit = True
        raise HTTPException(status_code=500, detail=f"Failed to restore service: {str(e)}")

@arcgis_router.delete("/services/removed")
def permanently_delete_removed_service(request: DeleteRemovedServiceRequest):
    """Permanently delete a service from removed_arcgis_services"""
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Ensure removed_arcgis_services table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS removed_arcgis_services (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(255) NOT NULL,
                label VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                folder VARCHAR(255) DEFAULT 'Root',
                type VARCHAR(50) NOT NULL,
                state VARCHAR(50) NOT NULL,
                removed_by VARCHAR(255),
                layers_removed TEXT[],
                removed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_removed_service_per_state UNIQUE (service_key, state, type)
            )
        """)
        conn.commit()
        # Check if service exists in removed table
        cur.execute("""
            SELECT label FROM removed_arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        service_row = cur.fetchone()
        if not service_row:
            raise HTTPException(status_code=404, detail="Removed service not found")
        
        label = service_row[0]
        
        # Permanently delete from removed_arcgis_services table
        cur.execute("""
            DELETE FROM removed_arcgis_services 
            WHERE service_key = %s
        """, (request.service_key,))
        
        conn.commit()
        
        return {
            "success": True,
            "message": f"Service '{label}' permanently deleted",
            "service_key": request.service_key
        }
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to permanently delete service: {str(e)}")

@arcgis_router.delete("/services/removed/all")
def clear_all_removed_services():
    """Permanently delete all services from removed_arcgis_services"""
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Ensure removed_arcgis_services table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS removed_arcgis_services (
                id SERIAL PRIMARY KEY,
                service_key VARCHAR(255) NOT NULL,
                label VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                folder VARCHAR(255) DEFAULT 'Root',
                type VARCHAR(50) NOT NULL,
                state VARCHAR(50) NOT NULL,
                removed_by VARCHAR(255),
                layers_removed TEXT[],
                removed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_removed_service_per_state UNIQUE (service_key, state, type)
            )
        """)
        conn.commit()
        # Get count before deletion
        cur.execute("SELECT COUNT(*) FROM removed_arcgis_services")
        count_before = cur.fetchone()[0]
        
        # Clear all removed services
        cur.execute("DELETE FROM removed_arcgis_services")
        
        conn.commit()
        
        return {
            "success": True,
            "message": f"All {count_before} removed services permanently deleted",
            "count": count_before
        }
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear all removed services: {str(e)}")

@arcgis_router.post("/services/bulk-add")
def bulk_add_services(request: BulkAddServicesRequest):
    """Add multiple new ArcGIS services to the database (skips existing ones by key)"""
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    
    if not request.services:
        return {"success": True, "added": 0, "skipped": 0, "message": "No services provided"}
    
    try:
        # Start transaction
        conn.autocommit = False
        
        added_count = 0
        skipped_count = 0
        
        for service in request.services:
            # Validate required fields
            required_fields = ['key', 'label', 'url', 'folder', 'type', 'state']
            if not all(field in service for field in required_fields):
                continue
            
            # Check if service already exists by key
            cur.execute("""
                SELECT COUNT(*) FROM arcgis_services 
                WHERE service_key = %s
            """, (service['key'],))
            
            exists = cur.fetchone()[0] > 0
            
            if not exists:
                # Insert new service
                cur.execute("""
                    INSERT INTO arcgis_services (service_key, label, url, folder, type, state)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    service['key'],
                    service['label'],
                    service['url'],
                    service['folder'],
                    service['type'],
                    service['state']
                ))
                added_count += 1
            else:
                skipped_count += 1
        
        # Commit transaction
        conn.commit()
        conn.autocommit = True
        
        return {
            "success": True,
            "added": added_count,
            "skipped": skipped_count,
            "total_processed": len(request.services),
            "message": f"Successfully added {added_count} new services, skipped {skipped_count} existing ones"
        }
        
    except Exception as e:
        conn.rollback()
        conn.autocommit = True
        raise HTTPException(status_code=500, detail=f"Failed to bulk add services: {str(e)}")


# --- User layer selections persistence ---

class SaveSelectionsRequest(BaseModel):
    user_email: str
    state_code: str
    data_source: str = 'database'
    selections: Dict[str, Any]  # { checkedLayerIds: {...}, checkedSublayerIds: {...} }

@arcgis_router.post("/selections/save")
def save_selections(request: SaveSelectionsRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Ensure table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_layer_selections (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL,
                state_code VARCHAR(10) NOT NULL,
                data_source VARCHAR(20) NOT NULL DEFAULT 'database',
                selections JSONB NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_user_state_source UNIQUE (user_email, state_code, data_source)
            )
        """)
        conn.commit()

        # Upsert selections
        cur.execute("""
            INSERT INTO user_layer_selections (user_email, state_code, data_source, selections, updated_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (user_email, state_code, data_source)
            DO UPDATE SET selections = EXCLUDED.selections, updated_at = CURRENT_TIMESTAMP
        """, (request.user_email, request.state_code.upper(), request.data_source, json.dumps(request.selections)))
        conn.commit()

        return {"success": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save selections: {str(e)}")


@arcgis_router.get("/selections/load")
def load_selections(
    user_email: str = Query(...),
    state_code: str = Query(...),
    data_source: str = Query('database'),
):
    if cur is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        # Ensure table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_layer_selections (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL,
                state_code VARCHAR(10) NOT NULL,
                data_source VARCHAR(20) NOT NULL DEFAULT 'database',
                selections JSONB NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_user_state_source UNIQUE (user_email, state_code, data_source)
            )
        """)
        conn.commit()

        cur.execute("""
            SELECT selections FROM user_layer_selections
            WHERE user_email = %s AND state_code = %s AND data_source = %s
        """, (user_email, state_code.upper(), data_source))

        row = cur.fetchone()
        if row:
            return {"selections": row[0]}
        return {"selections": None}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to load selections: {str(e)}")


# --- Custom Layers (per-user saved layers) ---

class SaveCustomLayerRequest(BaseModel):
    user_email: str
    service_key: str
    label: str
    url: str
    folder: str = 'Root'
    type: str = 'MapServer'
    state: str = ''
    # Serialized GeoJSON FeatureCollection — only set for uploaded file layers
    # (type = 'uploaded'); NULL for ArcGIS service layers.
    geojson: Optional[str] = None

class DeleteCustomLayerRequest(BaseModel):
    user_email: str
    service_key: str

class ReorderCustomLayersRequest(BaseModel):
    user_email: str
    order: List[Dict[str, Any]]  # [{ service_key, folder, sort_order }]

def _ensure_custom_layers_table():
    """Create the user_custom_layers table if it does not exist."""
    if not cur or not conn:
        return
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_custom_layers (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL,
                service_key VARCHAR(255) NOT NULL,
                label VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                folder VARCHAR(255) DEFAULT 'Root',
                type VARCHAR(50) NOT NULL DEFAULT 'MapServer',
                state VARCHAR(50) DEFAULT '',
                sort_order INTEGER DEFAULT 0,
                saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_user_custom_layer UNIQUE (user_email, service_key)
            )
        """)
        conn.commit()
        # Add sort_order column if table already exists without it
        try:
            cur.execute("ALTER TABLE user_custom_layers ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0")
            conn.commit()
        except Exception:
            conn.rollback()
        # Add layer_order column for per-service layer ordering
        try:
            cur.execute("ALTER TABLE user_custom_layers ADD COLUMN IF NOT EXISTS layer_order TEXT DEFAULT NULL")
            conn.commit()
        except Exception:
            conn.rollback()
        # Add geojson column holding uploaded file layers' feature data
        try:
            cur.execute("ALTER TABLE user_custom_layers ADD COLUMN IF NOT EXISTS geojson TEXT DEFAULT NULL")
            conn.commit()
        except Exception:
            conn.rollback()
    except Exception as e:
        conn.rollback()
        print(f"[WARNING] Custom layers table creation failed: {e}")

@arcgis_router.post("/custom-layers/save")
def save_custom_layer(request: SaveCustomLayerRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    if not request.service_key or not request.service_key.strip():
        raise HTTPException(status_code=400, detail="service_key is required")

    _ensure_custom_layers_table()
    _ensure_custom_folders_table()
    try:
        # Assign sort_order = max + 1 for new entries
        cur.execute("""
            SELECT COALESCE(MAX(sort_order), -1) + 1 FROM user_custom_layers WHERE user_email = %s
        """, (request.user_email.strip(),))
        next_order = cur.fetchone()[0]
        cur.execute("""
            INSERT INTO user_custom_layers (user_email, service_key, label, url, folder, type, state, sort_order, geojson, saved_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (user_email, service_key)
            DO UPDATE SET label = EXCLUDED.label, url = EXCLUDED.url, folder = EXCLUDED.folder,
                          type = EXCLUDED.type, state = EXCLUDED.state, saved_at = CURRENT_TIMESTAMP,
                          -- a rename/move posts no geojson; keep the stored features in that case
                          geojson = COALESCE(EXCLUDED.geojson, user_custom_layers.geojson)
        """, (
            request.user_email.strip(),
            request.service_key.strip(),
            request.label.strip(),
            request.url.strip(),
            request.folder.strip(),
            request.type.strip(),
            request.state.strip(),
            next_order,
            request.geojson,
        ))
        # Auto-create the parent folder so it persists even when all services are removed
        folder = request.folder.strip()
        if folder and folder != 'Root':
            cur.execute("""
                SELECT COALESCE(MAX(sort_order), -1) + 1 FROM user_custom_folders WHERE user_email = %s
            """, (request.user_email.strip(),))
            folder_order = cur.fetchone()[0]
            cur.execute("""
                INSERT INTO user_custom_folders (user_email, folder_name, sort_order)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_email, folder_name) DO NOTHING
            """, (request.user_email.strip(), folder, folder_order))
        conn.commit()
        return {"success": True, "message": f"Layer '{request.label}' saved to custom layers"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save custom layer: {str(e)}")

@arcgis_router.get("/custom-layers")
def get_custom_layers(
    user_email: str = Query(..., description="User email"),
):
    if cur is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not user_email or not user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")

    _ensure_custom_layers_table()
    try:
        cur.execute("""
            SELECT service_key AS key, label, url, folder, type, state, sort_order, layer_order, saved_at
            FROM user_custom_layers
            WHERE user_email = %s
            ORDER BY sort_order, saved_at
        """, (user_email.strip(),))
        rows = cur.fetchall()
        columns = ["key", "label", "url", "folder", "type", "state", "sort_order", "layer_order", "saved_at"]
        data = [dict(zip(columns, row)) for row in rows]
        return data
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to load custom layers: {str(e)}")

@arcgis_router.get("/custom-layers/geojson")
def get_custom_layer_geojson(
    user_email: str = Query(..., description="User email"),
    service_key: str = Query(..., description="Custom layer service key"),
):
    """Feature data of a single uploaded custom layer. Kept out of the
    /custom-layers list response so that panel load stays small — uploaded
    shapefiles are routinely multi-megabyte."""
    if cur is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not user_email or not user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    if not service_key or not service_key.strip():
        raise HTTPException(status_code=400, detail="service_key is required")

    _ensure_custom_layers_table()
    try:
        cur.execute("""
            SELECT geojson FROM user_custom_layers
            WHERE user_email = %s AND service_key = %s
        """, (user_email.strip(), service_key.strip()))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Custom layer not found")
        return {"geojson": json.loads(row[0]) if row[0] else None}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to load custom layer geojson: {str(e)}")

@arcgis_router.delete("/custom-layers")
def delete_custom_layer(request: DeleteCustomLayerRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")

    _ensure_custom_layers_table()
    try:
        cur.execute("""
            DELETE FROM user_custom_layers
            WHERE user_email = %s AND service_key = %s
        """, (request.user_email.strip(), request.service_key.strip()))
        deleted = cur.rowcount
        conn.commit()
        if deleted == 0:
            raise HTTPException(status_code=404, detail="Custom layer not found")
        return {"success": True, "message": "Custom layer removed"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete custom layer: {str(e)}")

@arcgis_router.put("/custom-layers/reorder")
def reorder_custom_layers(request: ReorderCustomLayersRequest):
    """Batch-update sort_order (and optionally folder) for a user's custom layers."""
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")

    _ensure_custom_layers_table()
    try:
        for item in request.order:
            service_key = item.get("service_key", "").strip()
            sort_order = int(item.get("sort_order", 0))
            folder = item.get("folder")
            if not service_key:
                continue
            if folder is not None:
                cur.execute("""
                    UPDATE user_custom_layers
                    SET sort_order = %s, folder = %s
                    WHERE user_email = %s AND service_key = %s
                """, (sort_order, folder.strip(), request.user_email.strip(), service_key))
            else:
                cur.execute("""
                    UPDATE user_custom_layers
                    SET sort_order = %s
                    WHERE user_email = %s AND service_key = %s
                """, (sort_order, request.user_email.strip(), service_key))
        conn.commit()
        return {"success": True, "message": "Custom layers reordered"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reorder custom layers: {str(e)}")

class SaveLayerOrderRequest(BaseModel):
    user_email: str
    service_key: str
    layer_order: List[int]  # ordered list of layer IDs

@arcgis_router.put("/custom-layers/layer-order")
def save_layer_order(request: SaveLayerOrderRequest):
    """Save the display order of layers within a specific custom service."""
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    if not request.service_key or not request.service_key.strip():
        raise HTTPException(status_code=400, detail="service_key is required")

    _ensure_custom_layers_table()
    try:
        import json
        order_json = json.dumps(request.layer_order)
        cur.execute("""
            UPDATE user_custom_layers
            SET layer_order = %s
            WHERE user_email = %s AND service_key = %s
        """, (order_json, request.user_email.strip(), request.service_key.strip()))
        updated = cur.rowcount
        conn.commit()
        if updated == 0:
            raise HTTPException(status_code=404, detail="Custom layer not found")
        return {"success": True, "message": "Layer order saved"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save layer order: {str(e)}")

# --- Custom Folders (user-created empty folders) ---

def _ensure_custom_folders_table():
    if not cur or not conn:
        return
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_custom_folders (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL,
                folder_name VARCHAR(255) NOT NULL,
                sort_order INTEGER DEFAULT 0,
                CONSTRAINT unique_user_folder UNIQUE (user_email, folder_name)
            )
        """)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[WARNING] Custom folders table creation failed: {e}")

class CreateFolderRequest(BaseModel):
    user_email: str
    folder_name: str

class DeleteFolderRequest(BaseModel):
    user_email: str
    folder_name: str

class RenameFolderRequest(BaseModel):
    user_email: str
    old_name: str
    new_name: str

@arcgis_router.get("/custom-folders")
def get_custom_folders(user_email: str = Query(..., description="User email")):
    if cur is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not user_email or not user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    _ensure_custom_folders_table()
    try:
        cur.execute("""
            SELECT folder_name, sort_order FROM user_custom_folders
            WHERE user_email = %s ORDER BY sort_order
        """, (user_email.strip(),))
        rows = cur.fetchall()
        return [{"folder_name": r[0], "sort_order": r[1]} for r in rows]
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to load custom folders: {str(e)}")

@arcgis_router.post("/custom-folders")
def create_custom_folder(request: CreateFolderRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    if not request.folder_name or not request.folder_name.strip():
        raise HTTPException(status_code=400, detail="folder_name is required")
    _ensure_custom_folders_table()
    try:
        cur.execute("""
            SELECT COALESCE(MAX(sort_order), -1) + 1 FROM user_custom_folders WHERE user_email = %s
        """, (request.user_email.strip(),))
        next_order = cur.fetchone()[0]
        cur.execute("""
            INSERT INTO user_custom_folders (user_email, folder_name, sort_order)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_email, folder_name) DO NOTHING
        """, (request.user_email.strip(), request.folder_name.strip(), next_order))
        conn.commit()
        return {"success": True, "folder_name": request.folder_name.strip(), "sort_order": next_order}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create folder: {str(e)}")

@arcgis_router.delete("/custom-folders")
def delete_custom_folder(request: DeleteFolderRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    _ensure_custom_folders_table()
    _ensure_custom_layers_table()
    try:
        # Move services in this folder back to Root
        cur.execute("""
            UPDATE user_custom_layers SET folder = 'Root'
            WHERE user_email = %s AND folder = %s
        """, (request.user_email.strip(), request.folder_name.strip()))
        cur.execute("""
            DELETE FROM user_custom_folders
            WHERE user_email = %s AND folder_name = %s
        """, (request.user_email.strip(), request.folder_name.strip()))
        conn.commit()
        return {"success": True, "message": f"Folder '{request.folder_name}' deleted"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete folder: {str(e)}")

@arcgis_router.put("/custom-folders/rename")
def rename_custom_folder(request: RenameFolderRequest):
    if cur is None or conn is None:
        raise HTTPException(status_code=500, detail="Database connection not available")
    if not request.user_email or not request.user_email.strip():
        raise HTTPException(status_code=400, detail="user_email is required")
    if not request.new_name or not request.new_name.strip():
        raise HTTPException(status_code=400, detail="new_name is required")
    _ensure_custom_folders_table()
    _ensure_custom_layers_table()
    try:
        # Rename in custom_folders table
        cur.execute("""
            UPDATE user_custom_folders SET folder_name = %s
            WHERE user_email = %s AND folder_name = %s
        """, (request.new_name.strip(), request.user_email.strip(), request.old_name.strip()))
        # Also update all services in this folder
        cur.execute("""
            UPDATE user_custom_layers SET folder = %s
            WHERE user_email = %s AND folder = %s
        """, (request.new_name.strip(), request.user_email.strip(), request.old_name.strip()))
        conn.commit()
        return {"success": True, "message": f"Folder renamed to '{request.new_name}'"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to rename folder: {str(e)}")