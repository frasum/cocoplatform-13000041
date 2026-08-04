import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEuroToCents } from "@/lib/cash/kasse-helpers";

export function ExpenseForm({
  writable,
  onAdd,
  submitLabel = "Ausgabe hinzufügen",
}: {
  writable: boolean;
  onAdd: (description: string, cents: number) => Promise<unknown>;
  /** SE1-b: Button-Text je Karte (Ausgaben vs. Sonstige Einnahmen). */
  submitLabel?: string;
}) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const cents = parseEuroToCents(amount);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        className="min-w-[12rem] flex-1"
        placeholder="Beschreibung"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        disabled={!writable}
      />
      <Input
        className="w-28 text-right font-mono"
        inputMode="decimal"
        placeholder="€"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={!writable}
      />
      <Button
        size="sm"
        disabled={!writable || desc.trim() === "" || cents === null || cents <= 0 || pending}
        onClick={async () => {
          setPending(true);
          try {
            await onAdd(desc.trim(), cents!);
            setDesc("");
            setAmount("");
          } finally {
            setPending(false);
          }
        }}
      >
        {submitLabel}
      </Button>
    </div>
  );
}
