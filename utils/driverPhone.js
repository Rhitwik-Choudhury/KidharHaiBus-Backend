// Store a dialable international number. Bare Indian mobile numbers use +91.
function normalizeDriverPhone(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!/^[+\d\s()-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, '');
  if (!input.startsWith('+') && /^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (!input.startsWith('+') && /^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (input.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}
module.exports = { normalizeDriverPhone };
