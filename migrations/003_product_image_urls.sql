-- Ordered gallery images (JSON array of URL strings: https, site paths, or data:image/...).
ALTER TABLE products ADD COLUMN image_urls_json TEXT NOT NULL DEFAULT '[]';
