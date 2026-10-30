import {schema,type OrgOpsDrizzleDb} from '@orgops/db';
import {and,eq,inArray,or,sql} from 'drizzle-orm';

/** Lifecycle records survive runner/API crashes; availability heartbeats do not
 * identify the execution that owns an unfinished turn. Return only boundaries,
 * never lifecycle-channel text or historical tool payloads. */
export function latestAgentStarts(orm:OrgOpsDrizzleDb,names:string[]):Map<string,number>{
 if(!names.length)return new Map();
 const target=sql<string>`json_extract(CASE WHEN octet_length(${schema.events.payload_json}) <= 65536 THEN CASE WHEN json_valid(${schema.events.payload_json}) THEN ${schema.events.payload_json} ELSE '{}' END ELSE '{}' END, '$.targetAgentName')`;
 const rows=orm.select({agent:target,at:sql<number>`max(${schema.events.created_at})`})
  .from(schema.events).where(and(
   sql`${schema.events.type} IN ('agent.lifecycle.started', 'wrapper.lifecycle.started')`,
   or(and(eq(schema.events.type,'agent.lifecycle.started'),eq(schema.events.source,'system:runner')),
      and(eq(schema.events.type,'wrapper.lifecycle.started'),eq(schema.events.source,'system:runner:wrapper'))),
   inArray(target,names),
  )).groupBy(target).all();
 return new Map(rows.map(row=>[row.agent,row.at]));
}
