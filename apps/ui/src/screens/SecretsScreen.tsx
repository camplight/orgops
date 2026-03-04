import { useState } from "react";
import type { SecretRow } from "../types";
import { Button, Card, Input, Select } from "../components/ui";

type SecretsScreenProps = {
  secrets: SecretRow[];
  onAddSecret: (secret: {
    name: string;
    scopeType: string;
    scopeId: string | null;
    value: string;
  }) => Promise<void>;
  onDeleteSecret: (id: string) => Promise<void>;
};

export function SecretsScreen({ secrets, onAddSecret, onDeleteSecret }: SecretsScreenProps) {
  const [newSecret, setNewSecret] = useState({
    name: "",
    scopeType: "package",
    scopeId: "",
    value: ""
  });

  const handleSave = async () => {
    await onAddSecret({
      name: newSecret.name,
      scopeType: newSecret.scopeType,
      scopeId: newSecret.scopeId || null,
      value: newSecret.value
    });
    setNewSecret({ name: "", scopeType: "package", scopeId: "", value: "" });
  };

  return (
    <div className="space-y-6">
      <Card title="Add Secret">
        <div className="grid gap-3 md:grid-cols-2 space-y-4">
          <Input
            placeholder="Name"
            value={newSecret.name}
            onChange={(e) => setNewSecret({ ...newSecret, name: e.target.value })}
          />
          <Select
            value={newSecret.scopeType}
            onChange={(e) =>
              setNewSecret({ ...newSecret, scopeType: e.target.value })
            }
          >
            <option value="package">package</option>
            <option value="app">app</option>
            <option value="agent">agent</option>
            <option value="team">team</option>
          </Select>
          <Input
            placeholder="Scope ID (package/team/agent id)"
            value={newSecret.scopeId}
            onChange={(e) =>
              setNewSecret({ ...newSecret, scopeId: e.target.value })
            }
          />
          <Input
            placeholder="Value"
            value={newSecret.value}
            onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
          />
        </div>
        <Button onClick={handleSave}>Save</Button>
      </Card>
      <Card>
        <div className="space-y-2 text-sm">
          {secrets.map((secret) => (
            <div key={secret.id} className="border-b border-slate-800 pb-2">
              <div className="text-slate-200">{secret.name}</div>
              <div className="text-slate-500">
                {secret.scope_type} {secret.scope_id ?? ""}
              </div>
              <div className="pt-2">
                <Button
                  variant="secondary"
                  onClick={() => onDeleteSecret(secret.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
