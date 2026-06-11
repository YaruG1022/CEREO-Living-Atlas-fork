"""
account
    profile account
    upload account
    profile cards           --Adjust query to be post referenced

"""

from fastapi import APIRouter, Form, HTTPException, UploadFile, File
from database import conn, cur
from pydantic import BaseModel
from typing import Dict, Any
import json

import urllib.parse
import requests
# import smtplib
# from email.mime.multipart import MIMEMultipart
# from email.mime.text import MIMEText

import os
import hashlib

# Email configuration - Use SendGrid for cloud deployment
import os


# SendGrid Email: wsu.cereoatlas26@gmail.com
# SendGrid Password: LivingAtlas25$
# SendGrid Recovery Code: 8W6JXAUWQZWSNVJXA4VH2CXV
# SendGrid API Key: 

# SendGrid configuration
SENDGRID_API_KEY = os.environ.get("CEREO_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "wsu.cereoatlas26@gmail.com")

# Resend configuration
RESEND_API_KEY = (os.environ.get("RESEND_API_KEY") or os.environ.get("CEREO_API_KEY") or "").strip()
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "noreply@cereo-livingatlas.com")

# SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
# SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
# SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "wsu.cereoatlas26@gmail.com")
# SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")

# SMTP_SERVER = "smtp.gmail.com"
# SMTP_PORT = 465
# SENDER_EMAIL = "wsu.cereoatlas26@gmail.com"
# SENDER_PASSWORD = "vuzc jnhd uxmg nniu"

# SMTP_EMAIL: wsu.cereoatlas26@gmail.com

# GMAIL ACCOUNT BACKUP_CODE for wsu.cereoatlas26@gmail.com: 
# 1575 4464
# 6862 8813
# 4897 2931
# 4080 8589
# 1988 2224
# 4569 6993
# 2572 6247
# 0363 5759
# 3330 7800
# 9848 9106

account_router = APIRouter()

# Model for password reset
class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str

# Model for forgot password request
class ForgotPasswordRequest(BaseModel):
    email: str

# Model for signup notification request
class SignupNotificationRequest(BaseModel):
    username: str
    email: str
    desired_access_level: str

# Model for user feedback submission
class FeedbackRequest(BaseModel):
    name: str
    email: str
    message: str


class UserPreferencesUpsertRequest(BaseModel):
    email: str
    preferences: Dict[str, Any] = {}

class UpdateUsernameRequest(BaseModel):
    email: str
    new_username: str

class UpdateBioRequest(BaseModel):
    email: str
    bio: str

BIO_MAX_LENGTH = 300

#Retrieve names and emails of all users for the administration page
class User(BaseModel):
    name: str
    email: str

# Function to get short URL using Bitly
def get_short_url(long_url):
    try:
        # Using Bitly's API with timeout
        BITLY_API_URL = "https://api-ssl.bitly.com/v4/shorten"
        headers = {"Authorization": "Bearer 9b023a4be0d1aa1f667eae09b3b7e959af52acf2", "Content-Type": "application/json"}
        data = {"long_url": long_url}
        response = requests.post(BITLY_API_URL, json=data, headers=headers, timeout=10)
        if response.status_code == 200 or response.status_code == 201:
            return response.json()["link"]
        else:
            print("Error shortening URL:", response.text)
            return long_url  # Fallback to long URL
    except requests.Timeout:
        print("Bitly API timeout - using long URL")
        return long_url
    except Exception as e:
        print(f"Bitly API error: {e} - using long URL")
        return long_url

