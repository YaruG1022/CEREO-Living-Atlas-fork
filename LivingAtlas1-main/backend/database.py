import os
import psycopg2
from psycopg2 import OperationalError, errorcodes, errors

conn = None  # Ensure conn is always defined
cur = None


def _connect_from_env():
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        return psycopg2.connect(database_url, connect_timeout=10)

    db_name = os.environ.get("DB_NAME")
    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD")
    db_host = os.environ.get("DB_HOST")

    if not all([db_name, db_user, db_password, db_host]):
        raise RuntimeError(
            "Missing database configuration. Set DATABASE_URL or DB_NAME, DB_USER, DB_PASSWORD, and DB_HOST."
        )

    return psycopg2.connect(
        dbname=db_name,
        user=db_user,
        password=db_password,
        host=db_host,
        port=os.environ.get("DB_PORT", "5432"),
        sslmode=os.environ.get("DB_SSLMODE", "require"),
        connect_timeout=10
    )


def get_connection():
    """Return a live DB connection, reconnecting once if startup initialization failed."""
    global conn, cur

    if conn:
        return conn

    try:
        conn = _connect_from_env()
        cur = conn.cursor()
        print("Database Connection Success!")
        return conn
    except Exception as e:
        print("Unable to connect to the database")
        print(f"Error: {e}")
        conn = None
        cur = None
        return None

try:
    conn = _connect_from_env()
    cur = conn.cursor()
    print("Database Connection Success!")
    connectionsucceeded = True

except Exception as e:
    print("Unable to connect to the database")
    print(f"Error: {e}")
    if conn:
        conn.rollback()  # Force rollback if stuck in error state
    connectionsucceeded = False


# -----------------------------------------------------------
# Auto-apply pending schema migrations (idempotent)
# -----------------------------------------------------------
def _ensure_schema():
    """Run on every startup to guarantee the schema is up-to-date."""
    if not conn or not cur:
        return
    try:
        # Migration 003 — LocationType column + CardPolygonVertices table
        cur.execute("""
            ALTER TABLE Cards ADD COLUMN IF NOT EXISTS LocationType VARCHAR(10) DEFAULT 'point';
        """)
        # Make Latitude / Longitude nullable (safe even if already nullable)
        cur.execute("""
            ALTER TABLE Cards ALTER COLUMN Latitude DROP NOT NULL;
        """)
        cur.execute("""
            ALTER TABLE Cards ALTER COLUMN Longitude DROP NOT NULL;
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS CardPolygonVertices (
                VertexID SERIAL PRIMARY KEY,
                CardID INT NOT NULL,
                VertexOrder INT NOT NULL,
                Latitude DECIMAL(10,8) NOT NULL,
                Longitude DECIMAL(11,8) NOT NULL,
                FOREIGN KEY (CardID) REFERENCES Cards(CardID) ON DELETE CASCADE
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_card_polygon_cardid
            ON CardPolygonVertices(CardID, VertexOrder);
        """)

        # Migration 004 — None / Other categories + CategoryID nullable
        cur.execute("""
            INSERT INTO Categories (CategoryID, CategoryLabel)
            VALUES (4, 'None'), (5, 'Other')
            ON CONFLICT (CategoryID) DO NOTHING;
        """)
        cur.execute("""
            ALTER TABLE Cards ALTER COLUMN CategoryID DROP NOT NULL;
        """)

        # Migration 005 — Polygon style columns (fill color + line style)
        cur.execute("""
            ALTER TABLE Cards ADD COLUMN IF NOT EXISTS PolygonFillColor VARCHAR(20) DEFAULT '#0077c0';
        """)
        cur.execute("""
            ALTER TABLE Cards ADD COLUMN IF NOT EXISTS PolygonLineStyle VARCHAR(20) DEFAULT 'solid';
        """)

        # Migration 006 — is_public flag for cards (public vs uploader-only visibility)
        cur.execute("""
            ALTER TABLE Cards ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
        """)

        # Migration 006b — user-specific UI preferences (extensible JSONB payload)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_email VARCHAR(255) PRIMARY KEY,
                preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_user_preferences_email
                    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
            ON user_preferences(updated_at DESC);
        """)

        # Migration 007 — user profile: bio and profile_image columns
        cur.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
        """)
        cur.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT DEFAULT '';
        """)

        # Migration 008 — LinkText column for custom link display labels
        cur.execute("""
            ALTER TABLE Cards ADD COLUMN IF NOT EXISTS LinkText VARCHAR(255);
        """)

        # Migration 009 — user account creation timestamp for admin Date Joined column
        cur.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        """)

        # Migration 010 — user last online timestamp for admin User Management table
        cur.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMP WITH TIME ZONE;
        """)

        # Migration 011 — RingIndex column for multi-ring polygon support
        cur.execute("""
            ALTER TABLE CardPolygonVertices ADD COLUMN IF NOT EXISTS RingIndex INT DEFAULT 0;
        """)

        conn.commit()
        print("[MIGRATIONS] Schema is up-to-date.")
    except Exception as e:
        conn.rollback()
        print(f"[MIGRATIONS] Error applying migrations: {e}")

_ensure_schema()