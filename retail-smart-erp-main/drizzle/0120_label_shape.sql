ALTER TABLE label_templates ADD COLUMN label_shape VARCHAR(30) NOT NULL DEFAULT 'rectangle';
ALTER TABLE label_templates ADD COLUMN corner_radius REAL;