# Helper function to send the recovery email using SendGrid
def send_recovery_email(recipient_email):
    try:
        print(f"DEBUG: Preparing to send email to {recipient_email}...")

        # Construct the long URL with the recipient's email
        encoded_email = urllib.parse.quote(recipient_email)
        long_url = f"https://willowy-twilight-157839.netlify.app/reset-password?email={encoded_email}"
        
        print(f"DEBUG: Getting short URL for {long_url}")
        # Get a short URL from the dynamic URL shortener (e.g., Bitly)
        short_reset_url = get_short_url(long_url)
        print(f"DEBUG: Short URL obtained: {short_reset_url}")

        # Email content
        subject = "Password Reset Request"
        body = f"""
        <html>
            <body>
                <p>Hi,<br><br>
                You requested a password reset. Click the link below to reset your password:<br><br>
                <a href="{short_reset_url}">Reset Password</a><br><br>
                If you did not request this, please ignore this email.
                </p>
            </body>
        </html>
        """

        # Send via Resend
        print(f"DEBUG: Attempting to send via Resend...")
        send_via_resend(recipient_email, subject, body)
        # send_via_gmail_smtp(recipient_email, subject, body)
        print(f"DEBUG: Resend email sent successfully to {recipient_email}!")

    except Exception as e:
        print(f"DEBUG: Failed to send email: {e}")
        raise Exception(f"Email sending failed: {e}")

def send_via_sendgrid(recipient_email, subject, body):
    """Send email using SendGrid API"""
    print("DEBUG: Sending via SendGrid API...")
    
    payload = {
        "personalizations": [
            {
                "to": [{"email": recipient_email}],
                "subject": subject
            }
        ],
        "from": {"email": SENDER_EMAIL, "name": "Living Atlas"},
        "content": [
            {
                "type": "text/html",
                "value": body
            }
        ]
    }
    
    headers = {
        "Authorization": f"Bearer {SENDGRID_API_KEY}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        "https://api.sendgrid.com/v3/mail/send",
        json=payload,
        headers=headers,
        timeout=30
    )
    
    if response.status_code == 202:
        print(f"DEBUG: SendGrid email sent successfully!")
        return True
    else:
        error_detail = response.text
        print(f"DEBUG: SendGrid failed with status {response.status_code}: {error_detail}")
        raise Exception(f"SendGrid returned {response.status_code}: {error_detail}")


def send_via_gmail_smtp(recipient_email, subject, body):
    """Gmail SMTP is temporarily disabled."""
    raise Exception("Gmail SMTP is disabled. Resend is active.")


