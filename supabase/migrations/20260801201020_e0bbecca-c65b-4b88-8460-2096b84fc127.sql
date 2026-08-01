ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_doc_type_check;
ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_doc_type_check CHECK (doc_type IN
    ('arbeitsvertrag','arbeitszeugnis_einfach','arbeitsbescheinigung','abmahnung'));