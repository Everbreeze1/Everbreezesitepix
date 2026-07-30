-- GENERAL CONSTRUCTION - Change Order Register
--
-- Tracks change orders against a contract: project header (with an
-- "Original Contract Value" field pre-seeded with a bare "$" prefix), a
-- 7-column change order log, a pending-CO cost/schedule-impact summary, a
-- "Supporting drawings / site photos" 3-photo slot row, and an owner/PM
-- approval sign-off with an in-line Payment Request callout. No merge
-- tokens or Snippets marker here -- unlike the ADJUSTING/CLEANING templates
-- this one has no terms-and-conditions block to point at that feature.
INSERT INTO public.document_templates (slug, team_id, created_by, name, body, fields)
VALUES (
  'example-general-construction-change-order-register',
  NULL,
  NULL,
  'GENERAL CONSTRUCTION - Change Order Register',
  jsonb_build_object(
    'style', 'report',
    'description', 'Project header, a change order log with cost/time impact and status, pending-CO summary, and owner/PM approval sign-off.',
    'html', $html$<h1>GENERAL CONSTRUCTION - Change Order Register</h1><h2>Project Header</h2><table><tbody><tr><th><p>Field</p></th><th><p>Value</p></th></tr><tr><td><p>Project</p></td><td><p></p></td></tr><tr><td><p>Contract #</p></td><td><p></p></td></tr><tr><td><p>Owner</p></td><td><p></p></td></tr><tr><td><p>GC / PM</p></td><td><p></p></td></tr><tr><td><p>Original Contract Value</p></td><td><p>$</p></td></tr></tbody></table><hr><h2>Change Order Log</h2><table><tbody><tr><th><p>CO #</p></th><th><p>Description / Spec Section</p></th><th><p>Cost Impact ($)</p></th><th><p>Time Impact (Days)</p></th><th><p>Status (Draft / Pending / Approved)</p></th><th><p>Owner Signature</p></th><th><p>📷 Photo</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><hr><h2>Pending CO Summary</h2><table><tbody><tr><th><p>Total Draft $</p></th><th><p>Total Pending $</p></th><th><p>Cumulative Days Added</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p>Supporting drawings / site photos</p><p><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'220'%20height%3D'280'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'219'%20height%3D'279'%20rx%3D'6'%20fill%3D'rgb(244%2C245%2C247)'%20stroke%3D'rgb(203%2C208%2C216)'%20stroke-dasharray%3D'5%204'%2F%3E%3Ctext%20x%3D'110'%20y%3D'132'%20font-family%3D'sans-serif'%20font-size%3D'14'%20font-weight%3D'700'%20fill%3D'rgb(107%2C114%2C128)'%20text-anchor%3D'middle'%3EPhoto%201%3C%2Ftext%3E%3Ctext%20x%3D'110'%20y%3D'152'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(156%2C163%2C175)'%20text-anchor%3D'middle'%3EClick%20to%20add%3C%2Ftext%3E%3C%2Fsvg%3E" width="32%" height="280" alt="Photo slot 1"><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'220'%20height%3D'280'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'219'%20height%3D'279'%20rx%3D'6'%20fill%3D'rgb(244%2C245%2C247)'%20stroke%3D'rgb(203%2C208%2C216)'%20stroke-dasharray%3D'5%204'%2F%3E%3Ctext%20x%3D'110'%20y%3D'132'%20font-family%3D'sans-serif'%20font-size%3D'14'%20font-weight%3D'700'%20fill%3D'rgb(107%2C114%2C128)'%20text-anchor%3D'middle'%3EPhoto%202%3C%2Ftext%3E%3Ctext%20x%3D'110'%20y%3D'152'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(156%2C163%2C175)'%20text-anchor%3D'middle'%3EClick%20to%20add%3C%2Ftext%3E%3C%2Fsvg%3E" width="32%" height="280" alt="Photo slot 2"><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'220'%20height%3D'280'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'219'%20height%3D'279'%20rx%3D'6'%20fill%3D'rgb(244%2C245%2C247)'%20stroke%3D'rgb(203%2C208%2C216)'%20stroke-dasharray%3D'5%204'%2F%3E%3Ctext%20x%3D'110'%20y%3D'132'%20font-family%3D'sans-serif'%20font-size%3D'14'%20font-weight%3D'700'%20fill%3D'rgb(107%2C114%2C128)'%20text-anchor%3D'middle'%3EPhoto%203%3C%2Ftext%3E%3Ctext%20x%3D'110'%20y%3D'152'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(156%2C163%2C175)'%20text-anchor%3D'middle'%3EClick%20to%20add%3C%2Ftext%3E%3C%2Fsvg%3E" width="32%" height="280" alt="Photo slot 3"></p><hr><h2>Owner Approval &amp; Payment Request</h2><table><tbody><tr><th><p>Role</p></th><th><p>Name</p></th><th><p>Date</p></th><th><p>Signature</p></th></tr><tr><td><p>Owner / Rep</p></td><td><p></p></td><td><p></p></td><td><p>✍️</p></td></tr><tr><td><p>Contractor PM</p></td><td><p></p></td><td><p></p></td><td><p>✍️</p></td></tr></tbody></table><p><span style="color: rgb(22,163,74)">$</span> <strong>Payment Request</strong> &ndash; Tap to request funding for approved COs. (INSERT PAYMENT REQUEST - Optional)</p>$html$
  ),
  ARRAY[]::text[]
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    body = EXCLUDED.body,
    fields = EXCLUDED.fields,
    archived = false;
