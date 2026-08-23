import DOMPurify from 'dompurify';

// Card descriptions are now rich-text HTML (produced by TipTap in the editor).
// Sanitize before rendering into the DOM to prevent stored XSS.
export function sanitizeHtml(html) {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
            'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
            'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a',
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
    });
}

// Convert rich-text HTML to plain text. Used for the PDF export (jsPDF cannot
// render HTML) and for character-count validation.
export function htmlToPlainText(html) {
    if (!html) return '';
    const withBreaks = String(html)
        .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n');
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
    return (doc.body.textContent || '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
