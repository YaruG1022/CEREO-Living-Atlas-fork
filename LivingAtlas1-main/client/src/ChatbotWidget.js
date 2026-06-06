import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEarthAmericas } from '@fortawesome/free-solid-svg-icons';
import api from './api';
import './ChatbotWidget.css';

export default function ChatbotWidget({
  displayMode = 'floating',
  isOpen: controlledIsOpen,
  onOpenChange,
  onDisplayModeChange,
  splitBottom = false,
}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = typeof controlledIsOpen === 'boolean' ? controlledIsOpen : internalIsOpen;
  const [messages, setMessages] = useState([{
    role: 'assistant',
    text: 'Hi! I\'m the RWC Living Atlas Helper. Ask me anything about using the app.',
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const widgetRef = useRef(null);
  const dragRef = useRef({ dragging: false, startMouseX: 0, startMouseY: 0, startWidgetX: 0, startWidgetY: 0 });
  const [snap, setSnap] = useState('right');
  const [pos, setPos] = useState(() => ({
    x: 0,
    y: Math.max(40, window.innerHeight - 170),
  }));

  const formatAssistantText = (rawText) => {
    if (typeof rawText !== 'string') return '';

    return rawText
      .replace(/\r\n/g, '\n')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/([^\n])\s(\d+\.\s)/g, '$1\n$2')
      .replace(/([^\n])\s([\-*]\s)/g, '$1\n$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const renderInlineFormattedText = (text, keyPrefix) => {
    const boldParts = String(text).split(/(\*\*[^*]+\*\*)/g);
    const nodes = [];

    boldParts.forEach((boldPart, boldIndex) => {
      const boldMatch = boldPart.match(/^\*\*([^*]+)\*\*$/);
      if (boldMatch) {
        nodes.push(
          <strong key={`${keyPrefix}-b-${boldIndex}`}>{boldMatch[1]}</strong>
        );
        return;
      }

      const italicParts = boldPart.split(/(\*[^*]+\*)/g);
      italicParts.forEach((italicPart, italicIndex) => {
        const italicMatch = italicPart.match(/^\*([^*]+)\*$/);
        if (italicMatch) {
          nodes.push(
            <em key={`${keyPrefix}-i-${boldIndex}-${italicIndex}`}>{italicMatch[1]}</em>
          );
        } else if (italicPart) {
          nodes.push(
            <React.Fragment key={`${keyPrefix}-t-${boldIndex}-${italicIndex}`}>
              {italicPart}
            </React.Fragment>
          );
        }
      });
    });

    return nodes;
  };

  const renderMessageText = (msg, index) => {
    if (msg.role !== 'assistant') {
      return msg.text;
    }

    const lines = String(msg.text).split('\n');
    return lines.map((line, lineIndex) => (
      <React.Fragment key={`msg-${index}-line-${lineIndex}`}>
        {renderInlineFormattedText(line, `msg-${index}-line-${lineIndex}`)}
        {lineIndex < lines.length - 1 && <br />}
      </React.Fragment>
    ));
  };

  const setIsOpen = (next) => {
    const resolved = typeof next === 'function' ? next(isOpen) : next;
    if (typeof controlledIsOpen !== 'boolean') {
      setInternalIsOpen(resolved);
    }
    if (onOpenChange) {
      onOpenChange(resolved);
    }
  };

  const handleDisplayModeToggle = () => {
    const nextMode = displayMode === 'floating' ? 'sidebar' : 'floating';
    if (onDisplayModeChange) {
      onDisplayModeChange(nextMode);
    }
    setIsOpen(true);
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/chat/ask', {
        question: text,
        history: messages.slice(-6),
      });
      const answer = res.data?.answer ?? 'Sorry, I couldn\'t get a response.';
      setMessages(prev => [...prev, { role: 'assistant', text: formatAssistantText(answer) }]);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      let errorText = 'Sorry, something went wrong. Please try again later.';
      if (status === 402) {
        errorText = detail ?? 'The chatbot is temporarily unavailable due to insufficient API credits. Please contact the administrator.';
      } else if (status === 503) {
        errorText = detail ?? 'The chatbot is temporarily unavailable. Please contact the administrator.';
      } else if (detail) {
        errorText = detail;
      }
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: formatAssistantText(errorText) },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = widgetRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dr = dragRef.current;
    dr.dragging = false;
    dr.startMouseX = e.clientX;
    dr.startMouseY = e.clientY;
    dr.startWidgetX = rect.left;
    dr.startWidgetY = rect.top;

    const onMove = (mv) => {
      const dx = mv.clientX - dr.startMouseX;
      const dy = mv.clientY - dr.startMouseY;
      if (!dr.dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        dr.dragging = true;
      }
      if (dr.dragging) {
        const newX = dr.startWidgetX + dx;
        const newY = Math.max(0, Math.min(window.innerHeight - 50, dr.startWidgetY + dy));
        setSnap('free');
        setPos({ x: newX, y: newY });
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dr.dragging) {
        const currentRect = widgetRef.current?.getBoundingClientRect();
        if (currentRect) {
          const EDGE = 60;
          if (currentRect.left < EDGE) {
            setSnap('left');
            setPos(prev => ({ ...prev, y: currentRect.top }));
          } else if (window.innerWidth - currentRect.right < EDGE) {
            setSnap('right');
            setPos(prev => ({ ...prev, y: currentRect.top }));
          }
        }
      } else {
        setIsOpen(v => !v);
      }
      dr.dragging = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const widgetStyle = displayMode === 'floating'
    ? (snap === 'left'
      ? { left: 0, top: pos.y }
      : snap === 'right'
        ? { right: 0, top: pos.y }
        : { left: pos.x, top: pos.y })
    : {};

  return (
    <div
      ref={widgetRef}
      style={widgetStyle}
      className={`chatbot-widget chatbot-widget--${displayMode} chatbot-widget--snap-${snap}${splitBottom ? ' chatbot-widget--split-bottom' : ''}${isOpen ? ' chatbot-widget--open' : ''}`}
    >
      {displayMode === 'floating' && (
        <div
          className="chatbot-widget__handle"
          onMouseDown={handleDragStart}
          role="button"
          aria-expanded={isOpen}
          aria-label="RWC Living Atlas Helper"
        >
          <span className="chatbot-widget__handle-icon"><FontAwesomeIcon icon={faEarthAmericas} /></span>
          <span className="chatbot-widget__handle-label">RWC Living Atlas Helper</span>
          <span className="chatbot-widget__handle-arrow">{isOpen ? '✕' : ''}</span>
        </div>
      )}

      {/* Chat panel: conditionally rendered, matches other panel behavior */}
      {isOpen && <div className="chatbot-widget__panel">
        <div className="chatbot-widget__header">
          <div className="chatbot-widget__header-main">
            <span className="chatbot-widget__title">RWC Living Atlas Helper - Beta Version</span>
            <div className="chatbot-widget__header-actions">
              <button
                className="chatbot-widget__mode-toggle"
                onClick={handleDisplayModeToggle}
                type="button"
                title={displayMode === 'floating' ? 'Switch to sidebar panel' : 'Switch to floating widget'}
              >
                {displayMode === 'floating' ? '⇄ Sidebar' : '⇄ Floating'}
              </button>
              <button
                className="chatbot-widget__close"
                onClick={() => setIsOpen(false)}
                type="button"
                aria-label="Close Chatbot"
              >
                ✕
              </button>
            </div>
          </div>
          <p className="chatbot-widget__notice">
            Beta: The chatbot is functional, but still under testing. Responses may be inaccurate.
          </p>
        </div>

        <div className="chatbot-widget__messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chatbot-widget__msg chatbot-widget__msg--${msg.role}`}
            >
              {renderMessageText(msg, i)}
            </div>
          ))}
          {loading && (
            <div className="chatbot-widget__msg chatbot-widget__msg--assistant chatbot-widget__msg--typing">
              <span className="chatbot-widget__dot" />
              <span className="chatbot-widget__dot" />
              <span className="chatbot-widget__dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chatbot-widget__input-row">
          <textarea
            ref={inputRef}
            className="chatbot-widget__input"
            placeholder="Ask a question…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            className="chatbot-widget__send"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            ➤
          </button>
        </div>
      </div>}
    </div>
  );
}
