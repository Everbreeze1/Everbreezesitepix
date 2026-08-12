import {
  CHECKLIST_TYPE_LABELS,
  WORKFLOW_KIND_LABELS,
  formatProjectAddress,
  type ChecklistItemType,
  type WorkflowItemKind,
} from "@sitepix/shared";
import { cn } from "@/lib/utils";
import type {
  FieldRecordBody,
  FieldRecordCompany,
  FieldRecordItem,
  FieldRecordProject,
} from "@/lib/field-records.functions";

/**
 * One checklist or workflow, rendered as the document a customer or inspector
 * actually receives.
 *
 * Rendered from exactly one view-model in all three places it appears:
 *
 *   1. the app's print output, via `PrintDocument` (owner filling it in)
 *   2. the public share link on screen (recipient reading it)
 *   3. that link printed by the recipient
 *
 * That is the whole point of the component. Before this, a checklist could only
 * be read inside a modal by whoever owned it — so the record of what was
 * checked on a job had no way out of the app at all, and the same record
 * rendered from two different code paths would have drifted into two different
 * documents within a release.
 *
 * A checklist is treated as a workflow with a single unnamed section, so the
 * layout, the type chips and the break rules are written once.
 */

const KIND_EYEBROW: Record<FieldRecordBody["kind"], string> = {
  checklist: "Checklist record",
  workflow: "Workflow record",
};

function typeLabel(kind: FieldRecordBody["kind"], type: string): string | null {
  if (kind === "workflow") {
    const label = WORKFLOW_KIND_LABELS[type as WorkflowItemKind];
    // A plain check is the default and carries no information as a chip.
    return !label || type === "check" ? null : label;
  }
  const label = CHECKLIST_TYPE_LABELS[type as ChecklistItemType];
  return !label || type === "checkbox" ? null : label;
}

/** Dates on a compliance document are unambiguous — never "3 days ago". */
function docDate(iso: string | null | undefined, withTime = false): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return withTime
    ? d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface RecordDocumentProps {
  record: FieldRecordBody;
  project: FieldRecordProject | null;
  company: FieldRecordCompany | null;
  author?: { name: string | null } | null;
  /**
   * Screen mode drops the sheet's own page padding and max width, for embedding
   * inside a container that already draws the paper (the share page).
   */
  variant?: "print" | "screen";
  className?: string;
}

