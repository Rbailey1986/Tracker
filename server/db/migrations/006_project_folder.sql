-- 006_project_folder.sql: add first-class folder path to projects
ALTER TABLE projects ADD COLUMN folder TEXT;
