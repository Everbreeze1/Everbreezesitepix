-- RESTORATION/REMODELING - Damage Assessment & Scope
--
-- A water/mold restoration working document: loss header (loss class,
-- moisture class), a room-by-room assessment table with an IICRC S500
-- citation note and a containment/equipment checklist, an equipment
-- deployment log, an Xactimate-style line-item scope summary with
-- subtotal/overhead/profit/total, a Snippets terms-and-conditions
-- placeholder ("[INSERT SNIPPET]"), and a PM/adjuster sign-off. No merge
-- tokens -- every field is hand-filled per loss, matching the rest of the
-- working-document family (ADJUSTING / CLEANING / GENERAL CONSTRUCTION).
INSERT INTO public.document_templates (slug, team_id, created_by, name, body, fields)
VALUES (
  'example-restoration-damage-assessment-scope',
  NULL,
  NULL,
  'RESTORATION/REMODELING - Damage Assessment & Scope',
  jsonb_build_object(
    'style', 'report',
    'description', 'Loss header, room-by-room moisture assessment, equipment deployment log, Xactimate-style scope summary, and sign-off.',
    'html', $html$<h1>RESTORATION/REMODELING - Damage Assessment &amp; Scope</h1><h2>Loss Header</h2><table><tbody><tr><th><p>Field</p></th><th><p>Value</p></th></tr><tr><td><p>Claim #</p></td><td><p></p></td></tr><tr><td><p>Loss Class (1&ndash;4)</p></td><td><p></p></td></tr><tr><td><p>Moisture Class (1&ndash;4)</p></td><td><p></p></td></tr><tr><td><p>Building Use</p></td><td><p></p></td></tr><tr><td><p>Adjuster / PM</p></td><td><p></p></td></tr><tr><td><p>Inspection Date</p></td><td><p></p></td></tr></tbody></table><hr><h2>Room-by-Room Assessment</h2><table><tbody><tr><th><p>Room / Area</p></th><th><p>Material</p></th><th><p>Moisture % / Reading</p></th><th><p>Removal (Y/N)</p></th><th><p>Code Upgrade (Y/N)</p></th><th><p>📷 Photo</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p><em>(Moisture readings per <strong>S500 Table 12-1</strong>; use pin or non-invasive meter.)</em></p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Containment erected (6 mil poly, negative air)</p></li><li data-type="taskItem" data-checked="false"><p>Pre-filter / HEPA filter logged</p></li><li data-type="taskItem" data-checked="false"><p>Air mover &amp; dehu counts calculated (AHAM)</p></li></ul><hr><h2>Equipment Deployment Log</h2><table><tbody><tr><th><p>Day</p></th><th><p>Equipment</p></th><th><p>AHAM Rating</p></th><th><p>RH %</p></th><th><p>GPP</p></th><th><p>Tech Initials</p></th><th><p>📷 Photo</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><hr><h2>Scope Summary (Xactimate Style)</h2><table><tbody><tr><th><p>Line</p></th><th><p>Code (e.g., WTR DRY)</p></th><th><p>Description</p></th><th><p>Qty</p></th><th><p>Unit</p></th><th><p>Cost $</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p><strong>Subtotal:</strong> $</p><p><strong>Overhead (10%):</strong> $</p><p><strong>Profit (10%):</strong> $</p><p><strong>Total:</strong> $</p><hr><p><strong><u>Standard Terms &amp; Conditions</u></strong> <span style="color: rgb(59,130,246)">[INSERT SNIPPET]</span></p><p>Drying protocol based on IICRC S500 5th ed. Mold remediation per S520.</p><p>Additional hidden damage will be scoped via CO upon discovery.</p><hr><h2>Sign-off</h2><table><tbody><tr><th><p>Role</p></th><th><p>Name</p></th><th><p>Date</p></th><th><p>Signature</p></th></tr><tr><td><p>Project Manager</p></td><td><p></p></td><td><p></p></td><td><p>✍️</p></td></tr><tr><td><p>Adjuster / Insured</p></td><td><p></p></td><td><p></p></td><td><p>✍️</p></td></tr></tbody></table>$html$
  ),
  ARRAY[]::text[]
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    body = EXCLUDED.body,
    fields = EXCLUDED.fields,
    archived = false;
