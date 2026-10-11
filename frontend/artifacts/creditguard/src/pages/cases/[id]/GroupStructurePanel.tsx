import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAnalyseAnnualReport,
  useSaveGroupStructure,
  getDataRoomQueryKey,
  type CaseDocument,
  type GroupEntity,
  type GroupStructure,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Organogram, compactGroupStructure } from "@/components/organogram";
import { PiPlusLight, PiSpinnerLight, PiTrashLight, PiTreeStructureLight, PiCheckCircleLight, PiArrowClockwiseLight } from "react-icons/pi";

const RELATIONS = ["subsidiary", "joint venture", "associate"];

/**
 * Organogram workflow, step 3 of 4: the group structure is auto-extracted from the
 * annual report (Form AOC-1) when the report is analysed; the RM reviews it here,
 * edits entities and holdings, and saves — which marks it verified. The CAM's
 * Group Structure section (diagram + entity table) is rebuilt from it on generate.
 */
export default function GroupStructurePanel({ caseId, companyName, documents, groupStructure, onRefresh }: {
  caseId: number;
  companyName: string;
  documents: CaseDocument[];
  groupStructure?: GroupStructure;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const save = useSaveGroupStructure();
  const analyse = useAnalyseAnnualReport();
  const [gs, setGs] = useState<GroupStructure>(() => groupStructure ?? { borrower: companyName, entities: [] });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setGs(groupStructure ?? { borrower: companyName, entities: [] });
  }, [groupStructure, companyName, dirty]);

  const preview = useMemo(() => compactGroupStructure({ ...gs, borrower: gs.borrower || companyName }), [gs, companyName]);
  const hasFiling = documents.some((d) => d.doc_type === "annual_report" && d.storage_path?.startsWith("http"));

  const update = (patch: Partial<GroupStructure>) => { setGs((g) => ({ ...g, ...patch })); setDirty(true); };
  const updateEntity = (i: number, patch: Partial<GroupEntity>) =>
    update({ entities: gs.entities.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  const handleSave = async () => {
    const cleaned = { ...gs, borrower: gs.borrower || companyName, entities: gs.entities.filter((e) => e.name?.trim()) };
    try {
      await save.mutateAsync({ caseId, groupStructure: cleaned });
      setDirty(false);
      toast({ title: "Group structure verified", description: "Regenerate the CAM to update the Group Structure section." });
      queryClient.invalidateQueries({ queryKey: getDataRoomQueryKey(caseId) });
      onRefresh();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  const handleExtract = async () => {
    try {
      const r = await analyse.mutateAsync({ caseId });
      toast({ title: `Annual report analysed (${r.fiscalYear ?? "latest"})`, description: `${r.entities} group entities found; ${r.topics.length} topics extracted.` });
      setDirty(false);
      onRefresh();
    } catch (e) {
      const msg = (e as { data?: { error?: string } })?.data?.error;
      toast({ title: "Analysis failed", description: msg || "Could not read the annual report.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2"><PiTreeStructureLight className="h-5 w-5 text-primary" /> Group structure</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Extracted from the annual report (Form AOC-1). Check the entities and holdings, correct anything that is wrong,
            then save to mark the structure verified. The CAM diagram and entity table are built from this list.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {gs.verified && !dirty
            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><PiCheckCircleLight className="mr-1 h-3.5 w-3.5" />Verified</Badge>
            : <Badge variant="outline" className="text-amber-700 border-amber-300">Not verified</Badge>}
          <Button size="sm" variant="outline" onClick={handleExtract} disabled={analyse.isPending || !hasFiling}
            title={hasFiling ? "Re-read the latest annual report" : "Fetch financials first to link the annual report"}>
            {analyse.isPending ? <PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> : <PiArrowClockwiseLight className="mr-2 h-4 w-4" />}
            {gs.entities.length ? "Re-extract" : "Extract from annual report"}
          </Button>
        </div>
      </div>

      {analyse.isPending && (
        <p className="text-xs text-muted-foreground">Reading the annual report — usually 20–40 seconds.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Promoter / holding group</label>
          <Input value={gs.promoter_group ?? ""} placeholder="e.g. Promoter group (names)" onChange={(e) => update({ promoter_group: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Promoter holding %</label>
          <Input type="number" step="0.01" value={gs.promoter_holding_pct ?? ""} onChange={(e) => update({ promoter_holding_pct: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
      </div>

      {gs.entities.length > 0 && <Organogram data={preview} />}

      <div className="rounded-lg border">
        <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(0,1fr)_90px_36px] gap-2 px-3 py-2 text-xs text-muted-foreground border-b bg-muted/30">
          <span>Entity</span><span>Relation</span><span>Country</span><span className="text-right">Holding %</span><span />
        </div>
        <div className="max-h-[420px] overflow-y-auto divide-y">
          {gs.entities.map((e, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(0,1fr)_90px_36px] gap-2 px-3 py-1.5 items-center">
              <Input className="h-8 text-sm" value={e.name} onChange={(ev) => updateEntity(i, { name: ev.target.value })} />
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={RELATIONS.includes(e.relation) ? e.relation : "subsidiary"}
                onChange={(ev) => updateEntity(i, { relation: ev.target.value })}>
                {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Input className="h-8 text-sm" value={e.country ?? ""} placeholder={e.currency ? `(${e.currency})` : ""} onChange={(ev) => updateEntity(i, { country: ev.target.value })} />
              <Input className="h-8 text-sm text-right" type="number" step="0.01" value={e.holding_pct ?? ""}
                onChange={(ev) => updateEntity(i, { holding_pct: ev.target.value === "" ? null : Number(ev.target.value) })} />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Remove entity"
                onClick={() => update({ entities: gs.entities.filter((_, j) => j !== i) })}>
                <PiTrashLight className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {gs.entities.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">
              No entities yet. Extract them from the annual report, or add them manually.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-t">
          <Button size="sm" variant="ghost" onClick={() => update({ entities: [...gs.entities, { name: "", relation: "subsidiary", holding_pct: 100 }] })}>
            <PiPlusLight className="mr-1.5 h-4 w-4" /> Add entity
          </Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" />}Save &amp; mark verified
          </Button>
        </div>
      </div>
      {gs.source_url && (
        <p className="text-xs text-muted-foreground">
          Source: <a className="underline underline-offset-2" href={gs.source_url} target="_blank" rel="noreferrer">annual report filing</a>
          {gs.pages?.length ? `, pages ${gs.pages.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}
