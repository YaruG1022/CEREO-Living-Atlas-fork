"""
filterbar
    allCards
    tag list
    all cards by tag      --ToDo: protect against sql injection
    search bar            
"""

from fastapi import APIRouter, HTTPException
from database import get_connection

filterbar_router = APIRouter()


# This endpoint gives all the data with the labels in the return 
@filterbar_router.get("/allCards")
def allCards():
    connection = get_connection()
    if connection is None:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    with connection.cursor() as local_cur:
        local_cur.execute("""
        SELECT 
            u.Username,
            u.Email,
            c.Title,
            c.CardID,
            cat.CategoryLabel,
            c.DatePosted,
            c.Description,
            c.Organization,
            c.Funding,
            c.Link,
            STRING_AGG(DISTINCT t.TagLabel, ', ') AS TagLabels,
            c.Latitude,
            c.Longitude,
            COALESCE(
                (
                    SELECT ci2.ImageURL
                    FROM CardImages ci2
                    WHERE ci2.CardID = c.CardID
                    ORDER BY ci2.DisplayOrder ASC, ci2.ImageID ASC
                    LIMIT 1
                ),
                c.Thumbnail_Link
            ) AS Thumbnail_Link,
            COALESCE(
                (
                    SELECT json_agg(
                        jsonb_build_object(
                            'imageID', img_sub.ImageID,
                            'url', img_sub.ImageURL,
                            'displayOrder', img_sub.DisplayOrder,
                            'alt', img_sub.AltText
                        )
                        ORDER BY img_sub.DisplayOrder ASC, img_sub.ImageID ASC
                    )
                    FROM (
                        SELECT DISTINCT ci2.ImageID, ci2.ImageURL, ci2.DisplayOrder, ci2.AltText
                        FROM CardImages ci2
                        WHERE ci2.CardID = c.CardID
                    ) img_sub
                ),
                '[]'
            ) AS images,
            COALESCE(
                json_agg(
                    DISTINCT jsonb_build_object(
                        'fileid', f.fileid,
                        'filename', f.filename,
                        'file_link', f.file_link,
                        'fileextension', f.fileextension
                    )
                ) FILTER (WHERE f.fileid IS NOT NULL),
                '[]'
            ) AS files
        FROM Cards c
        INNER JOIN Categories cat ON c.CategoryID = cat.CategoryID
        LEFT JOIN CardImages ci ON c.CardID = ci.CardID
        LEFT JOIN Files f ON c.CardID = f.CardID
        LEFT JOIN CardTags ct ON c.CardID = ct.CardID
        LEFT JOIN Tags t ON ct.TagID = t.TagID
        INNER JOIN Users u ON c.UserID = u.UserID
        GROUP BY c.CardID, cat.CategoryLabel, u.Username, u.Email
        ORDER BY c.CardID DESC;
    """)
        rows = local_cur.fetchall()
    columns = [
        "username", "email", "title", "cardID", "category", "date", "description", "org",
        "funding", "link", "tags", "latitude", "longitude", "thumbnail_link", "images", "files"
    ]
    data = [dict(zip(columns, row)) for row in rows]
    return {"data": data}



# This returns every tag label for the drop down menu.
@filterbar_router.get("/tagList")
def tagList():
    connection = get_connection()
    if connection is None:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    with connection.cursor() as local_cur:
        local_cur.execute('SELECT taglabel FROM tags ORDER BY taglabel')
        rows = local_cur.fetchall()
    return {"tagList": rows}



