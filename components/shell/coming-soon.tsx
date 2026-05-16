import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ComingSoon({ title, spec, sprint, schema }: { title: string; spec: string; sprint: string; schema?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">Spec section {spec} · roadmap {sprint}</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Not yet implemented in this build</CardTitle>
            <Badge variant="outline">scaffold</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This module is part of the Phase 1 spec and is on the roadmap. The data model below is already in the Prisma
            schema — wiring up the UI and API is the next step.
          </p>
          {schema && (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{schema}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
