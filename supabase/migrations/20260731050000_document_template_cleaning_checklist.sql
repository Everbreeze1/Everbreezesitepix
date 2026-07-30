-- CLEANING SERVICES - Job Checklist & QA Walk-Through
--
-- A task-tracking document, not a photo report: a service header table (job
-- #, client/site, crew lead, an inline "Yes/No" field rendered as literal
-- ballot-box characters rather than a real checklist item since it needs to
-- sit inline in a single table cell), a 6-column task-checklist table plus a
-- 4-item completion checklist, a quality-assurance walk-through table, a
-- client sign-off block, and a Snippets placeholder for terms & conditions
-- ("[INSERT SNIPPET]" -- matches the ADJUSTING templates' convention). No
-- dedicated photo-slot section like the numbered report family -- photos are
-- meant to be dropped ad hoc into the "Photo" table columns per row.
INSERT INTO public.document_templates (slug, team_id, created_by, name, body, fields)
VALUES (
  'example-cleaning-job-checklist-qa',
  NULL,
  NULL,
  'CLEANING SERVICES - Job Checklist & QA Walk-Through',
  jsonb_build_object(
    'style', 'report',
    'description', 'Service header, task checklist, quality-assurance walk-through table, and client sign-off.',
    'html', $html$<h1>CLEANING SERVICES - Job Checklist &amp; QA Walk-Through</h1><h2>Service Header</h2><table><tbody><tr><th><p>Field</p></th><th><p>Value</p></th></tr><tr><td><p>Job / WO #</p></td><td><p></p></td></tr><tr><td><p>Client / Site</p></td><td><p></p></td></tr><tr><td><p>Service Date</p></td><td><p></p></td></tr><tr><td><p>Crew Lead</p></td><td><p></p></td></tr><tr><td><p>SDS Binder On-Site</p></td><td><p>☐ Yes ☐ No</p></td></tr></tbody></table><hr><h2>Task Checklist</h2><table><tbody><tr><th><p>Area / Room</p></th><th><p>Task</p></th><th><p>Detergent / Dilution</p></th><th><p>PPE (Goggles / N95 / Gloves)</p></th><th><p>Completed (✓)</p></th><th><p>📷 Photo</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Trash &amp; debris removed from site perimeter</p></li><li data-type="taskItem" data-checked="false"><p>High-touch surfaces (door handles, switches) disinfected</p></li><li data-type="taskItem" data-checked="false"><p>Floor mopped &amp; slip signs removed</p></li><li data-type="taskItem" data-checked="false"><p>Air scrubbers / negative air machines off-hired</p></li></ul><hr><h2>Quality-Assurance Walk-Through</h2><table><tbody><tr><th><p>QA Item</p></th><th><p>Pass (Y/N)</p></th><th><p>Notes</p></th><th><p>📷 Photo</p></th></tr><tr><td><p>Surfaces streak-free</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>No chemical odors</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>PPE removed &amp; disposed properly</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>Client walkthrough completed</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p><strong>Client Sign-Off</strong></p><p>I confirm the cleaning scope above was completed to my satisfaction.</p><table><tbody><tr><th><p>Role</p></th><th><p>Name</p></th><th><p>Date</p></th><th><p>Signature</p></th></tr><tr><td><p>Client / Rep</p></td><td><p></p></td><td><p></p></td><td><p>✍️</p></td></tr><tr><td><p>Crew Lead</p></td><td><p></p></td><td><p></p></td><td><p>✍️</p></td></tr></tbody></table><hr><p><strong><u>Standard Terms &amp; Conditions</u></strong> <span style="color: rgb(59,130,246)">[INSERT SNIPPET]</span></p><p><em>Insert company's scope exclusions, re-clean window, and liability statement here.</em></p>$html$
  ),
  ARRAY[]::text[]
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    body = EXCLUDED.body,
    fields = EXCLUDED.fields,
    archived = false;
