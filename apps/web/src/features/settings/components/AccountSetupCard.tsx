import { useEffect, useState } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { AccountSetupDialog } from "./AccountSetupDialog";

/**
 * "Finish setting up your account", on the dashboard.
 *
 * The wizard opens itself the first time someone lands here, and after that
 * this is a card. That split is the whole design:
 *
 *   * opening once is what makes it a flow rather than a banner nobody reads.
 *     A card alone gets skimmed past, and then the company never tells us their
 *     trade and the template library stays sorted by a guess;
 *   * opening only once, and never blocking, is what keeps the trial honest.
 *     Closing it costs one click and it does not come back on its own, because
 *     a wall between someone and the product on their first visit is the most
 *     expensive place in the funnel to put one.
 *
 * It renders nothing at all when the profile is already answered, when the
 * person is a crew member rather than an owner or admin (the profile is
 * company-wide), or when they have dismissed the card. `useCompanySetup`
 * decides all three; this component only draws.
 *
 * The dismissal is stored on the profile rather than in localStorage, because
 * this product is used from a phone on site and a laptop in the office, and a
 * card that comes back on the other device reads as the dismissal not working.
 * The auto-open guard is the opposite: it IS per device, deliberately, because
 * "has this browser already shown you the wizard" is a fact about this browser,
 * and a first visit on a new device is a reasonable second chance to ask.
 */
const AUTO_OPENED_KEY = (uid: string) => `sitepix:setup-wizard-shown:${uid}`;

export function AccountSetupCard({ className }: { className?: string }) {
  const { user } = useAuth();
  const setup = useCompanySetup();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || !setup.shouldPrompt) return;
    const key = AUTO_OPENED_KEY(user.id);
    try {
      if (localStorage.getItem(key)) return;
      // Written before opening, not after closing. A tab closed mid-wizard
      // must not re-arm this, or someone who abandoned it once gets it again
      // on every visit until they answer.
      localStorage.setItem(key, "1");
    } catch {
      // Private browsing, or storage disabled. Falling through to "do not
      // auto-open" is the safe direction: worst case they use the card.
      return;
    }
    setOpen(true);
  }, [user, setup.shouldPrompt]);

  /*
   * The dialog outlives the card on purpose.
   *
   * Saving the last step completes the profile, which flips `shouldPrompt`
   * false the moment the team query refetches. Unmounting on that would tear
   * the dialog down mid-save and the "you are set up" step - the only place
   * the answers are shown to have done anything - would never render. So the
   * card goes and the dialog stays until it is closed.
   */
  if (!setup.shouldPrompt && !open) return null;

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-[24px] border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-6",
          !setup.shouldPrompt && "hidden",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => void setup.dismiss()}
          aria-label="Dismiss setup reminder"
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4 pr-8">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="max-w-xl">
              <p className="font-manrope text-[15px] font-extrabold tracking-tight text-foreground">
                Tell us your trade and we will sort your templates for it
              </p>
              <p className="font-manrope mt-1 text-sm leading-6 text-muted-foreground">
                Two minutes. Your industry decides which documents lead the library, so an
                electrician stops scrolling past roofing and insurance to find a service call sheet.
              </p>
            </div>
          </div>
          <Button onClick={() => setOpen(true)} className="w-fit shrink-0 font-bold">
            Set up account <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>

      <AccountSetupDialog
        open={open}
        onOpenChange={setOpen}
        profile={setup.profile}
        companyName={setup.companyName}
        hasTeam={!!setup.teamId}
        onSaved={setup.refresh}
      />
    </>
  );
}
