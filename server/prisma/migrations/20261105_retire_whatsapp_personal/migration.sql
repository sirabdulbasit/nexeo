-- Owner, 5 Nov 2026: one registered WhatsApp number per client; the personal-number link is removed.
-- The catalogue row stops being offered. Existing rows and data are kept. Idempotent by project rule.

UPDATE connector_types SET is_active = FALSE WHERE slug = 'whatsapp_personal';