# This endpoint gives all the data with the labels in the return from the filtered tag that was selected
@filterbar_router.get("/allCardsByTag")
async def allCardsByTag(categoryString: str = None, tagString: str = None, sortString: str = None):

    if categoryString is None and tagString is None and sortString is None:
        return {"Parameter Error": "Need to pass something to this endpoint to return a card"}

    finalQUERY = ("""
        SELECT 
            u.Username,
            u.Email,
            c.Title,
            c.CardID,
            cat.CategoryLabel,
            c.DatePosted,
            c.Description,
            c.Organization,
            c.Funding,
            c.Link,
            STRING_AGG(DISTINCT t.TagLabel, ', ') AS TagLabels,
            c.Latitude,
            c.Longitude,
            COALESCE(
                (
                    SELECT ci2.ImageURL
                    FROM CardImages ci2
                    WHERE ci2.CardID = c.CardID
                    ORDER BY ci2.DisplayOrder ASC, ci2.ImageID ASC
                    LIMIT 1
                ),
                c.Thumbnail_Link
            ) AS Thumbnail_Link,
            COALESCE(
                (
                    SELECT json_agg(
                        jsonb_build_object(
                            'imageID', img_sub.ImageID,
                            'url', img_sub.ImageURL,
                            'displayOrder', img_sub.DisplayOrder,
                            'alt', img_sub.AltText
                        )
                        ORDER BY img_sub.DisplayOrder ASC, img_sub.ImageID ASC
                    )
                    FROM (
                        SELECT DISTINCT ci2.ImageID, ci2.ImageURL, ci2.DisplayOrder, ci2.AltText
                        FROM CardImages ci2
                        WHERE ci2.CardID = c.CardID
                    ) img_sub
                ),
                '[]'
            ) AS images,
            COALESCE(
                json_agg(
                    DISTINCT jsonb_build_object(
                        'fileid', f.fileid,
                        'filename', f.filename,
                        'file_link', f.file_link,
                        'fileextension', f.fileextension
                    )
                ) FILTER (WHERE f.fileid IS NOT NULL),
                '[]'
            ) AS files
    """)

    if sortString:
        sortSplit = sortString.split(',')
        if sortSplit[0] == "ClosestToMe" or sortSplit[0] == "ClosestToPin":
            latitude = sortSplit[1]
            longitude = sortSplit[2]
            finalQUERY += f""", SQRT(POWER(c.Latitude - {latitude}, 2) + POWER(c.Longitude - {longitude}, 2)) AS distance"""

    finalQUERY += """
        FROM Users u
        JOIN Cards c ON u.UserID = c.UserID
        LEFT JOIN CardTags ct ON c.CardID = ct.CardID
        LEFT JOIN Tags t ON ct.TagID = t.TagID
        JOIN Categories cat ON c.CategoryID = cat.CategoryID
        LEFT JOIN CardImages ci ON c.CardID = ci.CardID
        LEFT JOIN Files f ON c.CardID = f.CardID
    """

    botStringQuery = """
        GROUP BY c.CardID, cat.CategoryLabel, u.Username, u.Email
    """

    if categoryString or tagString:
        finalQUERY += " WHERE "
        if categoryString:
            finalQUERY += f"LOWER(cat.CategoryLabel) = LOWER('{categoryString}')"
            if tagString:
                finalQUERY += " AND "
        if tagString:
            tags = tagString.split(',')
            tags = ', '.join(f"LOWER('{tag.strip()}')" for tag in tags)
            tag_count = len(tags.split(','))
            finalQUERY += f"""
                (SELECT COUNT(*) 
                 FROM CardTags
                 JOIN Tags ON CardTags.TagID = Tags.TagID
                 WHERE CardTags.CardID = c.CardID AND LOWER(Tags.TagLabel) IN ({tags})) = {tag_count}
            """

    finalQUERY += botStringQuery

    if sortString:
        sortSplit = sortString.split(',')
        if sortSplit[0] == "ClosestToMe" or sortSplit[0] == "ClosestToPin":
            finalQUERY += " ORDER BY distance ASC"
        elif sortSplit[0] == "RecentlyAdded" or sortSplit[0] == "NewestFirst":
            finalQUERY += " ORDER BY c.DatePosted DESC"
        elif sortSplit[0] == "OldestFirst":
            finalQUERY += " ORDER BY c.DatePosted ASC"

    connection = get_connection()
    if connection is None:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    with connection.cursor() as local_cur:
        local_cur.execute(finalQUERY)
        rows = local_cur.fetchall()
    columns = [
        "username", "email", "title", "cardID", "category", "date", "description", "org",
        "funding", "link", "tags", "latitude", "longitude", "thumbnail_link", "images", "files"
    ]
    data = [dict(zip(columns, row)) for row in rows]
    return {"data": data}



@filterbar_router.get("/searchBar")
def searchBar(titleSearch: str):
    try:
        connection = get_connection()
        if connection is None:
            raise HTTPException(status_code=503, detail="Database connection unavailable")

        with connection.cursor() as local_cur:
            local_cur.execute("""
            SELECT 
                u.Username,
                c.Name,
                u.Email,
                c.Title,
                c.CardID,
                cat.CategoryLabel,
                c.DatePosted,
                c.Description,
                c.Organization,
                c.Funding,
                c.Link,
                STRING_AGG(DISTINCT t.TagLabel, ', ') AS TagLabels,
                c.Latitude,
                c.Longitude,
                COALESCE(
                    (
                        SELECT ci2.ImageURL
                        FROM CardImages ci2
                        WHERE ci2.CardID = c.CardID
                        ORDER BY ci2.DisplayOrder ASC, ci2.ImageID ASC
                        LIMIT 1
                    ),
                    c.Thumbnail_Link
                ) AS Thumbnail_Link,
                COALESCE(
                    (
                        SELECT json_agg(
                            jsonb_build_object(
                                'imageID', img_sub.ImageID,
                                'url', img_sub.ImageURL,
                                'displayOrder', img_sub.DisplayOrder,
                                'alt', img_sub.AltText
                            )
                            ORDER BY img_sub.DisplayOrder ASC, img_sub.ImageID ASC
                        )
                        FROM (
                            SELECT DISTINCT ci2.ImageID, ci2.ImageURL, ci2.DisplayOrder, ci2.AltText
                            FROM CardImages ci2
                            WHERE ci2.CardID = c.CardID
                        ) img_sub
                        rows = local_cur.fetchall()
                ) AS images,
                COALESCE(
                    json_agg(
                except HTTPException:
                    raise
                        DISTINCT jsonb_build_object(
                    connection = get_connection()
                    if connection:
                        connection.rollback()
                            'filename', f.filename,
                            'file_link', f.file_link,
                            'fileextension', f.fileextension
                        )
                    ) FILTER (WHERE f.fileid IS NOT NULL),
                    '[]'
                ) AS files
            FROM Cards c
            INNER JOIN Categories cat ON c.CategoryID = cat.CategoryID
            LEFT JOIN CardImages ci ON c.CardID = ci.CardID
            LEFT JOIN Files f ON c.CardID = f.CardID
            LEFT JOIN CardTags ct ON c.CardID = ct.CardID
            LEFT JOIN Tags t ON ct.TagID = t.TagID
            INNER JOIN Users u ON c.UserID = u.UserID
            WHERE c.Title ILIKE %s
            GROUP BY c.CardID, cat.CategoryLabel, u.Username, u.Email, c.Name
            ORDER BY c.CardID DESC
        """, (f"%{titleSearch}%",))

        rows = cur.fetchall()
        columns = [
            "username", "name", "email", "title", "cardID", "category", "date",
            "description", "org", "funding", "link", "tags",
            "latitude", "longitude", "thumbnail_link", "images", "files"
        ]
        data = [dict(zip(columns, row)) for row in rows]
        return {"data": data}

    except Exception as e:
        conn.rollback()
        print(f"[SEARCHBAR ERROR] {e}")
        raise HTTPException(status_code=500, detail="Error executing search query")