export function RecordDocument({
  record,
  project,
  company,
  author,
  variant = "print",
  className,
}: RecordDocumentProps) {
  const address = formatProjectAddress(project);
  const completed = docDate(record.completedAt, true);
  const started = docDate(record.createdAt);
  const hasItems = record.sections.some((s) => s.items.length > 0);
  /* A checklist is one unnamed section; naming it "Items" on the page would add
     a heading that says nothing. Workflow phases are genuinely named. */
  const showSectionHeads = record.sections.some((s) => !!s.name);

  return (
    <article className={cn("record-doc", variant === "screen" && "record-doc--screen", className)}>
      <header className="record-doc__letterhead">
        <div>
          {company?.logo_url ? (
            <img
              className="record-doc__logo"
              src={company.logo_url}
              alt={company.name ?? "Company logo"}
            />
          ) : company?.name ? (
            <div className="record-doc__company">{company.name}</div>
          ) : null}
          {company?.logo_url && company.name && (
            <div className="record-doc__company-meta">{company.name}</div>
          )}
          {(company?.phone || company?.address) && (
            <div className="record-doc__company-meta">
              {[company.address, company.phone].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="record-doc__kind">{KIND_EYEBROW[record.kind]}</div>
      </header>

      <h1 className="record-doc__title">{record.title}</h1>
      {record.description && <p className="record-doc__subtitle">{record.description}</p>}

      <section className="record-doc__facts">
        <div>
          <div className="record-doc__fact-label">Project</div>
          <div className="record-doc__fact-value">{project?.name ?? "—"}</div>
        </div>
        <div>
          <div className="record-doc__fact-label">Site</div>
          <div className="record-doc__fact-value">{address ?? "—"}</div>
        </div>
        <div>
          <div className="record-doc__fact-label">{completed ? "Completed" : "Started"}</div>
          <div className="record-doc__fact-value">{completed ?? started ?? "—"}</div>
        </div>
        <div>
          <div className="record-doc__fact-label">
            {record.kind === "workflow" ? "Steps done" : "Items done"}
          </div>
          <div className="record-doc__fact-value">
            {record.done} / {record.total}
          </div>
        </div>
      </section>

      {/*
        The rich-text write-up.
        Safe on both paths: on the public share route the server sanitises before
        the HTML leaves the API (`field-records.ts` → `sanitizePageHtml`), and in
        the app the author is reading back their own editor output.
      */}
      {record.notesHtml && (
        <div className="record-doc__notes" dangerouslySetInnerHTML={{ __html: record.notesHtml }} />
      )}

      {!hasItems && (
        <div className="record-doc__empty">Nothing has been added to this {record.kind} yet.</div>
      )}

      {record.sections.map((section) => {
        if (!section.items.length && !section.name) return null;
        const done = section.items.filter((i) => i.answered).length;
        return (
          <section className="record-doc__section" key={section.id}>
            {showSectionHeads && section.name && (
              <div className="record-doc__section-head">
                <div>
                  <div className="record-doc__section-name">{section.name}</div>
                  {section.description && (
                    <div className="record-doc__section-desc">{section.description}</div>
                  )}
                </div>
                <div className="record-doc__section-meta">
                  {done} / {section.items.length} done
                </div>
              </div>
            )}

            {section.items.length > 0 && (
              <ol className="record-doc__items">
                {section.items.map((item, idx) => (
                  <RecordLine key={item.id} item={item} index={idx + 1} kind={record.kind} />
                ))}
              </ol>
            )}

            {section.notes && <div className="record-doc__section-notes">{section.notes}</div>}

            {section.signoff ? (
              <div className="record-doc__signoff">
                Signed off by{" "}
                <span className="record-doc__signoff-name">{section.signoff.name || "—"}</span> ·{" "}
                {docDate(section.signoff.at, true)}
              </div>
            ) : (
              /* Only phases that were designed to need a signature get a rule to
                 sign on; drawing one under every section would invite a
                 signature the record never asked for. */
              section.requiresSignoff && <SignatureLine />
            )}
          </section>
        );
      })}

      <footer className="record-doc__footer">
        <span>{[company?.name, author?.name].filter(Boolean).join(" · ") || "SitePix"}</span>
        <span>
          {record.completedAt
            ? `Record sealed ${docDate(record.completedAt, true)}`
            : "In progress — not yet complete"}
        </span>
      </footer>
    </article>
  );
}

function RecordLine({
  item,
  index,
  kind,
}: {
  item: FieldRecordItem;
  index: number;
  kind: FieldRecordBody["kind"];
}) {
  const chip = typeLabel(kind, item.type);
  /*
   * Which lines get an answer row.
   *
   * A ticked checkbox needs none — the box *is* the answer, and printing
   * "Answer: —" beside it is noise on every row of a punch list. Anything that
   * was designed to capture a value gets a row either way: filled in when there
   * is one, and a blank rule when there is not, so the printout still works as
   * the form somebody completes with a pen.
   */
  const expectsValue = kind === "workflow" ? item.type === "note" : item.type !== "checkbox";

  return (
    <li className="record-doc__item">
      <span className="record-doc__num">{index}.</span>
      <span
        className={cn("record-doc__box", item.answered && "record-doc__box--done")}
        aria-hidden="true"
      />
      <div className="record-doc__item-body">
        <div className="record-doc__label">
          {item.label || "Untitled item"}
          {item.required && (
            <span className="record-doc__chip record-doc__chip--required">Required</span>
          )}
          {chip && <span className="record-doc__chip">{chip}</span>}
        </div>
        {item.description && <div className="record-doc__hint">{item.description}</div>}

        {(expectsValue || item.answer) && (
          <div className="record-doc__answer">
            <span className="record-doc__answer-label">
              {kind === "workflow" ? "Note" : "Answer"}
            </span>
            {item.answer ? (
              <span className="record-doc__answer-value">{item.answer}</span>
            ) : (
              <span className="record-doc__blank" />
            )}
          </div>
        )}

        {item.notes && (
          <div className="record-doc__answer">
            <span className="record-doc__answer-label">Notes</span>
            <span className="record-doc__answer-value">{item.notes}</span>
          </div>
        )}

        {item.photoUrls.length > 0 && (
          <div className="record-doc__photos">
            {item.photoUrls.map((url, i) => (
              // Print-only/read-only surface: no lazy loading, because a lazily
              // loaded image is frequently still blank when the print dialog
              // snapshots the page.
              <img key={url + i} src={url} alt={`Photo for ${item.label}`} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function SignatureLine() {
  return (
    <div className="record-doc__sign-line">
      <div>
        <div className="record-doc__sign-rule" />
        <div className="record-doc__sign-caption">Signature</div>
      </div>
      <div>
        <div className="record-doc__sign-rule" />
        <div className="record-doc__sign-caption">Print name</div>
      </div>
      <div>
        <div className="record-doc__sign-rule" />
        <div className="record-doc__sign-caption">Date</div>
      </div>
    </div>
  );
}
