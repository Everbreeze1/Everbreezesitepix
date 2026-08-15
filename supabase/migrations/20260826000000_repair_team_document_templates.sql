-- Repair the templates a team already has.
--
-- 20260824000000 rewrote the built-in library and the STYLE_PRESETS in
-- DocumentTemplatesManager.tsx were rewritten alongside it, so every template
-- created from here on opens with labelled click-to-type blanks. Neither
-- reaches a row that already exists and belongs to a team, and there are three
-- ways a team has one:
--
--   * "Load sample site logs" writes three team-owned copies of the presets;
--   * "New template" writes one, from whichever preset style was picked;
--   * "Duplicate to edit" copies a built-in, which before 20260824000000 was a
--     body with no blanks in it.
--
-- Those rows keep the filler the client complained about: "Item one", "Write
-- your memo body here", "Component - measurement / reading - status", and the
-- hint text that reads as an answer rather than a prompt. Same reasoning as
-- 20260825000000_document_template_dashes.sql, which had to exist for exactly
-- this class of row.
--
-- Two passes, both conservative:
--
--   1. A team row whose body is still byte-identical to an old preset is
--      replaced with that preset's new body. Byte-identical means untouched,
--      so nobody's edit is overwritten. A template the team has changed at all
--      is skipped by this pass entirely.
--
--   2. The hint cells are swapped by content, whole cell at a time. There is
--      one right replacement per cell regardless of which template it sits in,
--      and a cell already holding "[Residential / commercial]" no longer
--      matches, so this cannot double-apply.
--
-- `fields` is deliberately not recomputed: none of the preset rewrites added or
-- removed a merge token, so every stored array is still correct.
--
-- Not touched: the built-in library (team_id IS NULL), which 20260824000000
-- owns, and any wording a person typed themselves.
--
-- Idempotent - both passes match only text that has not been converted yet.
-- Apply manually in the Supabase SQL editor (or `supabase db push`).