def send_via_resend(recipient_email, subject, body):
    """Send email using Resend API over HTTPS."""
    resend_api_key = (os.environ.get("RESEND_API_KEY") or os.environ.get("CEREO_API_KEY") or "").strip()
    resend_from_email = os.environ.get("RESEND_FROM_EMAIL", "noreply@cereo-livingatlas.com").strip()

    if not resend_api_key:
        raise Exception("Missing RESEND_API_KEY environment variable")

    if not resend_from_email:
        raise Exception("Missing RESEND_FROM_EMAIL environment variable")

    payload = {
        "from": f"Living Atlas <{resend_from_email}>" if "<" not in resend_from_email else resend_from_email,
        "to": [recipient_email],
        "subject": subject,
        "html": body,
    }

    headers = {
        "Authorization": f"Bearer {resend_api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post("https://api.resend.com/emails", json=payload, headers=headers, timeout=30)
    if response.status_code not in (200, 201):
        raise Exception(f"Resend returned {response.status_code}: {response.text}")

    return True


def send_signup_notification(username, email, desired_access_level):
        """Send signup notification email to admin via active email provider."""
        admin_email = os.environ.get("ADMIN_NOTIFICATION_EMAIL", "wsu.cereoatlas26@gmail.com").strip()
        if not admin_email:
                return

        subject = "New User Signup Request"
        body = f"""
        <html>
            <body>
                <p>A new user has requested access:</p>
                <ul>
                    <li><strong>Username:</strong> {username}</li>
                    <li><strong>Email:</strong> {email}</li>
                    <li><strong>Desired Access Level:</strong> {desired_access_level}</li>
                </ul>
            </body>
        </html>
        """
        send_via_resend(admin_email, subject, body)


@account_router.post("/submit-feedback")
async def submit_feedback(request: FeedbackRequest):
    try:
        feedback_recipient = "wsu.cereoatlas25@gmail.com"
        subject = f"User Feedback from {request.name}"
        body = f"""
        <html>
            <body>
                <p><strong>Name:</strong> {request.name}</p>
                <p><strong>Email:</strong> {request.email}</p>
                <p><strong>Message:</strong></p>
                <p>{request.message}</p>
            </body>
        </html>
        """
        send_via_resend(feedback_recipient, subject, body)
        return {"success": True, "message": "Feedback submitted successfully."}
    except Exception as e:
        print(f"DEBUG: Exception in submit_feedback: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to submit feedback: {str(e)}")


@account_router.post("/sendSignupNotification")
async def send_signup_notification_endpoint(request: SignupNotificationRequest):
        if not request.username or not request.email or not request.desired_access_level:
                raise HTTPException(status_code=400, detail="Missing required fields")

        try:
                send_signup_notification(request.username, request.email, request.desired_access_level)
                return {"success": True, "message": "Signup notification sent to admin."}
        except Exception as e:
                # Preserve signup flow even when notification email fails.
                return {"success": False, "message": f"Signup saved but email notification failed: {str(e)}"}


@account_router.get("/user_preferences")
def get_user_preferences(email: str):
    try:
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")

        cur.execute("SELECT preferences FROM user_preferences WHERE user_email = %s", (email,))
        row = cur.fetchone()

        if not row or row[0] is None:
            conn.commit()
            return {"email": email, "preferences": {}}

        preferences = row[0]
        if isinstance(preferences, str):
            preferences = json.loads(preferences)

        if not isinstance(preferences, dict):
            preferences = {}

        conn.commit()
        return {"email": email, "preferences": preferences}
    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return {"error": str(e)}


@account_router.post("/user_preferences")
async def upsert_user_preferences(payload: UserPreferencesUpsertRequest):
    try:
        email = (payload.email or '').strip()
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")

        preferences = payload.preferences or {}
        if not isinstance(preferences, dict):
            raise HTTPException(status_code=400, detail="preferences must be an object")

        # Validate user exists
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="User not found")

        cur.execute(
            """
            INSERT INTO user_preferences (user_email, preferences, created_at, updated_at)
            VALUES (%s, %s::jsonb, NOW(), NOW())
            ON CONFLICT (user_email) DO UPDATE
            SET preferences = COALESCE(user_preferences.preferences, '{}'::jsonb) || EXCLUDED.preferences,
                updated_at = NOW()
            RETURNING preferences
            """,
            (email, json.dumps(preferences))
        )
        row = cur.fetchone()
        conn.commit()

        merged_preferences = row[0] if row else {}
        if isinstance(merged_preferences, str):
            merged_preferences = json.loads(merged_preferences)

        return {"success": True, "email": email, "preferences": merged_preferences}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        return {"success": False, "error": str(e)}


# Helper function to hash the password (same as current setup)
def hash_password(password: str, salt: bytes) -> str:
    pepper = bytes("xe5Dx93xefx16x9ax12wy", 'utf-8')
    return hashlib.sha256(bytes(password, 'utf-8') + salt + pepper).hexdigest()

@account_router.post("/list_database")
async def list_database():
    try:
        # Query user basics plus account timestamps for admin table display
        cur.execute("SELECT username, email, COALESCE(is_admin, false), created_at, last_online_at FROM users")
        rows = cur.fetchall()

        # Convert the query result into a list of dictionaries
        users = [{"name": row[0], "email": row[1], "is_admin": row[2], "created_at": row[3], "last_online_at": row[4]} for row in rows]
        

        return {"users": users}
    except Exception as e:
        return {"error": str(e)}


@account_router.post("/fetch_signup_requests")
async def fetch_signup_requests():
    try:
        cur.execute("SELECT username, email, pass, sponsormessage, desiresadmin FROM signupdata")
        rows = cur.fetchall()

        sign_up_requests = [
            {
                "name": row[0],
                "email": row[1],
                "password": row[2],
                "sponsor_message": row[3],
                "desired_access_level": row[4],
            }
            for row in rows
        ]

        return {"signUpRequests": sign_up_requests}
    except Exception as e:
        return {"error": str(e)}



