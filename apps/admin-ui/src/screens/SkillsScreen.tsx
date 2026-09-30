import type {
  SkillConflict,
  SkillMeta,
  SkillRootDiagnostic,
} from "../types";
import { Card } from "../components/ui";

type SkillsScreenProps = {
  skills: SkillMeta[];
  conflicts?: SkillConflict[];
  diagnostics?: SkillRootDiagnostic[];
};

export function SkillsScreen({
  skills,
  conflicts = [],
  diagnostics = [],
}: SkillsScreenProps) {
  return (
    <Card title="Skills">
      <div className="space-y-3 text-sm">
        {diagnostics.length > 0 && (
          <div className="rounded border border-amber-800 bg-amber-950/30 p-2 text-amber-200">
            <div className="font-medium">Skill repository warnings</div>
            {diagnostics.map((diagnostic) => (
              <div key={`${diagnostic.path}:${diagnostic.code}`} className="text-xs">
                {diagnostic.code}: {diagnostic.path}
              </div>
            ))}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="rounded border border-amber-800 bg-amber-950/30 p-2 text-amber-200">
            <div className="font-medium">Duplicate skills</div>
            {conflicts.map((conflict) => (
              <div key={conflict.name} className="text-xs">
                <div>{conflict.name}</div>
                {conflict.paths.map((path) => (
                  <div key={path} className="text-slate-400">{path}</div>
                ))}
              </div>
            ))}
          </div>
        )}
        {skills.length === 0 && (
          <div className="text-slate-500">
            No skills discovered. Check API process cwd or ORGOPS_PROJECT_ROOT.
          </div>
        )}
        {skills.map((skill) => (
          <div key={skill.name} className="border-b border-slate-800 pb-2">
            <div className="text-slate-200">{skill.name}</div>
            <div className="text-slate-500">{skill.description}</div>
            <div className="text-xs text-slate-500">
              {skill.root.kind === "EXTERNAL" ? "External" : "Built-in"}: {skill.root.path}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
