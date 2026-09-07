import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FISCAL_COPY } from "@/lib/fiscal";

export function FiscalBanner() {
  return (
    <Alert>
      <AlertTitle>{FISCAL_COPY.headerInternal}</AlertTitle>
      <AlertDescription>
        {FISCAL_COPY.statusInternal} {FISCAL_COPY.mediaHelp}
      </AlertDescription>
    </Alert>
  );
}
