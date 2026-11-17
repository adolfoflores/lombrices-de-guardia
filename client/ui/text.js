export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
export const teamName = (number) => ['▲ Brasa', '◆ Marea', '● Musgo'][number] || '▲ Brasa';