# Define a dependency to get the current user's role
@account_router.get("/userRole")
def get_user_role(email: str):
    try:
        # Query the database to retrieve the is_admin status of the user with the given email
        cur.execute(f"SELECT is_admin FROM users WHERE email = '{email}'")
        row = cur.fetchone()  # Assuming only one row per user
    
        if row:
            is_admin = row[0]
            return {"is_admin": is_admin}
        else:
            return {"error": "User not found"}
    except Exception as e:
        return {"error": str(e)}



# Define the edit_user_role endpoint
@account_router.post("/edit_user_role")
async def edit_user_role(user_info: dict):
    try:
        email = user_info.get('email')
        is_admin = user_info.get('is_admin')

        # Update the is_admin status of the user with the provided email
        cur.execute("UPDATE Users SET is_admin = %s WHERE email = %s", (is_admin, email))
        conn.commit()  # Commit the transaction
        
        return {"message": f"User role updated successfully."}
    except Exception as e:
        return {"error": str(e)}



# Define the delete_user endpoint
@account_router.post("/delete_user/{email}")
async def delete_user(email: str):
    try:
        # Query the database to get the role of the user with the provided email
        cur.execute("SELECT is_admin FROM Users WHERE email = %s", (email,))
        row = cur.fetchone()
        
        if row is None:
            return {"error": "User not found"}
        
        is_admin = row[0]
        
        if is_admin:
            return {"error": "Admin users cannot be deleted"}
        
        # Execute SQL query to delete the user with the provided email
        cur.execute("DELETE FROM Users WHERE email = %s", (email,))
        conn.commit()  # Commit the transaction
        
        return {"message": f"User with email '{email}' has been deleted successfully."}
    except Exception as e:
        return {"error": str(e)}


@account_router.post("/deny_request/{email}")
async def deny_request(email: str):
    try:
        cur.execute("DELETE FROM signupdata WHERE email = %s", (email,))
        conn.commit()
        return {"success": True, "message": f"Request with email '{email}' has been denied and deleted successfully."}
    except Exception as e:
        return {"success": False, "message": str(e)}

# Forgot password endpoint
@account_router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    try:
        print(f"DEBUG: Processing forgot password request for {request.email}")
        
        # Check if the email exists in the database
        cur.execute("SELECT userid FROM users WHERE email = %s", (request.email,))
        user = cur.fetchone()

        if not user:
            print(f"DEBUG: Email not found: {request.email}")
            raise HTTPException(status_code=400, detail="Email not found")

        print(f"DEBUG: Email found, sending recovery email to {request.email}")
        
        # Send the recovery email
        send_recovery_email(request.email)

        print(f"DEBUG: Recovery email process completed for {request.email}")
        return {"success": True, "message": "Password recovery email sent."}

    except HTTPException:
        raise
    except Exception as e:
        print(f"DEBUG: Exception in forgot_password: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send recovery email: {str(e)}")

# Reset password endpoint
@account_router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    try:
        print(f"DEBUG: Processing reset password request")
        
        # Extract email and new_password from the request
        email = request.email
        new_password = request.new_password
        
        print(f"DEBUG: Email: {email}")
        print(f"DEBUG: New password length: {len(new_password) if new_password else 0}")

        if not email or not new_password:
            print(f"DEBUG: Missing email or password")
            raise HTTPException(status_code=400, detail="Email and password are required")

        # Check if the email exists in the database
        print(f"DEBUG: Checking if email exists in database...")
        cur.execute("SELECT userid FROM users WHERE email = %s", (email,))
        user = cur.fetchone()
        print(f"DEBUG: User found: {user is not None}")

        if not user:
            print(f"DEBUG: Email not found in database: {email}")
            raise HTTPException(status_code=400, detail="Invalid email")

        # Generate a new salt for the new password
        print(f"DEBUG: Generating new salt and hashing password...")
        new_salt = os.urandom(32)

        # Hash the new password with the new salt
        hashed_password = hash_password(new_password, new_salt)
        print(f"DEBUG: Password hashed successfully")

        # Update the password and salt in the database
        print(f"DEBUG: Updating password in database...")
        cur.execute(
            "UPDATE users SET hashedpassword = %s, salt = %s WHERE email = %s",
            (hashed_password, new_salt, email)
        )
        conn.commit()
        print(f"DEBUG: Password updated successfully for {email}")

        return {"success": True, "message": "Password has been reset successfully"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"DEBUG: Exception in reset_password: {str(e)}")
        import traceback
        print(f"DEBUG: Full traceback: {traceback.format_exc()}")
        return {"success": False, "message": str(e)}

