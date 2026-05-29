import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserCircle } from '@fortawesome/free-solid-svg-icons';
import api from './api.js';
import './Navbar.css';

function Navbar({ isLoggedIn, isAdmin, username, email, onLogout }) {
  const location = useLocation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState(() => localStorage.getItem('profileImage') || '');

  useEffect(() => {
    if (!isLoggedIn || !email) {
      setProfileImageUrl('');
      return;
    }

    let isActive = true;
    const loadProfileImage = async () => {
      try {
        const res = await api.get('/getProfileImage', { params: { email } });
        const imageUrl = res?.data?.success ? (res.data.profile_image || '') : '';
        if (!isActive) return;
        setProfileImageUrl(imageUrl);
        if (imageUrl) {
          localStorage.setItem('profileImage', imageUrl);
        } else {
          localStorage.removeItem('profileImage');
        }
      } catch (error) {
        if (!isActive) return;
        const cachedImage = localStorage.getItem('profileImage') || '';
        setProfileImageUrl(cachedImage);
      }
    };

    loadProfileImage();
    return () => {
      isActive = false;
    };
  }, [isLoggedIn, email]);

  useEffect(() => {
    const handleProfileImageUpdated = (event) => {
      const nextImage = event?.detail?.profileImage || '';
      setProfileImageUrl(nextImage);
      if (nextImage) {
        localStorage.setItem('profileImage', nextImage);
      } else {
        localStorage.removeItem('profileImage');
      }
    };

    window.addEventListener('atlas:profile-image-updated', handleProfileImageUpdated);
    return () => window.removeEventListener('atlas:profile-image-updated', handleProfileImageUpdated);
  }, []);

  useEffect(() => {
    console.log('[Navbar][Admin Debug] Render state:', {
      isLoggedIn,
      isAdmin,
      isAdminType: typeof isAdmin,
      shouldShowAdminLink: Boolean(isLoggedIn && isAdmin)
    });
  }, [isLoggedIn, isAdmin]);

  const toggleModal = () => {
    console.log("Toggling modal. Current state:", isModalOpen);
    setIsModalOpen(!isModalOpen);
  };

  const handleLogout = () => {
    onLogout(); // Call the logout function
    setIsModalOpen(false); // Close the modal
  };

  console.log("Username:", username);

  return (
    <nav className="navbar" data-onboarding-target="navbar-root">
      <Link to="/" data-onboarding-target="navbar-brand">
        <h1>RWC Living Atlas</h1>
      </Link>
      <a href="https://cereo.wsu.edu/" data-onboarding-target="navbar-cereo-link">
        <img src="/CEREO-logo.png" alt="CEREO Logo" className="navbar-logo"></img>
      </a>
      <ul>
        <li>
          <Link to="/" data-onboarding-target="navbar-home-link" className={location.pathname === '/' ? 'active' : ''}>Home</Link>
        </li>
        <li>
          <Link to="/about" data-onboarding-target="navbar-about-link" className={location.pathname === '/about' ? 'active' : ''}>About</Link>
        </li>
        <li>
          <Link to="/contact" data-onboarding-target="navbar-contact-link" className={location.pathname === '/contact' ? 'active' : ''}>Contact</Link>
        </li>
        <li>
          <Link to="/update-history" data-onboarding-target="navbar-updates-link" className={location.pathname === '/update-history' ? 'active' : ''}>Updates</Link>
        </li>
        <li>
          <Link to="/user-manual" data-onboarding-target="navbar-manual-link" className={location.pathname === '/user-manual' ? 'active' : ''}>User Manual</Link>
        </li>
        {!isLoggedIn && (
          <li>
            <Link to="/signup" data-onboarding-target="navbar-auth-link" className={location.pathname === '/signup' ? 'active' : ''}>Register</Link>
          </li>
        )}
        {!isLoggedIn && (
          <li>
            <Link to="/login" data-onboarding-target="navbar-auth-link" className={location.pathname === '/login' ? 'active' : ''}>Login</Link>
          </li>
        )}
        {isLoggedIn && (
          <li
              className={`profile-button ${isModalOpen ? 'active' : ''}`}
              data-onboarding-target="navbar-auth-link"
              onClick={toggleModal}
          >
            {profileImageUrl ? (
              <img src={profileImageUrl} alt="Profile" className="profile-avatar-image" />
            ) : (
              <FontAwesomeIcon icon={faUserCircle} className="profile-icon" />
            )}
            <span className="username">{username}</span>
            {isModalOpen && (
              <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
                <div className="profile-modal-header">
                  <div className="profile-modal-avatar-wrap">
                    {profileImageUrl ? (
                      <img src={profileImageUrl} alt="Profile" className="profile-modal-avatar-image" />
                    ) : (
                      <FontAwesomeIcon icon={faUserCircle} className="profile-modal-avatar-icon" />
                    )}
                  </div>
                  <div className="profile-modal-user-meta">
                    <div className="profile-modal-username">{username || 'User'}</div>
                    <div className="profile-modal-email">{email || 'No email available'}</div>
                  </div>
                </div>
                <ul>
                  <li>
                    <Link to="/profile" onClick={() => setIsModalOpen(false)}>Profile</Link>
                  </li>
                  {isAdmin && (
                    <li>
                      <Link to="/administration" onClick={() => setIsModalOpen(false)}>Administration</Link>
                    </li>
                  )}
                  <li>
                    <Link to="/switch-account" onClick={() => setIsModalOpen(false)}>Switch Account</Link>
                  </li>
                  <li>
                    <Link to="/login" onClick={handleLogout} className="logout-button">
                      Logout
                    </Link>
                  </li>
                </ul>
              </div>
            )}
          </li>
        )}
      </ul>
    </nav>
  );
}

export default Navbar;
