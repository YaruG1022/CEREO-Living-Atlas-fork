import React, { useState } from 'react';
import './Contact.css';
import { BrowserRouter as Router, Route, Switch, Link } from 'react-router-dom';
import api from './api.js';

function Contact(props) {
    const [form, setForm] = useState({ name: '', email: '', message: '' });
    const [status, setStatus] = useState(null); // 'success' | 'error' | null
    const [loading, setLoading] = useState(false);

    function handleChange(e) {
        setForm({ ...form, [e.target.name]: e.target.value });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        setStatus(null);
        try {
            await api.post('/submit-feedback', form);
            setStatus('success');
            setForm({ name: '', email: '', message: '' });
        } catch (err) {
            setStatus('error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="profile">

            <div className="contact">
                <h1>Contact Us</h1>
                <h2>Address</h2>
                <p>CEREO</p>
                <p>PACCAR Room 242</p>
                <p>Washington State</p>
                <p>University</p>
                <p>Pullman, WA 99164-5825</p>
                <h2>Phone and email</h2>
                <p>Phone:  509-335-5531</p>
                <p>Email:  <li><a href="mailto:cereo@wsu.edu">cereo@wsu.edu</a></li> <li><a href="mailto:wsu.cereoatlas25@gmail.com">wsu.cereoatlas25@gmail.com</a></li></p>

                <h2>Send Us Feedback</h2>
                <form className="feedback-form" onSubmit={handleSubmit}>
                    <div className="feedback-field">
                        <label htmlFor="feedback-name">Name</label>
                        <input
                            id="feedback-name"
                            type="text"
                            name="name"
                            value={form.name}
                            onChange={handleChange}
                            placeholder="Your name"
                            required
                        />
                    </div>
                    <div className="feedback-field">
                        <label htmlFor="feedback-email">Email</label>
                        <input
                            id="feedback-email"
                            type="email"
                            name="email"
                            value={form.email}
                            onChange={handleChange}
                            placeholder="Your email"
                            required
                        />
                    </div>
                    <div className="feedback-field">
                        <label htmlFor="feedback-message">Message</label>
                        <textarea
                            id="feedback-message"
                            name="message"
                            value={form.message}
                            onChange={handleChange}
                            placeholder="Your feedback..."
                            rows={5}
                            required
                        />
                    </div>
                    <button type="submit" className="feedback-submit" disabled={loading}>
                        {loading ? 'Sending...' : 'Submit Feedback'}
                    </button>
                    {status === 'success' && (
                        <p className="feedback-msg feedback-success">Feedback sent successfully!</p>
                    )}
                    {status === 'error' && (
                        <p className="feedback-msg feedback-error">Failed to send feedback. Please try again.</p>
                    )}
                </form>
            </div>
        </div>
    );
}

export default Contact;