#This takes the users email and password and then returns the account information to show for the profile page
@account_router.get("/profileAccount")
def profileAccount(email: str, password: str):
    #Get the salt from the db
    cur.execute(f"SELECT salt FROM users WHERE email = '{email}'")
    rows = cur.fetchall()
    if rows != []:
        #Convert the given password and the pepper (which is hardcoded) into bytes, concatenate the password, salt, and pepper together
        #Hash all of that so that it matches the password stored in the db
        password = hashlib.sha256(bytes(password, 'utf-8') + rows[0][0] + bytes("xe5Dx93xefx16x9ax12wy", 'utf-8')).hexdigest()
        #Retrieve the information after the user has been authenticated
        cur.execute(f"SELECT username, email, COALESCE(is_admin, false) FROM users WHERE email = '{email}' AND hashedpassword = '{password}'")
        rows = cur.fetchall()
        if rows:
            try:
                cur.execute("UPDATE users SET last_online_at = NOW() WHERE email = %s", (email,))
                conn.commit()
            except Exception:
                conn.rollback()
        return {"Account Information": rows}




@account_router.post("/uploadAccount")
async def make_account(
    name: str = Form(None),
    email: str = Form(None),
    password: str = Form(None)
):
    try:
        if name and email and password:
            # Check if email already exists
            cur.execute(f"SELECT userid FROM users WHERE email = '{email}'")
            if cur.fetchone():
                return {"success": False, "message": "Email must be unique"}
            
            # Get the maximum existing user ID and increment it
            cur.execute("SELECT MAX(userid) FROM users")
            max_userid = cur.fetchone()[0] or 0
            userid = max_userid + 1
            
            salt = os.urandom(32)
            hashpass = hashlib.sha256(bytes(password, 'utf-8') + salt + bytes("xe5Dx93xefx16x9ax12wy", 'utf-8')).hexdigest()
            cur.execute("INSERT INTO users (userid, username, hashedpassword, email, salt) VALUES (%s, %s, %s, %s, %s)", (userid, name, hashpass, email, salt))
            conn.commit()
            return {"success": True, "message": "New account added successfully"}
        else:
            return {"success": False, "message": "All fields must be filled in"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@account_router.post("/uploadSignup")
async def signup_data(
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    sponsor_message: str = Form(None),
    desired_access_level: str = Form("regular")
):
    try:
        if username and email and password:
            cur.execute("SELECT MAX(SignupID) FROM SignupData")
            max_signup_id = cur.fetchone()[0] or 0
            signup_id = max_signup_id + 1

            cur.execute("SELECT COUNT(*) FROM SignupData WHERE Email = %s", (email,))
            if cur.fetchone()[0] > 0:
                return {"success": False, "message": "Email must be unique"}

            desires_admin = str(desired_access_level).lower() == "admin"
            cur.execute(
                "INSERT INTO SignupData (SignupID, Username, Email, Pass, SponsorMessage, DesiresAdmin) VALUES (%s, %s, %s, %s, %s, %s)",
                (signup_id, username, email, password, sponsor_message, desires_admin),
            )
            conn.commit()

            return {"success": True, "message": "New signup data added successfully"}

        return {"success": False, "message": "All fields must be filled in"}
    except Exception as e:
        return {"success": False, "message": str(e)}




@account_router.get("/getProfileImage")
async def get_profile_image(email: str):
    try:
        cur.execute("SELECT profile_image FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {"success": True, "profile_image": row[0] or ""}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@account_router.post("/uploadProfileImage")
async def upload_profile_image(email: str = Form(...), image: UploadFile = File(...)):
    try:
        cur.execute("SELECT username FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        from endpoint_files.images import save_uploaded_file
        image_url = save_uploaded_file(image, require_gcs=False)

        cur.execute("UPDATE users SET profile_image = %s WHERE email = %s", (image_url, email))
        conn.commit()
        return {"success": True, "message": "Profile image updated.", "profile_image": image_url}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@account_router.get("/getBio")
async def get_bio(email: str):
    try:
        cur.execute("SELECT bio FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {"success": True, "bio": row[0] or ""}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@account_router.post("/updateBio")
async def update_bio(request: UpdateBioRequest):
    try:
        if len(request.bio) > BIO_MAX_LENGTH:
            raise HTTPException(status_code=400, detail=f"Bio must be {BIO_MAX_LENGTH} characters or less.")
        cur.execute("SELECT username FROM users WHERE email = %s", (request.email,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        cur.execute("UPDATE users SET bio = %s WHERE email = %s", (request.bio, request.email))
        conn.commit()
        return {"success": True, "message": "Bio updated successfully.", "bio": request.bio}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@account_router.post("/updateUsername")
async def update_username(request: UpdateUsernameRequest):
    try:
        cur.execute("SELECT username FROM users WHERE email = %s", (request.email,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        cur.execute("UPDATE users SET username = %s WHERE email = %s", (request.new_username, request.email))
        conn.commit()
        return {"success": True, "message": "Username updated successfully.", "username": request.new_username}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@account_router.get("/profileCards")
def profileCards(username: str):
    cur.execute("""
        SELECT 
            u.Username,
            u.Email,
            c.Title,
            cat.CategoryLabel,
            c.DatePosted,
            c.Description,
            c.Organization,
            c.Funding,
            c.Link,
            STRING_AGG(DISTINCT t.TagLabel, ', ') AS TagLabels,
            c.Latitude,
            c.Longitude,
            c.Thumbnail_Link,
            -- Multi-image support: aggregate images from CardImages table
            COALESCE(
                json_agg(
                    DISTINCT jsonb_build_object(
                        'url', ci.ImageURL,
                        'alt', ci.AltText,
                        'order', ci.DisplayOrder
                    )
                    ORDER BY ci.DisplayOrder ASC
                ) FILTER (WHERE ci.ImageID IS NOT NULL),
                '[]'
            ) AS images,
            COALESCE(
                json_agg(
                    DISTINCT jsonb_build_object(
                        'fileID', f.FileID,
                        'filename', f.FileName,
                        'fileLink', f.FileLink,
                        'fileEXT', f.FileExtension
                    )
                ) FILTER (WHERE f.FileID IS NOT NULL),
                '[]'
            ) AS files
        FROM Cards c
        INNER JOIN Categories cat ON c.CategoryID = cat.CategoryID
        LEFT JOIN CardImages ci ON c.CardID = ci.CardID
        LEFT JOIN Files f ON c.CardID = f.CardID
        LEFT JOIN CardTags ct ON c.CardID = ct.CardID
        LEFT JOIN Tags t ON ct.TagID = t.TagID
        INNER JOIN Users u ON c.UserID = u.UserID
        WHERE u.Username = %s
        GROUP BY c.CardID, cat.CategoryLabel, u.Username, u.Email, c.Thumbnail_Link
        ORDER BY c.CardID DESC;
    """, (username,))

    rows = cur.fetchall()
    columns = [
        "username", "email", "title", "category", "date", "description", "org",
        "funding", "link", "tags", "latitude", "longitude", "thumbnail_link", "images", "files"
    ]
    data = [dict(zip(columns, row)) for row in rows]
    return {"data": data}


