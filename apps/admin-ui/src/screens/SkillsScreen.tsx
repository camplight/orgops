import type { SkillMeta } from "../types";
import { Card } from "../components/ui";

type SkillsScreenProps = {
  skills: SkillMeta[];
};

export function SkillsScreen({ skills }: SkillsScreenProps) {
  return (
    <Card title="Skills">
      <div className="space-y-2 text-sm">
        {skills.length === 0 && (
          <div className="text-slate-500">
            No skills discovered. Check API process cwd or ORGOPS_PROJECT_ROOT.
          </div>
        )}
        {skills.map((skill) => (
          <div key={skill.name} className="border-b border-slate-800 pb-2">
            <div className="text-slate-200">{skill.name}</div>
            <div className="text-slate-500">{skill.description}</div>
            <div className="text-slate-600 text-xs">{skill.path}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