DO $$
DECLARE
  swap     record;
  affected bigint;
  total    bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_templates'
  ) THEN
    RAISE NOTICE 'skipping document_templates (not present)';
    RETURN;
  END IF;

  -- Pass 1: untouched copies of a preset, replaced whole.
  FOR swap IN
    SELECT * FROM (VALUES
      -- report
      ($h$<h1>{{project_name}} - Field Report</h1>
<p><em>{{date}} · Prepared by {{prepared_by}}</em></p>
<h2>Overview</h2>
<p>Summary of site conditions observed at {{project_address}}.</p>
<h2>Findings</h2>
<ul><li>Item one</li><li>Item two</li></ul>
<h2>Recommendations</h2>
<ol><li>First action</li><li>Second action</li></ol>$h$,
       $h$<h1>{{project_name}} - Field Report</h1>
<p><em>{{date}} · Prepared by {{prepared_by}}</em></p>
<h2>Overview</h2>
<p><strong>Site:</strong> {{project_address}}</p>
<p>[Overall condition of the site]</p>
<h2>Findings</h2>
<ul><li>[What you found]</li><li>[What you found]</li></ul>
<h2>Recommendations</h2>
<ol><li>[What should happen, and by when]</li><li>[What should happen, and by when]</li></ol>$h$),
      -- letter
      ($h$<p>{{date}}</p>
<p>{{client_name}}<br>{{project_address}}</p>
<p><strong>Re: {{project_name}}</strong></p>
<p>Dear {{client_name}},</p>
<p>Write your message here…</p>
<p>Sincerely,</p>
<p>{{prepared_by}}<br>{{prepared_by_title}}<br>{{company_name}}</p>$h$,
       $h$<p>{{date}}</p>
<p>{{client_name}}<br>{{project_address}}</p>
<p><strong>Re: {{project_name}}</strong></p>
<p>Dear {{client_name}},</p>
<p>[Write your message here]</p>
<p>Sincerely,</p>
<p>{{prepared_by}}<br>{{prepared_by_title}}<br>{{company_name}}</p>$h$),
      -- checklist
      ($h$<h1>{{project_name}} - Checklist Summary</h1>
<p><em>Completed {{date}} · {{prepared_by}}</em></p>
<h2>Completed items</h2>
<ul><li>Item one</li><li>Item two</li></ul>
<h2>Outstanding</h2>
<ul><li>Follow-up needed</li></ul>$h$,
       $h$<h1>{{project_name}} - Checklist Summary</h1>
<p><em>Completed {{date}} · {{prepared_by}}</em></p>
<h2>Completed items</h2>
<ul><li>[What was completed]</li><li>[What was completed]</li></ul>
<h2>Outstanding</h2>
<ul><li>[What is still open, and who owns it]</li></ul>$h$),
      -- memo
      ($h$<h1>Memorandum</h1>
<p><strong>To:</strong> {{client_name}}<br>
<strong>From:</strong> {{prepared_by}}<br>
<strong>Date:</strong> {{date}}<br>
<strong>Re:</strong> {{project_name}}</p>
<hr>
<p>Write your memo body here…</p>$h$,
       $h$<h1>Memorandum</h1>
<p><strong>To:</strong> {{client_name}}<br>
<strong>From:</strong> {{prepared_by}}<br>
<strong>Date:</strong> {{date}}<br>
<strong>Re:</strong> {{project_name}}</p>
<hr>
<p>[Write your memo here]</p>$h$),
      -- walkthrough
      ($h$<h1>{{project_name}} - Walkthrough Report</h1>
<p><em>{{date}} · Led by {{prepared_by}} · Weather: {{weather}}</em></p>
<h2>Attendees</h2>
<ul><li>{{prepared_by}} ({{prepared_by_title}})</li><li>{{client_name}}</li></ul>
<h2>Route & Observations</h2>
<h3>Area 1</h3>
<p>Describe conditions, progress, and any concerns observed.</p>
<h3>Area 2</h3>
<p>Describe conditions, progress, and any concerns observed.</p>
<h2>Action Items</h2>
<ol><li>Follow-up task one</li><li>Follow-up task two</li></ol>
<h2>Next Steps</h2>
<p>Summarize the plan through the next walkthrough.</p>$h$,
       $h$<h1>{{project_name}} - Walkthrough Report</h1>
<p><em>{{date}} · Led by {{prepared_by}} · Weather: {{weather}}</em></p>
<h2>Attendees</h2>
<ul><li>{{prepared_by}} ({{prepared_by_title}})</li><li>{{client_name}}</li></ul>
<h2>Route & Observations</h2>
<h3>Area 1</h3>
<p>[Conditions, progress and any concerns]</p>
<h3>Area 2</h3>
<p>[Conditions, progress and any concerns]</p>
<h2>Action Items</h2>
<ol><li>[Follow-up task and who owns it]</li><li>[Follow-up task and who owns it]</li></ol>
<h2>Next Steps</h2>
<p>[The plan through to the next walkthrough]</p>$h$),
      -- sitelog
      ($h$<h1>{{project_name}}</h1>
<p><strong>Daily Site Log</strong> · {{date}}</p>
<p><em>Prepared by {{prepared_by}}, {{prepared_by_title}} · {{company_name}}</em></p>
<hr>
<h2>Site conditions</h2>
<p><strong>Location:</strong> {{project_address}}<br>
<strong>Weather:</strong> {{weather}}<br>
<strong>Project #:</strong> {{project_number}}</p>
<h2>Crew on site</h2>
<ul>
  <li>Trade / company - number of workers - hours</li>
  <li>Trade / company - number of workers - hours</li>
</ul>
<h2>Work performed today</h2>
<ol>
  <li>Describe the first task completed and its location.</li>
  <li>Describe the second task completed and its location.</li>
  <li>Describe any inspections or milestones reached.</li>
</ol>
<h2>Deliveries & equipment</h2>
<ul>
  <li>Material or equipment - supplier - quantity</li>
</ul>
<h2>Issues, delays & safety</h2>
<blockquote><p>Record any RFIs, blockers, incidents, or safety observations here. Note who was informed and the follow-up action taken.</p></blockquote>
<h2>Photos referenced</h2>
<p>List key photos captured today with brief captions.</p>
<h2>Plan for tomorrow</h2>
<ul>
  <li>Priority task and responsible trade</li>
  <li>Coordination items or deliveries expected</li>
</ul>
<hr>
<p><em>Signed: {{prepared_by}} - {{date}}</em></p>$h$,
       $h$<h1>{{project_name}}</h1>
<p><strong>Daily Site Log</strong> · {{date}}</p>
<p><em>Prepared by {{prepared_by}}, {{prepared_by_title}} · {{company_name}}</em></p>
<hr>
<h2>Site conditions</h2>
<p><strong>Location:</strong> {{project_address}}<br>
<strong>Weather:</strong> {{weather}}<br>
<strong>Project #:</strong> {{project_number}}</p>
<h2>Crew on site</h2>
<ul>
  <li>[Trade or company, workers, hours]</li>
  <li>[Trade or company, workers, hours]</li>
</ul>
<h2>Work performed today</h2>
<ol>
  <li>[First task completed, and where]</li>
  <li>[Second task completed, and where]</li>
  <li>[Inspections or milestones reached]</li>
</ol>
<h2>Deliveries & equipment</h2>
<ul>
  <li>[Material or equipment, supplier, quantity]</li>
</ul>
<h2>Issues, delays & safety</h2>
<blockquote><p>[RFIs, blockers, incidents, who was told, action taken]</p></blockquote>
<h2>Photos referenced</h2>
<p>[Key photos from today, with captions]</p>
<h2>Plan for tomorrow</h2>
<ul>
  <li>[Priority task and responsible trade]</li>
  <li>[Coordination items or deliveries expected]</li>
</ul>
<hr>
<p><em>Signed: {{prepared_by}} - {{date}}</em></p>$h$),
      -- sitelog_basic
      ($h$<h1>{{project_name}}</h1>
<p><strong>Daily Site Log</strong> - {{date}}</p>
<p><em>{{prepared_by}} · {{company_name}}</em></p>
<hr>
<h2>Summary</h2>
<p>Brief overview of what happened on site today at {{project_address}}. Weather was {{weather}}.</p>
<h2>Work completed</h2>
<ul>
  <li>Task one - location / trade</li>
  <li>Task two - location / trade</li>
  <li>Task three - location / trade</li>
</ul>
<h2>Photos &amp; notes</h2>
<blockquote><p>Attach the day's photos and add a short caption for each. Highlight anything worth flagging for the client or the team.</p></blockquote>
<h2>Notes for tomorrow</h2>
<p>Anything the crew or client should know before the next shift.</p>
<hr>
<p><em>Prepared by {{prepared_by}} - {{date}}</em></p>$h$,
       $h$<h1>{{project_name}}</h1>
<p><strong>Daily Site Log</strong> - {{date}}</p>
<p><em>{{prepared_by}} · {{company_name}}</em></p>
<hr>
<h2>Summary</h2>
<p><strong>Site:</strong> {{project_address}} · <strong>Weather:</strong> {{weather}}</p>
<p>[What happened on site today]</p>
<h2>Work completed</h2>
<ul>
  <li>[Task, location, trade]</li>
  <li>[Task, location, trade]</li>
  <li>[Task, location, trade]</li>
</ul>
<h2>Photos &amp; notes</h2>
<blockquote><p>[Caption each photo, and flag anything the client should see]</p></blockquote>
<h2>Notes for tomorrow</h2>
<p>[What the crew or client should know before the next shift]</p>
<hr>
<p><em>Prepared by {{prepared_by}} - {{date}}</em></p>$h$),
      -- sitelog_walkthrough
      ($h$<h1>{{project_name}} - Walkthrough Log</h1>
<p><strong>Date:</strong> {{date}} · <strong>Weather:</strong> {{weather}}</p>
<p><strong>Led by:</strong> {{prepared_by}}, {{prepared_by_title}} · <strong>Client:</strong> {{client_name}}</p>
<p><strong>Location:</strong> {{project_address}} · <strong>Project #:</strong> {{project_number}}</p>
<hr>
<h2>1. Attendees</h2>
<ul>
  <li>{{prepared_by}} - {{prepared_by_title}} ({{company_name}})</li>
  <li>{{client_name}} - Owner representative</li>
  <li>Additional attendee - role</li>
</ul>
<h2>2. Scope of walkthrough</h2>
<p>Describe the areas covered, the purpose of the visit, and any specific items requested by the client.</p>
<h2>3. Findings by area</h2>
<h3>Area A - e.g. Ground floor</h3>
<ul>
  <li><strong>Observation:</strong> what was seen</li>
  <li><strong>Status:</strong> on track / delayed / needs attention</li>
</ul>
<h3>Area B - e.g. Mechanical room</h3>
<ul>
  <li><strong>Observation:</strong> what was seen</li>
  <li><strong>Status:</strong> on track / delayed / needs attention</li>
</ul>
<h2>4. Photo notes</h2>
<blockquote><p>Reference each photo by number and add a one-line caption describing what it shows and why it matters.</p></blockquote>
<ol>
  <li>Photo 1 - caption</li>
  <li>Photo 2 - caption</li>
  <li>Photo 3 - caption</li>
</ol>
<h2>5. Action items</h2>
<ol>
  <li>Action - <strong>Owner:</strong> name - <strong>Due:</strong> date</li>
  <li>Action - <strong>Owner:</strong> name - <strong>Due:</strong> date</li>
</ol>
<h2>6. Next walkthrough</h2>
<p>Proposed date, attendees, and focus areas for the next visit.</p>
<hr>
<p><em>Signed: {{prepared_by}} - {{date}}</em></p>$h$,
       $h$<h1>{{project_name}} - Walkthrough Log</h1>
<p><strong>Date:</strong> {{date}} · <strong>Weather:</strong> {{weather}}</p>
<p><strong>Led by:</strong> {{prepared_by}}, {{prepared_by_title}} · <strong>Client:</strong> {{client_name}}</p>
<p><strong>Location:</strong> {{project_address}} · <strong>Project #:</strong> {{project_number}}</p>
<hr>
<h2>1. Attendees</h2>
<ul>
  <li>{{prepared_by}} - {{prepared_by_title}} ({{company_name}})</li>
  <li>{{client_name}} - Owner representative</li>
  <li>[Additional attendee, role]</li>
</ul>
<h2>2. Scope of walkthrough</h2>
<p>[Areas covered, purpose, anything the client asked for]</p>
<h2>3. Findings by area</h2>
<h3>Area A - [e.g. Ground floor]</h3>
<ul>
  <li><strong>Observation:</strong> [what was seen]</li>
  <li><strong>Status:</strong> [on track / delayed / needs attention]</li>
</ul>
<h3>Area B - [e.g. Mechanical room]</h3>
<ul>
  <li><strong>Observation:</strong> [what was seen]</li>
  <li><strong>Status:</strong> [on track / delayed / needs attention]</li>
</ul>
<h2>4. Photo notes</h2>
<ol>
  <li>[Photo 1, what it shows and why it matters]</li>
  <li>[Photo 2, what it shows and why it matters]</li>
  <li>[Photo 3, what it shows and why it matters]</li>
</ol>
<h2>5. Action items</h2>
<ol>
  <li>[Action] - <strong>Owner:</strong> [Name] - <strong>Due:</strong> [Date]</li>
  <li>[Action] - <strong>Owner:</strong> [Name] - <strong>Due:</strong> [Date]</li>
</ol>
<h2>6. Next walkthrough</h2>
<p>[Proposed date, attendees and focus areas]</p>
<hr>
<p><em>Signed: {{prepared_by}} - {{date}}</em></p>$h$),
      -- sitelog_hvac
      ($h$<h1>{{project_name}} - HVAC / Construction Log</h1>
<p><strong>Date:</strong> {{date}} · <strong>Project #:</strong> {{project_number}}</p>
<p><strong>Inspector:</strong> {{prepared_by}}, {{prepared_by_title}} · {{company_name}}</p>
<p><strong>Site:</strong> {{project_address}} · <strong>Conditions:</strong> {{weather}}</p>
<hr>
<h2>1. Systems inspected</h2>
<ul>
  <li>Air handling unit(s) - location / tag</li>
  <li>Ductwork run(s) - floor / zone</li>
  <li>Piping / refrigerant lines - segment</li>
  <li>Controls &amp; thermostats - zone</li>
</ul>
<h2>2. Technical observations</h2>
<h3>Mechanical</h3>
<ul>
  <li>Component - measurement / reading - status</li>
  <li>Component - measurement / reading - status</li>
</ul>
<h3>Electrical &amp; controls</h3>
<ul>
  <li>Panel / circuit - observation</li>
  <li>Sensor / control - observation</li>
</ul>
<h3>Structural / rough-in</h3>
<ul>
  <li>Framing, penetrations, hangers - observation</li>
</ul>
<h2>3. Progress vs. schedule</h2>
<blockquote><p>Summarize percent complete for each system and call out anything ahead of or behind the baseline schedule.</p></blockquote>
<ol>
  <li>HVAC rough-in - % complete - on track / behind</li>
  <li>Duct insulation - % complete - on track / behind</li>
  <li>Startup &amp; commissioning - % complete - on track / behind</li>
</ol>
<h2>4. Deficiencies &amp; safety</h2>
<ul>
  <li>Deficiency - location - severity - corrective action</li>
  <li>Safety observation - corrective action</li>
</ul>
<h2>5. Recommendations</h2>
<ol>
  <li>Recommendation - responsible party - target date</li>
  <li>Recommendation - responsible party - target date</li>
</ol>
<h2>6. Photos referenced</h2>
<p>Attach labeled photos of each system inspected, with tags matching the observations above.</p>
<hr>
<p><em>Report prepared by {{prepared_by}} ({{prepared_by_title}}) - {{date}}</em></p>$h$,
       $h$<h1>{{project_name}} - HVAC / Construction Log</h1>
<p><strong>Date:</strong> {{date}} · <strong>Project #:</strong> {{project_number}}</p>
<p><strong>Inspector:</strong> {{prepared_by}}, {{prepared_by_title}} · {{company_name}}</p>
<p><strong>Site:</strong> {{project_address}} · <strong>Conditions:</strong> {{weather}}</p>
<hr>
<h2>1. Systems inspected</h2>
<ul>
  <li>Air handling unit(s) - [location / tag]</li>
  <li>Ductwork run(s) - [floor / zone]</li>
  <li>Piping / refrigerant lines - [segment]</li>
  <li>Controls &amp; thermostats - [zone]</li>
</ul>
<h2>2. Technical observations</h2>
<h3>Mechanical</h3>
<ul>
  <li>[Component, measurement or reading, status]</li>
  <li>[Component, measurement or reading, status]</li>
</ul>
<h3>Electrical &amp; controls</h3>
<ul>
  <li>Panel / circuit - [observation]</li>
  <li>Sensor / control - [observation]</li>
</ul>
<h3>Structural / rough-in</h3>
<ul>
  <li>Framing, penetrations, hangers - [observation]</li>
</ul>
<h2>3. Progress vs. schedule</h2>
<ol>
  <li>HVAC rough-in - [% complete] - [on track / behind]</li>
  <li>Duct insulation - [% complete] - [on track / behind]</li>
  <li>Startup &amp; commissioning - [% complete] - [on track / behind]</li>
</ol>
<h2>4. Deficiencies &amp; safety</h2>
<ul>
  <li>[Deficiency, location, severity, corrective action]</li>
  <li>[Safety observation, corrective action]</li>
</ul>
<h2>5. Recommendations</h2>
<ol>
  <li>[Recommendation, responsible party, target date]</li>
  <li>[Recommendation, responsible party, target date]</li>
</ol>
<h2>6. Photos referenced</h2>
<p>[Photos of each system, tagged to the observations above]</p>
<hr>
<p><em>Report prepared by {{prepared_by}} ({{prepared_by_title}}) - {{date}}</em></p>$h$)
    ) AS t(old_html, new_html)
  LOOP
    UPDATE public.document_templates
       SET body = body || jsonb_build_object('html', swap.new_html)
     WHERE team_id IS NOT NULL
       AND jsonb_typeof(body -> 'html') = 'string'
       AND body ->> 'html' = swap.old_html;
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
  END LOOP;
  IF total > 0 THEN
    RAISE NOTICE 'replaced % untouched preset cop(y/ies)', total;
  END IF;

  -- Pass 2: hint text that reads as an answer, turned into the prompt it meant.
  total := 0;
  FOR swap IN
    SELECT * FROM (VALUES
      ($h$<td><p>Residential / commercial</p></td>$h$, $h$<td><p>[Residential / commercial]</p></td>$h$),
      ($h$<td><p>Steep-slope / low-slope</p></td>$h$, $h$<td><p>[Steep-slope / low-slope]</p></td>$h$),
      ($h$<td><p>Temp / wind / dry or wet</p></td>$h$, $h$<td><p>[Temp / wind / dry or wet]</p></td>$h$),
      ($h$<td><p>Temp / wind / conditions</p></td>$h$, $h$<td><p>[Temp / wind / conditions]</p></td>$h$),
      ($h$<td><p>1 clean / 2 grey / 3 black</p></td>$h$, $h$<td><p>[1 clean / 2 grey / 3 black]</p></td>$h$),
      ($h$<td><p>Yes / no</p></td>$h$, $h$<td><p>[Yes / no]</p></td>$h$)
    ) AS t(old_cell, new_cell)
  LOOP
    UPDATE public.document_templates
       SET body = body || jsonb_build_object(
             'html', replace(body ->> 'html', swap.old_cell, swap.new_cell))
     WHERE team_id IS NOT NULL
       AND jsonb_typeof(body -> 'html') = 'string'
       AND position(swap.old_cell in body ->> 'html') > 0;
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
  END LOOP;
  IF total > 0 THEN
    RAISE NOTICE 'converted hint cells in % template(s)', total;
  END IF;
END $$;

-- === VERIFY ================================================================
-- Every team template that still has no blank in it. Expect only templates the
-- team wrote themselves from scratch, which this file deliberately leaves be.
--
-- SELECT id, name, body ->> 'style' AS style
--   FROM public.document_templates
--  WHERE team_id IS NOT NULL
--    AND archived = false
--    AND position('[' in coalesce(body ->> 'html', '')) = 0
--  ORDER BY updated_at DESC;
